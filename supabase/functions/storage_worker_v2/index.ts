import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StorageRequest {
  workflow_id: string;
  company_id: string;
  company_domain: string;
  company_name?: string;
  play_name?: string;
  batch_id?: string;
  data: Record<string, unknown>;
}

interface Destination {
  db: "workspace" | "hq";
  table: string;
  fields: Record<string, string> | null; // null = store raw JSONB
  insert_mode?: "upsert" | "insert"; // default: upsert
  on_conflict?: string; // columns for upsert conflict, default: "company_domain"
}

interface DestinationConfig {
  destinations: Destination[];
}

interface WorkflowConfig {
  id: string;
  workflow_slug: string;
  play_id: string | null;
  overall_step_number: number | null;
  destination_config: DestinationConfig | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as Record<string, unknown>;
    const { workflow_id, company_id, company_domain, company_name, play_name, batch_id } = body as StorageRequest;

    // Handle both nested "data" object and flat payload formats
    // If "data" exists and is an object, use it; otherwise extract data from flat payload
    let data: Record<string, unknown>;
    if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) {
      data = body.data as Record<string, unknown>;
    } else {
      // Flat payload - extract all fields except known metadata fields
      const metadataFields = new Set([
        "workflow_id", "workflow_slug", "company_id", "company_domain", "company_name",
        "play_name", "batch_id", "source_record_id", "receiver_function_url"
      ]);
      data = {};
      for (const [key, value] of Object.entries(body)) {
        if (!metadataFields.has(key)) {
          data[key] = value;
        }
      }
    }

    if (!workflow_id || !company_id || !company_domain) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: workflow_id, company_id, company_domain" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (Object.keys(data).length === 0) {
      return new Response(
        JSON.stringify({ error: "No data fields found in payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Connect to HQ DB to get workflow config
    const hqUrl = Deno.env.get("SUPABASE_URL");
    const hqKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!hqUrl || !hqKey) {
      return new Response(
        JSON.stringify({ error: "Missing HQ database credentials" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const hqClient = createClient(hqUrl, hqKey);

    // Lookup workflow config
    const { data: config, error: configError } = await hqClient
      .from("db_driven_enrichment_workflows")
      .select("id, workflow_slug, play_id, overall_step_number, destination_config")
      .eq("id", workflow_id)
      .single();

    if (configError || !config) {
      return new Response(
        JSON.stringify({ error: "Workflow not found", workflow_id }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const workflowConfig = config as WorkflowConfig;

    if (!workflowConfig.destination_config?.destinations?.length) {
      return new Response(
        JSON.stringify({ error: "Workflow missing destination_config", workflow_id }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get workspace client (if needed)
    const workspaceUrl = Deno.env.get("WORKSPACE_URL");
    const workspaceKey = Deno.env.get("WORKSPACE_SERVICE_ROLE_KEY");

    const getClient = (db: "workspace" | "hq"): SupabaseClient => {
      if (db === "workspace") {
        if (!workspaceUrl || !workspaceKey) {
          throw new Error("Missing Workspace database credentials");
        }
        return createClient(workspaceUrl, workspaceKey);
      }
      return hqClient;
    };

    const resolvedPlayName = play_name || workflowConfig.play_id || "unknown";
    const stepNumber = workflowConfig.overall_step_number ?? 0;
    const results: Array<{ table: string; record_id: string; verified: boolean }> = [];

    // Write to each destination
    for (const dest of workflowConfig.destination_config.destinations) {
      const destClient = getClient(dest.db);

      // Build record - check if base fields have custom mappings
      // Config format is: { destination_column: source_field }
      const record: Record<string, unknown> = {};

      if (dest.fields) {
        // Check if company_id has a custom mapping (find entry where VALUE = "company_id")
        const companyIdMapping = Object.entries(dest.fields).find(([, srcField]) => srcField === "company_id");
        if (companyIdMapping) {
          record[companyIdMapping[0]] = company_id; // [0] is the dest column
        } else {
          record.company_id = company_id;
        }

        // Check if company_domain has a custom mapping
        const domainMapping = Object.entries(dest.fields).find(([, srcField]) => srcField === "company_domain");
        if (domainMapping) {
          record[domainMapping[0]] = company_domain; // [0] is the dest column
        } else {
          record.company_domain = company_domain;
        }

        // Check if company_name has a custom mapping
        if (company_name) {
          const nameMapping = Object.entries(dest.fields).find(([, srcField]) => srcField === "company_name");
          if (nameMapping) {
            record[nameMapping[0]] = company_name; // [0] is the dest column
          } else {
            record.company_name = company_name;
          }
        }

        // Map other fields according to config
        // Config format: { destination_column: source_field }
        for (const [destColumn, sourceField] of Object.entries(dest.fields)) {
          // Skip base fields we already handled
          if (["company_id", "company_domain", "company_name"].includes(sourceField as string)) {
            continue;
          }
          if (data[sourceField as string] !== undefined) {
            record[destColumn] = data[sourceField as string];
          }
        }
      } else {
        // No field mapping = use default column names + store payload as JSONB
        record.company_id = company_id;
        record.company_domain = company_domain;
        if (company_name) {
          record.company_name = company_name;
        }
        record.data = data;
      }

      // Insert or upsert based on mode
      const useInsert = dest.insert_mode === "insert";
      const conflictColumns = dest.on_conflict || "company_domain";

      let inserted: { id: string } | null = null;
      let insertError: { message: string } | null = null;

      if (useInsert) {
        // Plain insert (for tables allowing multiple rows with no unique constraint)
        const result = await destClient
          .from(dest.table)
          .insert(record)
          .select("id")
          .single();
        inserted = result.data;
        insertError = result.error;
      } else {
        // Upsert with configurable conflict columns
        const result = await destClient
          .from(dest.table)
          .upsert(record, { onConflict: conflictColumns })
          .select("id")
          .single();
        inserted = result.data;
        insertError = result.error;
      }

      if (insertError || !inserted?.id) {
        const errorMessage = insertError?.message || "Insert returned no ID";
        console.error(`Insert to ${dest.table} failed:`, errorMessage);

        await callLogger({
          company_id,
          company_domain,
          workflow_id: workflowConfig.id,
          workflow_slug: workflowConfig.workflow_slug,
          play_name: resolvedPlayName,
          step_number: stepNumber,
          batch_id,
          status: "error",
          result_table: dest.table,
          error_message: errorMessage,
        });

        return new Response(
          JSON.stringify({ error: "Insert failed", table: dest.table, details: errorMessage }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify insert
      const { data: verified, error: verifyError } = await destClient
        .from(dest.table)
        .select("id")
        .eq("id", inserted.id)
        .single();

      if (verifyError || !verified) {
        const errorMessage = `Verification failed for ${dest.table}`;
        console.error(errorMessage, { inserted_id: inserted.id, verifyError });

        await callLogger({
          company_id,
          company_domain,
          workflow_id: workflowConfig.id,
          workflow_slug: workflowConfig.workflow_slug,
          play_name: resolvedPlayName,
          step_number: stepNumber,
          batch_id,
          status: "error",
          result_table: dest.table,
          error_message: errorMessage,
        });

        return new Response(
          JSON.stringify({ error: errorMessage, inserted_id: inserted.id }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      results.push({ table: dest.table, record_id: verified.id, verified: true });
    }

    // All destinations succeeded - log success
    // Use the first destination table as the primary result_table for logging
    await callLogger({
      company_id,
      company_domain,
      workflow_id: workflowConfig.id,
      workflow_slug: workflowConfig.workflow_slug,
      play_name: resolvedPlayName,
      step_number: stepNumber,
      batch_id,
      status: "success",
      result_table: workflowConfig.destination_config.destinations[0].table,
    });

    return new Response(
      JSON.stringify({
        success: true,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Storage worker error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function callLogger(logData: {
  company_id: string;
  company_domain: string;
  workflow_id: string;
  workflow_slug: string;
  play_name: string;
  step_number: number;
  batch_id?: string;
  status: "success" | "error";
  result_table?: string;
  error_message?: string;
}): Promise<void> {
  const loggerUrl = Deno.env.get("ENRICHMENT_LOGGER_URL");

  if (!loggerUrl) {
    console.error("ENRICHMENT_LOGGER_URL not configured");
    return;
  }

  try {
    const response = await fetch(loggerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(logData),
    });

    if (!response.ok) {
      console.error("Logger call failed:", response.status, await response.text());
    }
  } catch (err) {
    console.error("Logger call error:", err);
  }
}
