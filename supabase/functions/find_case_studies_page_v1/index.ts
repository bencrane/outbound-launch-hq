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
  destination_endpoint_url?: string;
  receiver_function_url?: string;
  storage_worker_function_url?: string;
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

    // Connect to HQ DB to look up workflow config
    const hqUrl = Deno.env.get("SUPABASE_URL");
    const hqKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!hqUrl || !hqKey) {
      return new Response(
        JSON.stringify({ error: "HQ database credentials not configured" }),
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
    const destinationEndpointUrl = destConfig?.destination_endpoint_url;
    const receiverUrl = destConfig?.receiver_function_url;
    const sourceConfig = destConfig?.source_config;

    if (!destinationEndpointUrl) {
      return new Response(
        JSON.stringify({
          error: "No destination_endpoint_url configured for this workflow",
          hint: "Set destination_config.destination_endpoint_url in db_driven_enrichment_workflows"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
    const workspaceUrl = Deno.env.get("WORKSPACE_URL");
    const workspaceKey = Deno.env.get("WORKSPACE_SERVICE_ROLE_KEY");

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

    console.log(`find_case_studies_page_v1: sending ${companies.length} companies to ${destinationEndpointUrl}`);
    console.log(`Source: ${sourceConfig.db}.${sourceConfig.table} columns: ${sourceConfig.select_columns.join(", ")}`);

    const results: Array<{ company_domain: string; status: string; error?: string }> = [];
    const resolvedPlayName = play_name || workflowConfig.play_id || "unknown";

    // Rate limit: 100ms between requests
    const DELAY_MS = 100;

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

        // Build payload with company info + source data
        const payload: Record<string, unknown> = {
          // Company info
          company_id: company.company_id,
          company_domain: company.company_domain,
          company_name: company.company_name,

          // Workflow context
          workflow_id: workflow.id,
          workflow_slug: workflowConfig.workflow_slug,
          play_name: resolvedPlayName,
          step_number: workflowConfig.overall_step_number,

          // Callback URL
          receiver_function_url: receiverUrl,
        };

        // Add all source columns to payload
        for (const col of sourceConfig.select_columns) {
          payload[col] = sourceData[col];
        }

        console.log(`[${i + 1}/${companies.length}] Sending: ${company.company_domain}`);

        const response = await fetch(destinationEndpointUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          results.push({ company_domain: company.company_domain, status: "sent" });
        } else {
          const errText = await response.text();
          throw new Error(`Endpoint returned ${response.status}: ${errText.substring(0, 200)}`);
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

    const successCount = results.filter(r => r.status === "sent").length;

    return new Response(
      JSON.stringify({
        total: companies.length,
        sent: successCount,
        failed: companies.length - successCount,
        message: `Sent ${successCount} companies to endpoint. Results will arrive via callback.`,
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
