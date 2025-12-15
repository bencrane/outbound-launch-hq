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

interface WorkflowConfig {
  id: string;
  workflow_slug: string;
  title: string | null;
  overall_step_number: number | null;
  source_table_name: string | null;
  source_table_company_fk: string | null;
  source_table_select_columns: string | null;
}

interface RequestBody {
  companies: CompanyInput[];
  workflow_config: WorkflowConfig;
}

/**
 * MASTER DB DATA GETTER v1
 *
 * This edge function is called by master_orchestrator_v1 to fetch source data
 * from the GTM Teaser DB based on workflow configuration.
 *
 * Flow:
 * 1. Receives workflow config + company IDs from orchestrator
 * 2. If workflow has source_table_name configured:
 *    - Queries GTM Teaser DB for records matching company IDs
 *    - Returns those records
 * 3. If no source table (e.g., Step 1):
 *    - Returns the company data as-is (nothing extra to fetch)
 *
 * The orchestrator then dispatches the returned data to the destination.
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("=== MASTER DB DATA GETTER v1 ===");
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

    const { companies, workflow_config } = requestBody;

    // Validate input
    if (!companies || !Array.isArray(companies) || companies.length === 0) {
      return new Response(
        JSON.stringify({ error: "companies array is required and must not be empty" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!workflow_config) {
      return new Response(
        JSON.stringify({ error: "workflow_config is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = workflow_config;
    console.log("Workflow:", config.workflow_slug);
    console.log("Step:", config.overall_step_number);
    console.log("Companies count:", companies.length);
    console.log("Source table:", config.source_table_name || "(none - direct company dispatch)");

    // =========================================================================
    // CASE 1: Workflow has a source table - fetch records from GTM DB
    // =========================================================================
    if (config.source_table_name && config.source_table_company_fk) {
      console.log("=== FETCHING SOURCE RECORDS FROM GTM DB ===");

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
      console.log("Company IDs:", companyIds);

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

      console.log("Source records found:", sourceRecords?.length || 0);

      // Return the fetched records
      return new Response(
        JSON.stringify({
          success: true,
          data_type: "source_records",
          workflow_slug: config.workflow_slug,
          source_table: config.source_table_name,
          records: sourceRecords || [],
          record_count: sourceRecords?.length || 0,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // CASE 2: No source table - return company data as-is
    // This is for workflows that start fresh (like Step 1: Scrape Homepage)
    // =========================================================================
    console.log("=== NO SOURCE TABLE - RETURNING COMPANY DATA ===");

    // Return the companies as records (they are the source data)
    const records = companies.map((company) => ({
      company_id: company.company_id,
      company_name: company.company_name,
      company_domain: company.company_domain,
      company_linkedin_url: company.company_linkedin_url,
    }));

    return new Response(
      JSON.stringify({
        success: true,
        data_type: "company_data",
        workflow_slug: config.workflow_slug,
        source_table: null,
        records: records,
        record_count: records.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Master DB data getter error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        stack: err instanceof Error ? err.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
