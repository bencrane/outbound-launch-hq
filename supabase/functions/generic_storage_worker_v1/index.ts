import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ArrayFieldConfig {
  source_array_field: string;
  destination_table: string;
  parent_fk_field: string;
  field_mappings: Record<string, string>;
}

interface WorkflowConfig {
  id: string;
  workflow_slug: string;
  overall_step_number: number | null;
  destination_table_name: string | null;
  destination_field_mappings: Record<string, string> | null;
  global_logger_function_url: string | null;
  raw_payload_table_name: string | null;
  raw_payload_field: string | null;
  array_field_configs: ArrayFieldConfig[] | null;
}

interface IncomingPayload {
  workflow_id: string;
  workflow_slug?: string;
  enrichment_provider?: string;  // For waterfall enrichment - indicates which provider returned data
  source_record_id?: string;
  hq_target_company_id?: string;
  hq_target_company_name?: string;
  hq_target_company_domain?: string;
  contact_linkedin_url?: string;
  [key: string]: unknown;
}

// Provider-specific config for waterfall enrichment
interface ProviderConfig {
  id: string;
  workflow_id: string;
  enrichment_provider: string;
  destination_table_name: string;
  destination_field_mappings: Record<string, string> | null;
  array_field_configs: ArrayFieldConfig[] | null;
  raw_payload_table_name: string | null;
  raw_payload_field: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("=== GENERIC STORAGE WORKER v2 ===");

    // Parse payload
    const rawBody = await req.text();
    if (!rawBody || rawBody.trim() === "") {
      return new Response(
        JSON.stringify({ error: "Empty request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let payload: IncomingPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Payload keys:", Object.keys(payload));

    // Require workflow_id for config lookup
    if (!payload.workflow_id) {
      return new Response(
        JSON.stringify({ error: "workflow_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Workflow ID:", payload.workflow_id);
    console.log("Enrichment provider:", payload.enrichment_provider || "(none - using workflow config)");

    // =========================================================================
    // STEP 1: Get workflow config from Outbound Launch HQ DB
    // =========================================================================
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // First, always get the base workflow config (for workflow_slug, global_logger_function_url)
    const { data: workflowConfig, error: workflowError } = await supabase
      .from("db_driven_enrichment_workflows")
      .select(`
        id,
        workflow_slug,
        overall_step_number,
        destination_table_name,
        destination_field_mappings,
        global_logger_function_url,
        raw_payload_table_name,
        raw_payload_field,
        array_field_configs
      `)
      .eq("id", payload.workflow_id)
      .single();

    if (workflowError || !workflowConfig) {
      console.error("Workflow lookup error:", workflowError);
      return new Response(
        JSON.stringify({
          error: "Workflow not found",
          workflow_id: payload.workflow_id,
          details: workflowError?.message
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Start with workflow-level config as default
    let config = workflowConfig as WorkflowConfig;
    let usingProviderConfig = false;

    // =========================================================================
    // STEP 1b: Check for provider-specific config (waterfall enrichment)
    // =========================================================================
    if (payload.enrichment_provider) {
      console.log(`Looking up provider config for: ${payload.enrichment_provider}`);

      const { data: providerConfig, error: providerError } = await supabase
        .from("workflow_provider_configs")
        .select(`
          id,
          workflow_id,
          enrichment_provider,
          destination_table_name,
          destination_field_mappings,
          array_field_configs,
          raw_payload_table_name,
          raw_payload_field
        `)
        .eq("workflow_id", payload.workflow_id)
        .eq("enrichment_provider", payload.enrichment_provider)
        .single();

      if (providerError) {
        console.log(`No provider config found for ${payload.enrichment_provider}, using workflow config`);
        // Not an error - just means we use the workflow-level config
      } else if (providerConfig) {
        console.log(`Found provider config for ${payload.enrichment_provider}`);
        // Override storage-related config with provider-specific values
        config = {
          ...config,  // Keep workflow-level fields like global_logger_function_url
          destination_table_name: providerConfig.destination_table_name,
          destination_field_mappings: providerConfig.destination_field_mappings,
          array_field_configs: providerConfig.array_field_configs,
          raw_payload_table_name: providerConfig.raw_payload_table_name,
          raw_payload_field: providerConfig.raw_payload_field,
        };
        usingProviderConfig = true;
      }
    }

    console.log("Config source:", usingProviderConfig ? `provider:${payload.enrichment_provider}` : "workflow");
    console.log("Workflow slug:", config.workflow_slug);
    console.log("Destination table:", config.destination_table_name);
    console.log("Raw payload table:", config.raw_payload_table_name);
    console.log("Array configs:", config.array_field_configs ? config.array_field_configs.length : 0);

    // Validate destination config
    if (!config.destination_table_name) {
      return new Response(
        JSON.stringify({
          error: usingProviderConfig
            ? `Provider config for ${payload.enrichment_provider} has no destination_table_name`
            : "Workflow has no destination_table_name configured",
          workflow_id: payload.workflow_id,
          workflow_slug: config.workflow_slug,
          enrichment_provider: payload.enrichment_provider
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // =========================================================================
    // STEP 2: Connect to GTM Teaser DB
    // =========================================================================
    const gtmUrl = Deno.env.get("GTM_SUPABASE_URL");
    const gtmKey = Deno.env.get("GTM_SUPABASE_SERVICE_ROLE_KEY");

    if (!gtmUrl || !gtmKey) {
      return new Response(
        JSON.stringify({ error: "GTM Teaser DB credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gtmSupabase = createClient(gtmUrl, gtmKey);

    // =========================================================================
    // STEP 3: Extract nested payload if configured
    // =========================================================================
    // If raw_payload_field is set, the nested data lives under that key
    const rawPayloadField = config.raw_payload_field || "linkedin_person_raw_payload";
    console.log("DEBUG: rawPayloadField =", rawPayloadField);
    console.log("DEBUG: payload keys =", Object.keys(payload));
    console.log("DEBUG: payload.name =", payload.name);
    console.log("DEBUG: payload.url =", payload.url);
    console.log("DEBUG: payload[rawPayloadField] exists =", !!payload[rawPayloadField]);

    const nestedPayload = payload[rawPayloadField] as Record<string, unknown> | undefined;
    console.log("DEBUG: nestedPayload exists =", !!nestedPayload);
    if (nestedPayload) {
      console.log("DEBUG: nestedPayload keys =", Object.keys(nestedPayload));
      console.log("DEBUG: nestedPayload.name =", nestedPayload.name);
    }

    // Determine source for field mappings - either nested payload or top-level payload
    const dataSource = nestedPayload || payload;

    // =========================================================================
    // STEP 4: Store raw payload if configured
    // =========================================================================
    if (config.raw_payload_table_name && nestedPayload) {
      console.log("Storing raw payload to:", config.raw_payload_table_name);

      const rawRecord = {
        source_record_id: payload.source_record_id,
        contact_linkedin_url: payload.contact_linkedin_url,
        name: nestedPayload.name || null,
        raw_payload: nestedPayload,
        workflow_id: config.id,
        workflow_slug: config.workflow_slug,
      };

      const { error: rawInsertError } = await gtmSupabase
        .from(config.raw_payload_table_name)
        .insert(rawRecord);

      if (rawInsertError) {
        console.error("Raw payload insert error:", rawInsertError);
        // Continue anyway - raw storage is optional
      } else {
        console.log("Raw payload stored successfully");
      }
    }

    // =========================================================================
    // STEP 5: Build main record based on field mappings
    // =========================================================================
    const record: Record<string, unknown> = {
      enriched_at: new Date().toISOString(),
    };

    if (config.destination_field_mappings) {
      console.log("Using field mappings for main record");

      for (const [sourceField, dbColumn] of Object.entries(config.destination_field_mappings)) {
        // Check nested payload first, then top-level payload
        let value = nestedPayload?.[sourceField];
        if (value === undefined) {
          value = payload[sourceField];
        }
        if (value !== undefined) {
          record[dbColumn] = value;
        }
      }
    } else {
      // No mappings - pass through flat fields from nested payload
      console.log("No field mappings - passing through fields");

      const excludeFields = ["receiver_function_url", "experience", "education", "certifications", "current_experience"];
      const source = nestedPayload || payload;

      for (const [key, value] of Object.entries(source)) {
        if (!excludeFields.includes(key) && value !== undefined && !Array.isArray(value)) {
          record[key] = value;
        }
      }

      // Always include context fields from top-level payload
      if (payload.source_record_id) record.source_record_id = payload.source_record_id;
      if (payload.hq_target_company_id) record.hq_target_company_id = payload.hq_target_company_id;
      if (payload.hq_target_company_name) record.hq_target_company_name = payload.hq_target_company_name;
      if (payload.hq_target_company_domain) record.hq_target_company_domain = payload.hq_target_company_domain;
      if (payload.workflow_id) record.workflow_id = payload.workflow_id;
      if (config.workflow_slug) record.workflow_slug = config.workflow_slug;
    }

    console.log("Main record fields:", Object.keys(record));

    // =========================================================================
    // STEP 6: Insert main record
    // =========================================================================
    const { data: insertedData, error: insertError } = await gtmSupabase
      .from(config.destination_table_name)
      .insert(record)
      .select()
      .single();

    if (insertError) {
      console.error("Main insert error:", insertError);

      if (config.global_logger_function_url) {
        await callGlobalLogger(config.global_logger_function_url, {
          company_id: payload.hq_target_company_id,
          company_domain: payload.hq_target_company_domain,
          workflow_id: config.id,
          workflow_slug: config.workflow_slug,
          status: "error",
          result_table: config.destination_table_name,
          error_message: insertError.message,
        });
      }

      return new Response(
        JSON.stringify({
          error: insertError.message,
          details: insertError,
          destination_table: config.destination_table_name
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const mainRecordId = insertedData?.id;
    console.log("Main record inserted:", mainRecordId);

    // =========================================================================
    // STEP 7: Process array field configs (explode arrays to separate tables)
    // =========================================================================
    const arrayResults: Record<string, { count: number; errors: string[] }> = {};

    if (config.array_field_configs && nestedPayload) {
      for (const arrayConfig of config.array_field_configs) {
        const { source_array_field, destination_table, parent_fk_field, field_mappings } = arrayConfig;

        console.log(`Processing array: ${source_array_field} -> ${destination_table}`);

        const arrayData = nestedPayload[source_array_field];

        if (!Array.isArray(arrayData)) {
          console.log(`${source_array_field} is not an array or is null, skipping`);
          arrayResults[source_array_field] = { count: 0, errors: [] };
          continue;
        }

        const errors: string[] = [];
        let insertCount = 0;

        for (const item of arrayData) {
          if (!item || typeof item !== "object") continue;

          const arrayRecord: Record<string, unknown> = {
            [parent_fk_field]: mainRecordId,
            source_record_id: payload.source_record_id,
            hq_target_company_id: payload.hq_target_company_id,
            hq_target_company_name: payload.hq_target_company_name,
            hq_target_company_domain: payload.hq_target_company_domain,
            person_name: nestedPayload?.name || payload.name,
            extracted_buyer_company: payload.extracted_buyer_company,
            workflow_id: config.id,
            workflow_slug: config.workflow_slug,
          };

          // Map fields according to config
          for (const [sourceField, dbColumn] of Object.entries(field_mappings)) {
            const value = (item as Record<string, unknown>)[sourceField];
            if (value !== undefined) {
              arrayRecord[dbColumn] = value;
            }
          }

          const { error: arrayInsertError } = await gtmSupabase
            .from(destination_table)
            .insert(arrayRecord);

          if (arrayInsertError) {
            console.error(`Array insert error (${destination_table}):`, arrayInsertError.message);
            errors.push(arrayInsertError.message);
          } else {
            insertCount++;
          }
        }

        arrayResults[source_array_field] = { count: insertCount, errors };
        console.log(`${source_array_field}: inserted ${insertCount} records`);
      }
    }

    // =========================================================================
    // STEP 8: Call global logger
    // =========================================================================
    if (config.global_logger_function_url) {
      console.log("Calling global logger");

      await callGlobalLogger(config.global_logger_function_url, {
        company_id: payload.hq_target_company_id,
        company_domain: payload.hq_target_company_domain,
        workflow_id: config.id,
        workflow_slug: config.workflow_slug,
        status: "success",
        result_table: config.destination_table_name,
        result_record_id: mainRecordId,
      });
    }

    // =========================================================================
    // STEP 9: Continue pipeline - call master_orchestrator for next step
    // =========================================================================
    if (config.overall_step_number !== null && payload.hq_target_company_id) {
      console.log(`Continuing pipeline after step ${config.overall_step_number}...`);

      const masterOrchestratorUrl = `${supabaseUrl}/functions/v1/master_orchestrator_v1`;
      try {
        const continueResponse = await fetch(masterOrchestratorUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`,
          },
          body: JSON.stringify({
            companies: [{
              company_id: payload.hq_target_company_id,
              company_name: payload.hq_target_company_name || null,
              company_domain: payload.hq_target_company_domain || null,
            }],
            last_completed_step: config.overall_step_number,
          }),
        });

        if (continueResponse.ok) {
          const continueResult = await continueResponse.json();
          console.log("Pipeline continuation triggered:", continueResult.message || "success");
        } else {
          console.error("Pipeline continuation failed:", await continueResponse.text());
        }
      } catch (continueErr) {
        console.error("Error calling master_orchestrator:", continueErr);
        // Don't fail the storage - the data is already saved
      }
    } else {
      console.log("Skipping pipeline continuation - no step number or company ID");
    }

    // =========================================================================
    // STEP 10: Return success response
    // =========================================================================
    return new Response(
      JSON.stringify({
        success: true,
        destination_table: config.destination_table_name,
        record_id: mainRecordId,
        workflow_slug: config.workflow_slug,
        overall_step_number: config.overall_step_number,
        enrichment_provider: payload.enrichment_provider || null,
        config_source: usingProviderConfig ? "provider" : "workflow",
        array_results: arrayResults,
        pipeline_continued: config.overall_step_number !== null && !!payload.hq_target_company_id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Generic storage worker error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        stack: err instanceof Error ? err.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Helper function to call global logger
async function callGlobalLogger(
  loggerUrl: string,
  logData: {
    company_id?: string;
    company_domain?: string;
    workflow_id: string;
    workflow_slug: string;
    status: string;
    result_table: string;
    result_record_id?: string;
    error_message?: string;
  }
): Promise<void> {
  try {
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("DB_ANON_KEY");

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (supabaseAnonKey) {
      headers["Authorization"] = `Bearer ${supabaseAnonKey}`;
    }

    console.log("Calling logger with data:", JSON.stringify(logData));

    const response = await fetch(loggerUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(logData),
    });

    if (!response.ok) {
      console.error("Logger call failed:", response.status, await response.text());
    } else {
      console.log("Logger call successful");
    }
  } catch (err) {
    console.error("Logger call error:", err);
  }
}
