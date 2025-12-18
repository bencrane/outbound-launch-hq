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

interface SourceConfig {
  db: "workspace" | "hq";
  table: string;
  select_columns: string[];
}

interface DestinationConfig {
  source_config?: SourceConfig;
  destinations?: Array<{
    db: string;
    table: string;
    fields: Record<string, string>;
  }>;
  storage_worker_function_url?: string;
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
    const hqUrl = Deno.env.get("SUPABASE_URL");
    const hqKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const workspaceUrl = Deno.env.get("WORKSPACE_URL");
    const workspaceKey = Deno.env.get("WORKSPACE_SERVICE_ROLE_KEY");
    const storageWorkerUrl = Deno.env.get("STORAGE_WORKER_URL");

    if (!openaiApiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!hqUrl || !hqKey) {
      return new Response(
        JSON.stringify({ error: "HQ database credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!storageWorkerUrl) {
      return new Response(
        JSON.stringify({ error: "STORAGE_WORKER_URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const hqClient = createClient(hqUrl, hqKey);

    // Look up workflow config from database
    const { data: workflowConfig, error: workflowError } = await hqClient
      .from("db_driven_enrichment_workflows")
      .select("id, workflow_slug, play_id, overall_step_number, destination_config")
      .eq("id", workflow.id)
      .single();

    if (workflowError || !workflowConfig) {
      return new Response(
        JSON.stringify({ error: `Workflow not found: ${workflow.id}`, details: workflowError?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const destConfig = workflowConfig.destination_config as DestinationConfig | null;
    const sourceConfig = destConfig?.source_config;

    if (!sourceConfig) {
      return new Response(
        JSON.stringify({
          error: "No source_config configured for this workflow",
          hint: "Set destination_config.source_config with db, table, and select_columns"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Connect to source DB (workspace or hq)
    const getSourceClient = () => {
      if (sourceConfig.db === "workspace") {
        if (!workspaceUrl || !workspaceKey) {
          throw new Error("Workspace database credentials not configured");
        }
        return createClient(workspaceUrl, workspaceKey);
      }
      return hqClient;
    };

    const sourceClient = getSourceClient();

    console.log(`find_case_studies_page_v1: processing ${companies.length} companies via OpenAI`);
    console.log(`Source: ${sourceConfig.db}.${sourceConfig.table} columns: ${sourceConfig.select_columns.join(", ")}`);

    const results: Array<{
      company_domain: string;
      status: string;
      case_studies_page_url?: string | null;
      error?: string;
    }> = [];
    const resolvedPlayName = play_name || workflowConfig.play_id || "unknown";

    // Rate limit: 500ms between OpenAI requests to avoid rate limits
    const DELAY_MS = 500;

    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];

      try {
        // Fetch source data from configured table
        const { data: sourceData, error: fetchError } = await sourceClient
          .from(sourceConfig.table)
          .select(sourceConfig.select_columns.join(", "))
          .eq("company_domain", company.company_domain)
          .single();

        if (fetchError || !sourceData) {
          throw new Error(`No data found in ${sourceConfig.table} for ${company.company_domain}. Run previous step first.`);
        }

        // Get homepage_links from source data
        const homepageLinks = sourceData.homepage_links;
        if (!homepageLinks || (Array.isArray(homepageLinks) && homepageLinks.length === 0)) {
          throw new Error(`No homepage_links found for ${company.company_domain}`);
        }

        console.log(`[${i + 1}/${companies.length}] Calling OpenAI for: ${company.company_domain}`);

        // Call OpenAI to find case studies page
        const aiResult = await findCaseStudiesPage(openaiApiKey, company.company_domain, homepageLinks);

        console.log(`[${i + 1}/${companies.length}] OpenAI result: ${aiResult.case_studies_page_url}`);

        // Send result to storage worker
        const storageResponse = await fetch(storageWorkerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${hqKey}`,
          },
          body: JSON.stringify({
            workflow_id: workflow.id,
            company_id: company.company_id,
            company_domain: company.company_domain,
            company_name: company.company_name,
            play_name: resolvedPlayName,
            data: {
              case_studies_page_url: aiResult.case_studies_page_url,
            },
          }),
        });

        if (storageResponse.ok) {
          results.push({
            company_domain: company.company_domain,
            status: "success",
            case_studies_page_url: aiResult.case_studies_page_url,
          });
        } else {
          const errText = await storageResponse.text();
          throw new Error(`Storage worker error: ${storageResponse.status} - ${errText.substring(0, 200)}`);
        }

      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`Error processing ${company.company_domain}:`, message);
        results.push({ company_domain: company.company_domain, status: "error", error: message });
      }

      // Rate limit delay (skip on last item)
      if (i < companies.length - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }

    const successCount = results.filter(r => r.status === "success").length;

    return new Response(
      JSON.stringify({
        total: companies.length,
        success: successCount,
        failed: companies.length - successCount,
        message: `Processed ${successCount} companies via OpenAI`,
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

async function findCaseStudiesPage(
  apiKey: string,
  companyDomain: string,
  homepageLinks: unknown
): Promise<OpenAIResponse> {
  // Format the links for the prompt
  let linksText: string;
  if (Array.isArray(homepageLinks)) {
    linksText = homepageLinks
      .map((link, i) => {
        if (typeof link === "object" && link !== null) {
          const href = (link as Record<string, unknown>).href || "";
          const text = (link as Record<string, unknown>).text || "";
          return `${i + 1}. href="${href}" text="${text}"`;
        }
        return `${i + 1}. ${link}`;
      })
      .join("\n");
  } else if (typeof homepageLinks === "string") {
    linksText = homepageLinks;
  } else {
    linksText = JSON.stringify(homepageLinks);
  }

  const baseDomain = `https://${companyDomain}`;

  const prompt = `You are analyzing href values extracted from anchor tags on the homepage of ${companyDomain}.

INPUT DATA:
These are href values from anchor tags on the company homepage.
${linksText}

BASE DOMAIN: ${baseDomain}

YOUR TASK:
Find the URL of the MAIN case studies / customers / success stories listing page.

PHASE 1 - FILTER:
Skip these types of hrefs:
- tel:, mailto:, javascript:, # (anchors)
- Social media links (twitter, linkedin, facebook, etc.)
- External domains (unless it's a subdomain of ${companyDomain})
- Generic pages: /about, /contact, /pricing, /blog, /careers, /login, /signup

PHASE 2 - IDENTIFY:
Look for the MAIN listing page that contains multiple case studies. Common patterns:
- /customers, /case-studies, /success-stories, /stories, /clients
- /resources/case-studies, /about/customers
- Text hints: "Customers", "Case Studies", "Success Stories", "Our Clients"

DO NOT select:
- Individual case study pages (e.g., /customers/acme-corp)
- Blog posts about customers
- Press releases or news

PHASE 3 - CONSTRUCT:
Build the full absolute URL:
- If href starts with http:// or https:// → use as-is
- If href starts with / → prepend ${baseDomain}
- If href is relative → prepend ${baseDomain}/

PHASE 4 - VALIDATE:
Ensure the result is a valid https:// URL for ${companyDomain}.

Return JSON only:
{
  "case_studies_page_url": "<full https:// URL or null if not found>"
}

If no case studies page is found, return:
{"case_studies_page_url": null}`;

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
          content: "You analyze website navigation links to find the main case studies or customers page. Follow the phased instructions exactly. Respond with JSON only, no markdown.",
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

  // Validate URL if present
  if (parsed.case_studies_page_url) {
    try {
      new URL(parsed.case_studies_page_url);
    } catch {
      console.warn(`Invalid URL returned by OpenAI: ${parsed.case_studies_page_url}`);
      parsed.case_studies_page_url = null;
    }
  }

  return parsed;
}
