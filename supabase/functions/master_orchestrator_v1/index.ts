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
  company_linkedin_url?: string | null;
}

interface WorkflowInput {
  id?: string; // Now optional - if not provided, uses first active workflow
}

interface RequestBody {
  companies: CompanyInput[];
  workflow?: WorkflowInput;
  last_completed_step?: number; // For end-to-end pipeline: find next step after this
}

interface WorkflowConfig {
  id: string;
  workflow_slug: string;
  title: string | null;
  overall_step_number: number | null;
  phase_type: string | null;
  status: string;
  destination_endpoint_url: string | null;
  destination_type: string | null;
  receiver_function_url: string | null;
  source_table_name: string | null;
  source_table_company_fk: string | null;
  source_table_select_columns: string | null;
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
    console.log("=== MASTER ORCHESTRATOR v1 (End-to-End Pipeline) ===");
    console.log("Method:", req.method);

    // Parse request body
    const rawBody = await req.text();
    if (!rawBody || rawBody.trim() === "") {
      return new Response(
        JSON.stringify({ error: "Empty request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let requestBody: RequestBody;
    try {
      requestBody = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { companies, workflow, last_completed_step } = requestBody;

    // Validate input
    if (!companies || !Array.isArray(companies) || companies.length === 0) {
      return new Response(
        JSON.stringify({ error: "companies array is required and must not be empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Companies count:", companies.length);
    console.log("Last completed step:", last_completed_step ?? "none (starting from beginning)");

    // =========================================================================
    // STEP 1: Get workflow config from Outbound Launch HQ DB
    // If workflow.id provided, use that. Otherwise, find first active workflow.
    // =========================================================================
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let workflowConfig: WorkflowConfig | null = null;

    if (workflow?.id) {
      // Specific workflow requested
      console.log("Looking up specific workflow ID:", workflow.id);

      const { data, error } = await supabase
        .from("db_driven_enrichment_workflows")
        .select(`
          id,
          workflow_slug,
          title,
          overall_step_number,
          phase_type,
          status,
          destination_endpoint_url,
          destination_type,
          receiver_function_url,
          source_table_name,
          source_table_company_fk,
          source_table_select_columns
        `)
        .eq("id", workflow.id)
        .single();

      if (error || !data) {
        console.error("Workflow lookup error:", error);
        return new Response(
          JSON.stringify({
            error: "Workflow not found",
            workflow_id: workflow.id,
            details: error?.message
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      workflowConfig = data as WorkflowConfig;
    } else {
      // No workflow specified - find next active workflow after last_completed_step
      const stepThreshold = last_completed_step ?? 0;
      console.log(`Finding next active workflow after step ${stepThreshold}...`);

      const { data, error } = await supabase
        .from("db_driven_enrichment_workflows")
        .select(`
          id,
          workflow_slug,
          title,
          overall_step_number,
          phase_type,
          status,
          destination_endpoint_url,
          destination_type,
          receiver_function_url,
          source_table_name,
          source_table_company_fk,
          source_table_select_columns
        `)
        .eq("status", "active")
        .gt("overall_step_number", stepThreshold)
        .order("overall_step_number", { ascending: true })
        .limit(1)
        .single();

      if (error || !data) {
        // No more active workflows - pipeline complete!
        if (stepThreshold > 0) {
          console.log("Pipeline complete! No more active steps after step", stepThreshold);
          return new Response(
            JSON.stringify({
              message: "Pipeline complete",
              last_completed_step: stepThreshold,
              companies_processed: companies.length
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.error("No active workflows found:", error);
        return new Response(
          JSON.stringify({
            error: "No active workflows found",
            details: error?.message
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      workflowConfig = data as WorkflowConfig;
    }

    const config = workflowConfig;
    console.log("=== WORKFLOW SELECTED ===");
    console.log("Workflow:", config.workflow_slug);
    console.log("Title:", config.title);
    console.log("Step:", config.overall_step_number);
    console.log("Phase:", config.phase_type);
    console.log("Destination Type:", config.destination_type);

    // =========================================================================
    // STEP 2: Route based on workflow configuration
    // =========================================================================

    // Check if destination is configured
    if (!config.destination_endpoint_url) {
      // No destination - this step just logs/acknowledges (placeholder for future)
      console.log("=== NO DESTINATION CONFIGURED ===");
      console.log("Step", config.overall_step_number, "has no destination_endpoint_url");

      return new Response(
        JSON.stringify({
          message: `Step ${config.overall_step_number} "${config.title}" has no destination configured`,
          workflow_id: config.id,
          workflow_slug: config.workflow_slug,
          step_number: config.overall_step_number,
          phase_type: config.phase_type,
          companies_received: companies.length,
          hint: "Configure destination_endpoint_url to enable this workflow"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if this workflow needs source data from a table
    if (config.source_table_name && config.source_table_company_fk) {
      // =========================================================================
      // STEP 3a: Fetch source records from GTM Teaser DB
      // =========================================================================
      console.log("=== FETCHING SOURCE RECORDS ===");

      const gtmUrl = Deno.env.get("GTM_SUPABASE_URL");
      const gtmKey = Deno.env.get("GTM_SUPABASE_SERVICE_ROLE_KEY");

      if (!gtmUrl || !gtmKey) {
        return new Response(
          JSON.stringify({ error: "GTM Teaser DB credentials not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const gtmSupabase = createClient(gtmUrl, gtmKey);
      const companyIds = companies.map((c) => c.company_id);
      const selectColumns = config.source_table_select_columns || "*";

      console.log("Source table:", config.source_table_name);
      console.log("Company FK:", config.source_table_company_fk);
      console.log("Select columns:", selectColumns);

      const { data: sourceRecords, error: sourceError } = await gtmSupabase
        .from(config.source_table_name)
        .select(selectColumns)
        .in(config.source_table_company_fk, companyIds);

      if (sourceError) {
        console.error("Source query error:", sourceError);
        return new Response(
          JSON.stringify({
            error: `Failed to fetch from ${config.source_table_name}: ${sourceError.message}`,
            source_table: config.source_table_name,
            company_fk: config.source_table_company_fk
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!sourceRecords || sourceRecords.length === 0) {
        return new Response(
          JSON.stringify({
            message: `No records found in ${config.source_table_name} for selected companies`,
            workflow_slug: config.workflow_slug,
            companies_selected: companies.length,
            records_found: 0
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("Source records found:", sourceRecords.length);

      // =========================================================================
      // STEP 4: Send each record to destination (Clay) with rate limiting
      // =========================================================================
      const results: { id: string; success: boolean; error?: string }[] = [];

      for (let i = 0; i < sourceRecords.length; i++) {
        const record = sourceRecords[i] as Record<string, unknown>;

        try {
          const payload = {
            ...record,
            source_record_id: record.id,
            workflow_id: config.id,
            workflow_slug: config.workflow_slug,
            receiver_function_url: config.receiver_function_url,
          };

          const response = await fetch(config.destination_endpoint_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          const recordId = String(record.id || i);
          if (response.ok) {
            results.push({ id: recordId, success: true });
          } else {
            const errorText = await response.text();
            results.push({
              id: recordId,
              success: false,
              error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`
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

        if (i < sourceRecords.length - 1) {
          await delay(DELAY_BETWEEN_REQUESTS_MS);
        }
      }

      const successCount = results.filter((r) => r.success).length;

      return new Response(
        JSON.stringify({
          message: `Dispatched ${successCount} of ${sourceRecords.length} records`,
          workflow_id: config.id,
          workflow_slug: config.workflow_slug,
          step_number: config.overall_step_number,
          phase_type: config.phase_type,
          source_table: config.source_table_name,
          destination_url: config.destination_endpoint_url,
          records_dispatched: sourceRecords.length,
          success_count: successCount,
          fail_count: sourceRecords.length - successCount,
          results,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } else {
      // =========================================================================
      // STEP 3b: No source table - send company data directly to destination
      // This is for workflows that start fresh with just company info
      // =========================================================================
      console.log("=== DIRECT DISPATCH (No source table) ===");
      console.log("Sending", companies.length, "companies directly to destination");

      const results: { id: string; success: boolean; error?: string }[] = [];

      for (let i = 0; i < companies.length; i++) {
        const company = companies[i];

        try {
          const payload = {
            company_id: company.company_id,
            company_name: company.company_name,
            company_domain: company.company_domain,
            company_linkedin_url: company.company_linkedin_url,
            workflow_id: config.id,
            workflow_slug: config.workflow_slug,
            receiver_function_url: config.receiver_function_url,
          };

          const response = await fetch(config.destination_endpoint_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (response.ok) {
            results.push({ id: company.company_id, success: true });
          } else {
            const errorText = await response.text();
            results.push({
              id: company.company_id,
              success: false,
              error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`
            });
          }
        } catch (err) {
          results.push({
            id: company.company_id,
            success: false,
            error: err instanceof Error ? err.message : "Unknown error"
          });
        }

        if (i < companies.length - 1) {
          await delay(DELAY_BETWEEN_REQUESTS_MS);
        }
      }

      const successCount = results.filter((r) => r.success).length;

      return new Response(
        JSON.stringify({
          message: `Dispatched ${successCount} of ${companies.length} companies directly`,
          workflow_id: config.id,
          workflow_slug: config.workflow_slug,
          step_number: config.overall_step_number,
          phase_type: config.phase_type,
          destination_url: config.destination_endpoint_url,
          companies_dispatched: companies.length,
          success_count: successCount,
          fail_count: companies.length - successCount,
          results,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (err) {
    console.error("Master orchestrator error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        stack: err instanceof Error ? err.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
