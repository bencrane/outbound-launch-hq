import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CompanyInput {
  company_id: string;
  company_name?: string | null;
  company_domain?: string | null;
}

interface WorkflowInput {
  id: string;
  workflow_slug?: string;
  receiver_function_url?: string | null;
}

interface RequestBody {
  companies: CompanyInput[];
  workflow: WorkflowInput;
}

interface CaseStudyRecord {
  id: string;
  case_study_url: string;
  customer_name: string | null;
  hq_target_company_id: string;
  hq_target_company_domain: string | null;
}

// Rate limit: 100ms between requests = max 10 requests/sec (Clay's limit)
const DELAY_BETWEEN_REQUESTS_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { companies, workflow }: RequestBody = await req.json();

    if (!companies || !Array.isArray(companies) || companies.length === 0) {
      return new Response(
        JSON.stringify({ error: "companies array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!workflow?.id) {
      return new Response(
        JSON.stringify({ error: "workflow.id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Connect to Outbound Launch HQ DB to get workflow config
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch full workflow config
    const { data: workflowConfig, error: workflowError } = await supabase
      .from("db_driven_enrichment_workflows")
      .select("id, workflow_slug, destination_endpoint_url, receiver_function_url")
      .eq("id", workflow.id)
      .single();

    if (workflowError || !workflowConfig) {
      return new Response(
        JSON.stringify({ error: `Workflow not found: ${workflowError?.message || "Unknown"}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clayWebhookUrl = workflowConfig.destination_endpoint_url;
    if (!clayWebhookUrl) {
      return new Response(
        JSON.stringify({ error: "Workflow has no destination_endpoint_url (Clay webhook)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Connect to GTM Teaser DB to fetch case studies
    const gtmUrl = Deno.env.get("GTM_SUPABASE_URL");
    const gtmKey = Deno.env.get("GTM_SUPABASE_SERVICE_ROLE_KEY");

    if (!gtmUrl || !gtmKey) {
      return new Response(
        JSON.stringify({ error: "GTM Teaser DB credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gtmSupabase = createClient(gtmUrl, gtmKey);

    // Get company IDs
    const companyIds = companies.map((c) => c.company_id);

    // Fetch company names from hq_target_companies table
    const { data: targetCompanies, error: targetCompanyError } = await gtmSupabase
      .from("hq_target_companies")
      .select("id, company_name")
      .in("id", companyIds);

    if (targetCompanyError) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch target companies: ${targetCompanyError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build lookup map for company names
    const companyNameMap = new Map<string, string | null>();
    targetCompanies?.forEach((c) => {
      companyNameMap.set(c.id, c.company_name || null);
    });

    // Fetch case studies for these companies
    const { data: caseStudies, error: caseStudyError } = await gtmSupabase
      .from("case_study_urls")
      .select("id, case_study_url, customer_name, hq_target_company_id, hq_target_company_domain")
      .in("hq_target_company_id", companyIds);

    if (caseStudyError) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch case studies: ${caseStudyError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!caseStudies || caseStudies.length === 0) {
      return new Response(
        JSON.stringify({
          message: "No case studies found for selected companies",
          companies_selected: companies.length,
          case_studies_found: 0
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Process each case study with rate limiting
    const results: { id: string; case_study_url: string; success: boolean; error?: string }[] = [];

    for (let i = 0; i < caseStudies.length; i++) {
      const caseStudy = caseStudies[i] as CaseStudyRecord;

      try {
        // Build payload for Clay
        const payload = {
          // Case study data
          case_study_url_id: caseStudy.id,
          case_study_url: caseStudy.case_study_url,
          customer_name: caseStudy.customer_name,
          hq_target_company_id: caseStudy.hq_target_company_id,
          hq_target_company_name: companyNameMap.get(caseStudy.hq_target_company_id) || null,
          hq_target_company_domain: caseStudy.hq_target_company_domain,
          // Workflow context (so Clay can pass it back to receiver)
          workflow_id: workflowConfig.id,
          workflow_slug: workflowConfig.workflow_slug,
          receiver_function_url: workflowConfig.receiver_function_url,
        };

        const response = await fetch(clayWebhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          results.push({
            id: caseStudy.id,
            case_study_url: caseStudy.case_study_url,
            success: true
          });
        } else {
          const errorText = await response.text();
          results.push({
            id: caseStudy.id,
            case_study_url: caseStudy.case_study_url,
            success: false,
            error: `HTTP ${response.status}: ${errorText}`
          });
        }
      } catch (err) {
        results.push({
          id: caseStudy.id,
          case_study_url: caseStudy.case_study_url,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error"
        });
      }

      // Rate limit: wait before next request (skip delay after last item)
      if (i < caseStudies.length - 1) {
        await delay(DELAY_BETWEEN_REQUESTS_MS);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({
        message: `Dispatched ${successCount} of ${caseStudies.length} case studies to Clay`,
        companies_selected: companies.length,
        case_studies_found: caseStudies.length,
        success_count: successCount,
        fail_count: failCount,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Dispatcher error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
