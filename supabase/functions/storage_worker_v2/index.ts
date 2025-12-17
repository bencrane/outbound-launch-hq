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
    const body: StorageRequest = await req.json();
    const { workflow_id, company_id, company_domain, company_name, play_name, batch_id, data } = body;

    if (!workflow_id || !company_id || !company_domain || !data) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: workflow_id, company_id, company_domain, data" }),
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

      // Build record
      const record: Record<string, unknown> = {
        company_id,
        company_domain,
      };

      if (company_name) {
        record.company_name = company_name;
      }

      if (dest.fields) {
        // Map fields according to config
        for (const [sourceField, destColumn] of Object.entries(dest.fields)) {
          if (data[sourceField] !== undefined) {
            record[destColumn] = data[sourceField];
          }
        }
      } else {
        // No field mapping = store entire payload as JSONB
        record.data = data;
      }

      // Upsert record
      const { data: inserted, error: insertError } = await destClient
        .from(dest.table)
        .upsert(record, { onConflict: "company_domain" })
        .select("id")
        .single();

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
