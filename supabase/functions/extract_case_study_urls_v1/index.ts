import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CompanyInput {
  company_id: string;
  company_name: string;
  company_domain: string;
}

interface RequestBody {
  companies: CompanyInput[];
  workflow: {
    id: string;
    slug: string;
  };
  play_name?: string;
}

interface Link {
  href: string;
  text: string;
}

interface CaseStudyUrl {
  url: string;
  text: string;
}

interface OpenAIResponse {
  case_study_urls: CaseStudyUrl[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    const { companies, workflow, play_name } = body;

    if (!companies || companies.length === 0) {
      return new Response(
        JSON.stringify({ error: "No companies provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!workflow?.id) {
      return new Response(
        JSON.stringify({ error: "workflow.id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get environment variables
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    const storageWorkerUrl = Deno.env.get("STORAGE_WORKER_URL");
    const workspaceUrl = Deno.env.get("WORKSPACE_URL");
    const workspaceKey = Deno.env.get("WORKSPACE_SERVICE_ROLE_KEY");

    if (!openaiApiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!storageWorkerUrl) {
      return new Response(
        JSON.stringify({ error: "STORAGE_WORKER_URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!workspaceUrl || !workspaceKey) {
      return new Response(
        JSON.stringify({ error: "Workspace database credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const workspaceClient = createClient(workspaceUrl, workspaceKey);

    const results: Array<{
      company_domain: string;
      status: string;
      error?: string;
      urls_found?: number;
      urls_stored?: number;
    }> = [];

    // Process each company
    for (const company of companies) {
      try {
        // 1. Fetch links from case_studies_page_scrapes (Step 3 output)
        const { data: scrapedData, error: fetchError } = await workspaceClient
          .from("case_studies_page_scrapes")
          .select("links, case_studies_page_url")
          .eq("company_domain", company.company_domain)
          .single();

        if (fetchError || !scrapedData) {
          throw new Error(`No case studies page scrape found for ${company.company_domain}. Run Step 3 first.`);
        }

        const links: Link[] = scrapedData.links || [];
        const baseUrl = scrapedData.case_studies_page_url;

        if (links.length === 0) {
          throw new Error(`No links found in case studies page scrape for ${company.company_domain}`);
        }

        // 2. Call OpenAI to identify individual case study URLs
        const aiResult = await extractCaseStudyUrls(openaiApiKey, company.company_domain, baseUrl, links);

        if (aiResult.case_study_urls.length === 0) {
          console.log(`No case study URLs found for ${company.company_domain}`);
          // Still call storage worker to mark as complete (with empty result)
          await fetch(storageWorkerUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workflow_id: workflow.id,
              company_id: company.company_id,
              company_domain: company.company_domain,
              company_name: company.company_name,
              play_name: play_name,
              data: {
                case_study_urls: [],
                no_case_studies_found: true,
              },
            }),
          });

          results.push({
            company_domain: company.company_domain,
            status: "success",
            urls_found: 0,
            urls_stored: 0,
          });
          continue;
        }

        // 3. Send each case study URL to storage worker as a separate row
        let storedCount = 0;
        const storageErrors: string[] = [];

        for (const caseStudy of aiResult.case_study_urls) {
          try {
            const storageResponse = await fetch(storageWorkerUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                workflow_id: workflow.id,
                company_id: company.company_id,
                company_domain: company.company_domain,
                company_name: company.company_name,
                play_name: play_name,
                data: {
                  case_study_url: caseStudy.url,
                  case_study_text: caseStudy.text,
                },
              }),
            });

            if (storageResponse.ok) {
              storedCount++;
            } else {
              const errText = await storageResponse.text();
              storageErrors.push(`${caseStudy.url}: status=${storageResponse.status} error=${errText}`);
            }
          } catch (fetchErr) {
            storageErrors.push(`${caseStudy.url}: fetch error=${fetchErr}`);
          }
        }

        console.log(`${company.company_domain}: Found ${aiResult.case_study_urls.length} URLs, stored ${storedCount}, errors: ${storageErrors.length}`);

        results.push({
          company_domain: company.company_domain,
          status: "success",
          urls_found: aiResult.case_study_urls.length,
          urls_stored: storedCount,
          storage_errors: storageErrors.length > 0 ? storageErrors : undefined,
        });

      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`Error processing ${company.company_domain}:`, message);
        results.push({ company_domain: company.company_domain, status: "error", error: message });
      }
    }

    const successCount = results.filter((r) => r.status === "success").length;
    const totalUrlsFound = results.reduce((sum, r) => sum + (r.urls_found || 0), 0);

    return new Response(
      JSON.stringify({
        total_companies: companies.length,
        success: successCount,
        failed: companies.length - successCount,
        total_urls_found: totalUrlsFound,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("extract_case_study_urls_v1 error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function extractCaseStudyUrls(
  apiKey: string,
  companyDomain: string,
  baseUrl: string | null,
  links: Link[]
): Promise<OpenAIResponse> {
  // Filter out obviously irrelevant links
  const relevantLinks = links.filter((link) => {
    const href = link.href?.toLowerCase() || "";
    if (!href || href === "#" || href === "/") return false;
    if (href.startsWith("tel:") || href.startsWith("mailto:") || href.startsWith("javascript:")) return false;
    return true;
  });

  const linksText = relevantLinks
    .map((link, i) => `${i + 1}. href="${link.href}" text="${link.text}"`)
    .join("\n");

  // Determine base domain for URL construction
  let baseDomain = companyDomain;
  if (baseUrl) {
    try {
      const parsedBase = new URL(baseUrl);
      baseDomain = parsedBase.origin;
    } catch {
      baseDomain = `https://${companyDomain}`;
    }
  } else {
    baseDomain = `https://${companyDomain}`;
  }

  const prompt = `You are analyzing links from a case studies/customers page on ${companyDomain}.

INPUT DATA:
These are href values from anchor tags on the case studies page.
${linksText}

BASE URL for relative paths: ${baseDomain}

YOUR TASK:
Identify links that point to INDIVIDUAL case study pages (not the listing page itself).

WHAT IS A CASE STUDY LINK:
- Links to specific customer success stories
- Often contain company names, project names, or descriptive titles
- May have patterns like: /case-study/*, /customers/*, /success-story/*, /stories/*
- Link text often describes the achievement (e.g., "How Acme reduced costs by 50%")

WHAT IS NOT A CASE STUDY LINK:
- Navigation links (Home, About, Contact, Pricing)
- Social media links
- The main case studies listing page itself
- Generic links (Learn more, Read more without context)
- Product/feature pages
- Blog posts that aren't case studies
- Links to external sites (unless they're clearly case study partners)

FOR EACH CASE STUDY LINK:
1. Construct the full absolute URL:
   - If href starts with http:// or https:// → use as-is
   - If href starts with / → prepend ${baseDomain}
   - If href is relative → prepend ${baseDomain}/

2. Include the link text (for later reference)

Return JSON only:
{
  "case_study_urls": [
    {"url": "<full https:// URL>", "text": "<link text>"},
    ...
  ]
}

If no case study URLs are found, return: {"case_study_urls": []}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You analyze links from case studies pages and identify individual case study URLs. Follow instructions exactly. Respond with JSON only, no markdown.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenAI returned empty response");
  }

  const parsed = JSON.parse(content) as OpenAIResponse;

  // Validate URLs
  const validatedUrls: CaseStudyUrl[] = [];
  for (const item of parsed.case_study_urls || []) {
    try {
      new URL(item.url);
      validatedUrls.push(item);
    } catch {
      console.warn(`Invalid URL skipped: ${item.url}`);
    }
  }

  return { case_study_urls: validatedUrls };
}
