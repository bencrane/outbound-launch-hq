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

interface CaseStudyUrl {
  id: string;
  company_id: string;
  company_domain: string;
  company_name: string | null;
  case_study_url: string;
  case_study_text: string | null;
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
    const hqUrl = Deno.env.get("SUPABASE_URL");
    const hqKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const workspaceUrl = Deno.env.get("WORKSPACE_URL");
    const workspaceKey = Deno.env.get("WORKSPACE_SERVICE_ROLE_KEY");

    if (!workspaceUrl || !workspaceKey) {
      return new Response(
        JSON.stringify({ error: "Workspace database credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!hqUrl || !hqKey) {
      return new Response(
        JSON.stringify({ error: "HQ database credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const workspaceClient = createClient(workspaceUrl, workspaceKey);
    const hqClient = createClient(hqUrl, hqKey);

    // Look up the workflow config to get the Clay webhook URL
    const { data: workflowConfig, error: workflowError } = await hqClient
      .from("db_driven_enrichment_workflows")
      .select("id, workflow_slug, destination_config")
      .eq("id", workflow.id)
      .single();

    if (workflowError || !workflowConfig) {
      return new Response(
        JSON.stringify({ error: `Workflow not found: ${workflow.id}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract URLs from destination_config
    const destConfig = workflowConfig.destination_config as {
      clay_webhook_url?: string;
      receiver_function_url?: string;
      storage_worker_function_url?: string;
    } | null;

    const clayWebhookUrl = destConfig?.clay_webhook_url;
    const receiverUrl = destConfig?.receiver_function_url;

    if (!clayWebhookUrl) {
      return new Response(
        JSON.stringify({ error: "No clay_webhook_url configured in destination_config for this workflow" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get company domains for query
    const companyDomains = companies.map(c => c.company_domain);

    // Query case study URLs from Step 6 output
    const { data: caseStudyUrls, error: fetchError } = await workspaceClient
      .from("company_specific_case_study_urls")
      .select("id, company_id, company_domain, company_name, case_study_url, case_study_text")
      .in("company_domain", companyDomains);

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch case study URLs: ${fetchError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!caseStudyUrls || caseStudyUrls.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No case study URLs found for selected companies",
          hint: "Run Step 6 (Extract Case Study URLs) first"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${caseStudyUrls.length} case study URLs to scrape`);

    // Send each URL to Clay
    const results: Array<{
      case_study_url: string;
      company_domain: string;
      status: string;
      error?: string;
    }> = [];

    // Rate limit: 100ms between requests
    const DELAY_MS = 100;

    for (let i = 0; i < caseStudyUrls.length; i++) {
      const caseStudy = caseStudyUrls[i] as CaseStudyUrl;

      try {
        // Build payload for Clay
        const clayPayload = {
          // Source record info
          source_record_id: caseStudy.id,
          case_study_url: caseStudy.case_study_url,
          case_study_text: caseStudy.case_study_text,

          // Company context
          company_id: caseStudy.company_id,
          company_domain: caseStudy.company_domain,
          company_name: caseStudy.company_name,

          // Workflow context (so Clay can pass it back)
          workflow_id: workflow.id,
          workflow_slug: workflow.slug,
          play_name: play_name || "case-study-champions",

          // Receiver URL for Clay to call back
          receiver_function_url: receiverUrl || "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/master_receiver_v1",
        };

        console.log(`[${i + 1}/${caseStudyUrls.length}] Sending to Clay: ${caseStudy.case_study_url}`);

        const clayResponse = await fetch(clayWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(clayPayload),
        });

        if (clayResponse.ok) {
          results.push({
            case_study_url: caseStudy.case_study_url,
            company_domain: caseStudy.company_domain,
            status: "sent",
          });
        } else {
          const errText = await clayResponse.text();
          results.push({
            case_study_url: caseStudy.case_study_url,
            company_domain: caseStudy.company_domain,
            status: "error",
            error: `Clay responded with ${clayResponse.status}: ${errText.substring(0, 200)}`,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`Error sending ${caseStudy.case_study_url}:`, message);
        results.push({
          case_study_url: caseStudy.case_study_url,
          company_domain: caseStudy.company_domain,
          status: "error",
          error: message,
        });
      }

      // Rate limit delay (skip on last item)
      if (i < caseStudyUrls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }

    const sentCount = results.filter(r => r.status === "sent").length;
    const errorCount = results.filter(r => r.status === "error").length;

    console.log(`Dispatch complete: ${sentCount} sent, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        total_urls: caseStudyUrls.length,
        sent: sentCount,
        errors: errorCount,
        message: `Sent ${sentCount} URLs to Clay for scraping. Results will arrive via callback.`,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("scrape_case_study_url_v1 error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
