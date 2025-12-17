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
}

interface DataGetterResponse {
  success: boolean;
  data_type: "source_records" | "company_data";
  workflow_slug: string;
  source_table: string | null;
  records: Record<string, unknown>[];
  record_count: number;
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
          receiver_function_url
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
          receiver_function_url
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
    // STEP 2: Check if destination is configured
    // =========================================================================
    if (!config.destination_endpoint_url) {
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

    // =========================================================================
    // STEP 3: Call master_db_data_getter to fetch source data
    // =========================================================================
    console.log("=== CALLING MASTER DB DATA GETTER ===");

    const dataGetterUrl = `${supabaseUrl}/functions/v1/master_db_data_getter_v1`;
    console.log("Data getter URL:", dataGetterUrl);

    const dataGetterPayload = {
      companies: companies,
      workflow_id: config.id,
    };

    const dataGetterResponse = await fetch(dataGetterUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify(dataGetterPayload),
    });

    if (!dataGetterResponse.ok) {
      const errorText = await dataGetterResponse.text();
      console.error("Data getter error:", errorText);
      return new Response(
        JSON.stringify({
          error: "Failed to fetch source data",
          data_getter_status: dataGetterResponse.status,
          details: errorText.substring(0, 500),
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const dataGetterResult: DataGetterResponse = await dataGetterResponse.json();
    console.log("Data getter response:", {
      success: dataGetterResult.success,
      data_type: dataGetterResult.data_type,
      record_count: dataGetterResult.record_count,
    });

    if (!dataGetterResult.success || dataGetterResult.record_count === 0) {
      return new Response(
        JSON.stringify({
          message: `No records to dispatch for workflow ${config.workflow_slug}`,
          workflow_id: config.id,
          workflow_slug: config.workflow_slug,
          step_number: config.overall_step_number,
          data_type: dataGetterResult.data_type,
          source_table: dataGetterResult.source_table,
          record_count: 0,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // STEP 4: Dispatch records to destination with rate limiting
    // =========================================================================
    console.log("=== DISPATCHING TO DESTINATION ===");
    console.log("Destination URL:", config.destination_endpoint_url);
    console.log("Records to dispatch:", dataGetterResult.record_count);

    const results: { id: string; success: boolean; error?: string }[] = [];
    const records = dataGetterResult.records;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      try {
        // Build the payload with workflow metadata
        const payload = {
          ...record,
          source_record_id: record.id || record.company_id,
          workflow_id: config.id,
          workflow_slug: config.workflow_slug,
          receiver_function_url: config.receiver_function_url,
          // Include hq_target_company_id for storage worker tracking
          hq_target_company_id: record.hq_target_company_id || record.company_id,
        };

        // Determine if destination is a Supabase function (needs auth)
        const isSupabaseFunction = config.destination_endpoint_url.includes("supabase.co/functions/");
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (isSupabaseFunction) {
          headers["Authorization"] = `Bearer ${supabaseKey}`;
        }

        const response = await fetch(config.destination_endpoint_url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });

        const recordId = String(record.id || record.company_id || i);
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
        const recordId = String(record.id || record.company_id || i);
        results.push({
          id: recordId,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error"
        });
      }

      // Rate limiting between requests
      if (i < records.length - 1) {
        await delay(DELAY_BETWEEN_REQUESTS_MS);
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return new Response(
      JSON.stringify({
        message: `Dispatched ${successCount} of ${records.length} records`,
        workflow_id: config.id,
        workflow_slug: config.workflow_slug,
        step_number: config.overall_step_number,
        phase_type: config.phase_type,
        data_type: dataGetterResult.data_type,
        source_table: dataGetterResult.source_table,
        destination_url: config.destination_endpoint_url,
        records_dispatched: records.length,
        success_count: successCount,
        fail_count: records.length - successCount,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

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
