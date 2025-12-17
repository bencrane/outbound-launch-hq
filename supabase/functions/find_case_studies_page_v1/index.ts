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

interface OpenAIResponse {
  case_studies_page_url: string | null;
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

    const results: Array<{ company_domain: string; status: string; error?: string; result?: OpenAIResponse }> = [];

    // Process each company
    for (const company of companies) {
      try {
        // 1. Fetch links from company_homepage_cleaned
        const { data: cleanedData, error: fetchError } = await workspaceClient
          .from("company_homepage_cleaned")
          .select("links")
          .eq("company_domain", company.company_domain)
          .single();

        if (fetchError || !cleanedData) {
          throw new Error(`No cleaned homepage data found for ${company.company_domain}. Run Step 2 first.`);
        }

        const links: Link[] = cleanedData.links || [];

        if (links.length === 0) {
          throw new Error(`No links found in cleaned homepage for ${company.company_domain}`);
        }

        // 2. Call OpenAI to identify case studies page (returns full absolute URL)
        const aiResult = await identifyCaseStudiesPage(openaiApiKey, company.company_domain, links);

        // 3. Send to storage worker
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
              case_studies_page_url: aiResult.case_studies_page_url,
            },
          }),
        });

        if (!storageResponse.ok) {
          const errText = await storageResponse.text();
          throw new Error(`Storage worker failed: ${errText}`);
        }

        results.push({
          company_domain: company.company_domain,
          status: "success",
          result: aiResult,
        });

      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`Error processing ${company.company_domain}:`, message);
        results.push({ company_domain: company.company_domain, status: "error", error: message });
      }
    }

    const successCount = results.filter((r) => r.status === "success").length;

    return new Response(
      JSON.stringify({
        total: companies.length,
        success: successCount,
        failed: companies.length - successCount,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("find_case_studies_page_v1 error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function identifyCaseStudiesPage(
  apiKey: string,
  companyDomain: string,
  links: Link[]
): Promise<OpenAIResponse> {
  // Format links for the prompt - filter out empty/useless links
  const relevantLinks = links.filter((link) => {
    const href = link.href?.toLowerCase() || "";
    const text = link.text?.toLowerCase() || "";
    // Skip empty, anchor-only, or obviously irrelevant links
    if (!href || href === "#" || href === "/") return false;
    if (href.startsWith("tel:") || href.startsWith("mailto:")) return false;
    return true;
  });

  const linksText = relevantLinks
    .map((link, i) => `${i + 1}. href="${link.href}" text="${link.text}"`)
    .join("\n");

  const prompt = `You are analyzing href values extracted from anchor tags on ${companyDomain}'s homepage.

INPUT DATA:
These are raw href attribute values - they may be relative paths, absolute URLs, or special protocols.
${linksText}

PHASE 1 - FILTER (mentally skip these):
- tel:, mailto:, javascript: protocols
- Hash-only anchors (#, #section)
- Social media (linkedin, twitter, facebook, instagram, youtube)
- Empty or root-only (/, "")

PHASE 2 - IDENTIFY:
Find the MAIN case studies page (not individual articles). Look for hrefs with text containing:
- "case studies", "customer stories", "success stories", "customers"
Pick the primary listing page, not a specific case study.

PHASE 3 - CONSTRUCT FULL URL:
- If href starts with http:// or https:// → use as-is
- If href starts with / → prepend https://${companyDomain}
- If href is relative without / → prepend https://${companyDomain}/

PHASE 4 - VALIDATE:
- Result MUST be a valid https:// URL
- If you cannot construct a valid URL, return null

Return JSON only: {"case_studies_page_url": "<full https:// URL or null>"}`;

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
          content: "You analyze raw href attributes from website anchor tags and construct valid URLs. Follow the phases exactly. Respond with JSON only, no markdown.",
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
  return parsed;
}
