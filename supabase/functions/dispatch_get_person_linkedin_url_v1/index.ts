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
}

interface RequestBody {
  companies: CompanyInput[];
  workflow: WorkflowInput;
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

    // Fetch full workflow config (source of truth)
    const { data: workflowConfig, error: workflowError } = await supabase
      .from("db_driven_enrichment_workflows")
      .select("id, workflow_slug, destination_endpoint_url, receiver_function_url, source_table_name, source_table_company_fk, source_table_select_columns")
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

    // Validate source table config
    if (!workflowConfig.source_table_name || !workflowConfig.source_table_company_fk) {
      return new Response(
        JSON.stringify({
          error: "Workflow missing source_table_name or source_table_company_fk in config",
          workflow_id: workflow.id,
          workflow_slug: workflowConfig.workflow_slug
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Connect to GTM Teaser DB to fetch source records
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

    // Determine select columns (from config or default)
    const defaultSelectColumns = "id, hq_target_company_id, hq_target_company_name, hq_target_company_domain, extracted_buyer_company, extracted_contact_name, extracted_contact_role";
    const selectColumns = workflowConfig.source_table_select_columns || defaultSelectColumns;

    // Fetch records from source table (defined in workflow config)
    const { data: sourceRecords, error: sourceError } = await gtmSupabase
      .from(workflowConfig.source_table_name)
      .select(selectColumns)
      .in(workflowConfig.source_table_company_fk, companyIds);

    if (sourceError) {
      return new Response(
        JSON.stringify({
          error: `Failed to fetch from ${workflowConfig.source_table_name}: ${sourceError.message}`,
          source_table: workflowConfig.source_table_name,
          company_fk: workflowConfig.source_table_company_fk
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!sourceRecords || sourceRecords.length === 0) {
      return new Response(
        JSON.stringify({
          message: `No records found in ${workflowConfig.source_table_name} for selected companies`,
          companies_selected: companies.length,
          records_found: 0,
          source_table: workflowConfig.source_table_name
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Process each source record with rate limiting
    const results: { id: string; success: boolean; error?: string }[] = [];

    for (let i = 0; i < sourceRecords.length; i++) {
      const record = sourceRecords[i] as Record<string, unknown>;

      try {
        // Build payload for Clay - spread all source fields + add workflow context
        const payload = {
          // All fields from source record (dynamic based on select_columns)
          ...record,
          // Rename 'id' to 'source_record_id' to be explicit
          source_record_id: record.id,
          // Workflow context (for routing/parameterization in receiver)
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

        const recordId = String(record.id || i);
        if (response.ok) {
          results.push({
            id: recordId,
            success: true
          });
        } else {
          const errorText = await response.text();
          results.push({
            id: recordId,
            success: false,
            error: `HTTP ${response.status}: ${errorText}`
          });
        }
      } catch (err) {
        const recordId = String(record.id || i);
        results.push({
          id: recordId,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error"
        });
      }

      // Rate limit: wait before next request (skip delay after last item)
      if (i < sourceRecords.length - 1) {
        await delay(DELAY_BETWEEN_REQUESTS_MS);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({
        message: `Dispatched ${successCount} of ${sourceRecords.length} records to Clay`,
        workflow_slug: workflowConfig.workflow_slug,
        source_table: workflowConfig.source_table_name,
        companies_selected: companies.length,
        records_found: sourceRecords.length,
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
