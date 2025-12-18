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

interface BuyerDetail {
  id: string;
  company_id: string;
  company_domain: string;
  company_name: string | null;
  case_study_url: string;
  buyer_full_name: string | null;
  buyer_first_name: string | null;
  buyer_last_name: string | null;
  buyer_job_title: string | null;
  buyer_company_name: string | null;
}

interface DestinationConfig {
  destination_endpoint_url?: string;
  receiver_function_url?: string;
  edge_function_name?: string;
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

    // Look up the workflow config
    const { data: workflowConfig, error: workflowError } = await hqClient
      .from("db_driven_enrichment_workflows")
      .select("id, workflow_slug, play_id, overall_step_number, destination_config")
      .eq("id", workflow.id)
      .single();

    if (workflowError || !workflowConfig) {
      return new Response(
        JSON.stringify({ error: `Workflow not found: ${workflow.id}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const destConfig = workflowConfig.destination_config as DestinationConfig | null;
    const clayWebhookUrl = destConfig?.destination_endpoint_url;
    const receiverUrl = destConfig?.receiver_function_url;

    if (!clayWebhookUrl) {
      return new Response(
        JSON.stringify({
          error: "No destination_endpoint_url configured for this workflow",
          hint: "Set destination_config.destination_endpoint_url to Clay webhook URL"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get company domains for query
    const companyDomains = companies.map(c => c.company_domain);

    // Query buyer details from Step 5 output
    const { data: buyerDetails, error: fetchError } = await workspaceClient
      .from("case_study_buyer_details")
      .select("id, company_id, company_domain, company_name, case_study_url, buyer_full_name, buyer_first_name, buyer_last_name, buyer_job_title, buyer_company_name")
      .in("company_domain", companyDomains)
      .not("buyer_first_name", "is", null);

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch buyer details: ${fetchError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!buyerDetails || buyerDetails.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No buyer details found for selected companies",
          hint: "Run Step 5 (Extract Buyer Details) first, and ensure buyers have names"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${buyerDetails.length} buyers to lookup LinkedIn URLs`);

    const results: Array<{
      buyer_name: string;
      company_domain: string;
      status: string;
      error?: string;
    }> = [];

    const resolvedPlayName = play_name || workflowConfig.play_id || "case-study-champions";

    // Rate limit: 100ms between requests
    const DELAY_MS = 100;

    for (let i = 0; i < buyerDetails.length; i++) {
      const buyer = buyerDetails[i] as BuyerDetail;

      // Skip buyers without names
      if (!buyer.buyer_first_name && !buyer.buyer_full_name) {
        console.log(`Skipping buyer without name for ${buyer.company_domain}`);
        continue;
      }

      try {
        // Build payload for Clay
        const clayPayload = {
          // Source record info
          source_record_id: buyer.id,

          // Buyer info for LinkedIn lookup
          buyer_full_name: buyer.buyer_full_name,
          buyer_first_name: buyer.buyer_first_name,
          buyer_last_name: buyer.buyer_last_name,
          buyer_job_title: buyer.buyer_job_title,
          buyer_company_name: buyer.buyer_company_name,

          // Context about where this buyer came from
          case_study_url: buyer.case_study_url,

          // Company context (the company we're researching, not the buyer's company)
          company_id: buyer.company_id,
          company_domain: buyer.company_domain,
          company_name: buyer.company_name,

          // Workflow context (so Clay can pass it back)
          workflow_id: workflow.id,
          workflow_slug: workflowConfig.workflow_slug,
          play_name: resolvedPlayName,
          step_number: workflowConfig.overall_step_number,

          // Receiver URL for Clay to call back
          receiver_function_url: receiverUrl || "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/clay_receiver_v1",
        };

        const buyerName = buyer.buyer_full_name || `${buyer.buyer_first_name} ${buyer.buyer_last_name}`;
        console.log(`[${i + 1}/${buyerDetails.length}] Sending to Clay: ${buyerName} at ${buyer.buyer_company_name}`);

        const clayResponse = await fetch(clayWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(clayPayload),
        });

        if (clayResponse.ok) {
          results.push({
            buyer_name: buyerName,
            company_domain: buyer.company_domain,
            status: "sent",
          });
        } else {
          const errText = await clayResponse.text();
          results.push({
            buyer_name: buyerName,
            company_domain: buyer.company_domain,
            status: "error",
            error: `Clay responded with ${clayResponse.status}: ${errText.substring(0, 200)}`,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const buyerName = buyer.buyer_full_name || `${buyer.buyer_first_name} ${buyer.buyer_last_name}`;
        console.error(`Error sending ${buyerName}:`, message);
        results.push({
          buyer_name: buyerName,
          company_domain: buyer.company_domain,
          status: "error",
          error: message,
        });
      }

      // Rate limit delay (skip on last item)
      if (i < buyerDetails.length - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }

    const sentCount = results.filter(r => r.status === "sent").length;
    const errorCount = results.filter(r => r.status === "error").length;

    console.log(`Dispatch complete: ${sentCount} sent, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        total_buyers: buyerDetails.length,
        sent: sentCount,
        errors: errorCount,
        message: `Sent ${sentCount} buyers to Clay for LinkedIn lookup. Results will arrive via callback.`,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("get_buyer_linkedin_url_v1 error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
