import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface IncomingPayload {
  workflow_id: string;
  workflow_slug?: string;
  people?: unknown[];  // For find contacts workflow - array of found people
  [key: string]: unknown;
}

interface WorkflowConfig {
  id: string;
  workflow_slug: string;
  destination_config: {
    storage_worker_function_url?: string;
    source_record_array_field?: string;  // e.g., "people" - if set, iterate over this array
  } | null;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("=== CLAY RECEIVER V1 ===");
    console.log("Method:", req.method);

    // Read raw body
    const rawBody = await req.text();
    console.log("Raw body length:", rawBody.length);
    console.log("Raw body (first 500 chars):", rawBody.substring(0, 500));

    if (!rawBody || rawBody.trim() === "") {
      console.error("Empty request body");
      return new Response(
        JSON.stringify({ error: "Empty request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse JSON
    let payload: IncomingPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return new Response(
        JSON.stringify({ error: "Invalid JSON", details: parseError instanceof Error ? parseError.message : "Unknown" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Parsed payload keys:", Object.keys(payload));
    console.log("workflow_id:", payload.workflow_id);
    console.log("workflow_slug:", payload.workflow_slug);

    // Require workflow_id for routing
    if (!payload.workflow_id) {
      console.error("Missing workflow_id in payload");
      return new Response(
        JSON.stringify({
          error: "workflow_id is required for routing",
          hint: "Ensure dispatcher includes workflow_id in payload sent to Clay"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Connect to Outbound Launch HQ DB to look up workflow config
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Look up storage worker URL for this workflow
    // Only select columns that exist: id, workflow_slug, destination_config
    const { data: workflowConfig, error: workflowError } = await supabase
      .from("db_driven_enrichment_workflows")
      .select("id, workflow_slug, destination_config")
      .eq("id", payload.workflow_id)
      .single() as { data: WorkflowConfig | null; error: unknown };

    if (workflowError || !workflowConfig) {
      console.error("Workflow lookup error:", workflowError);
      return new Response(
        JSON.stringify({
          error: `Workflow not found: ${payload.workflow_id}`,
          details: workflowError?.message
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract storage worker URL from destination_config
    const storageWorkerUrl = workflowConfig.destination_config?.storage_worker_function_url;

    console.log("Found workflow:", workflowConfig.workflow_slug);
    console.log("Storage worker URL:", storageWorkerUrl);

    if (!storageWorkerUrl) {
      console.error("No storage_worker_function_url configured for workflow");
      return new Response(
        JSON.stringify({
          error: "Workflow has no storage_worker_function_url in destination_config",
          workflow_id: payload.workflow_id,
          workflow_slug: workflowConfig.workflow_slug,
          hint: "Set destination_config.storage_worker_function_url in db_driven_enrichment_workflows"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if we need to iterate over an array field (e.g., "people" for find contacts)
    // Support nested paths like "find_contacts_payload.people"
    const arrayFieldPath = workflowConfig.destination_config?.source_record_array_field;

    // Helper to get nested value by dot-separated path
    const getNestedValue = (obj: Record<string, unknown>, path: string): unknown => {
      const parts = path.split(".");
      let current: unknown = obj;
      for (const part of parts) {
        if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
          current = (current as Record<string, unknown>)[part];
        } else {
          return undefined;
        }
      }
      return current;
    };

    const arrayData = arrayFieldPath ? getNestedValue(payload, arrayFieldPath) : undefined;
    console.log("DEBUG: arrayFieldPath =", arrayFieldPath);
    console.log("DEBUG: arrayData exists =", !!arrayData);
    console.log("DEBUG: arrayData is array =", Array.isArray(arrayData));

    if (arrayFieldPath && Array.isArray(arrayData)) {
      // ARRAY MODE: Iterate over each item and call storage worker separately
      console.log(`Array mode: iterating over ${arrayFieldPath} (${(arrayData as unknown[]).length} items)`);

      const items = arrayData as Record<string, unknown>[];
      const results: Array<{ index: number; status: number; response: unknown }> = [];

      // Extract context fields from the top-level payload (everything except the array container)
      // For "find_contacts_payload.people", exclude "find_contacts_payload"
      const arrayParentField = arrayFieldPath.split(".")[0];
      const contextFields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(payload)) {
        if (key !== arrayParentField && !Array.isArray(value)) {
          contextFields[key] = value;
        }
      }
      console.log("Context fields to pass through:", Object.keys(contextFields));

      // Process each item in the array
      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Merge context fields with the individual item
        // Spread the item data at the top level so field mappings work correctly
        // e.g., name, title, url from the person become top-level fields
        const itemPayload = {
          ...contextFields,
          ...item,  // Spread person data at top level for field mappings
          // Also keep raw copy for raw_payloads table storage
          linkedin_person_raw_payload: item,
        };

        console.log(`Processing item ${i + 1}/${items.length}: ${item.name || "unknown"}`);
        console.log("DEBUG: item keys =", Object.keys(item));
        console.log("DEBUG: item.name =", item.name);
        console.log("DEBUG: item.url =", item.url);
        console.log("DEBUG: itemPayload keys =", Object.keys(itemPayload));
        console.log("DEBUG: itemPayload.linkedin_person_raw_payload exists =", !!itemPayload.linkedin_person_raw_payload);

        try {
          const storageResponse = await fetch(storageWorkerUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(itemPayload),
          });

          const responseText = await storageResponse.text();
          let responseData: unknown;
          try {
            responseData = JSON.parse(responseText);
          } catch {
            responseData = { raw: responseText };
          }

          results.push({
            index: i,
            status: storageResponse.status,
            response: responseData,
          });

          if (!storageResponse.ok) {
            console.error(`Item ${i} failed:`, responseText.substring(0, 200));
          }
        } catch (err) {
          console.error(`Item ${i} error:`, err);
          results.push({
            index: i,
            status: 500,
            response: { error: err instanceof Error ? err.message : "Unknown error" },
          });
        }
      }

      const successCount = results.filter(r => r.status === 200).length;
      console.log(`Array processing complete: ${successCount}/${items.length} succeeded`);

      return new Response(
        JSON.stringify({
          routed: true,
          array_mode: true,
          workflow_id: payload.workflow_id,
          workflow_slug: workflowConfig.workflow_slug,
          total_items: items.length,
          success_count: successCount,
          results,
        }),
        {
          status: successCount === items.length ? 200 : 207, // 207 Multi-Status if partial
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // SINGLE RECORD MODE: Forward the entire payload to the storage worker as-is
    console.log("Single record mode: forwarding to storage worker...");

    const storageResponse = await fetch(storageWorkerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: rawBody, // Forward the original payload as-is
    });

    const storageResponseText = await storageResponse.text();
    console.log("Storage worker response status:", storageResponse.status);
    console.log("Storage worker response:", storageResponseText.substring(0, 500));

    // Parse storage worker response if JSON
    let storageResponseData: unknown;
    try {
      storageResponseData = JSON.parse(storageResponseText);
    } catch {
      storageResponseData = { raw: storageResponseText };
    }

    // Return the storage worker's response, wrapped with routing info
    return new Response(
      JSON.stringify({
        routed: true,
        workflow_id: payload.workflow_id,
        workflow_slug: workflowConfig.workflow_slug,
        storage_worker_status: storageResponse.status,
        storage_worker_response: storageResponseData,
      }),
      {
        status: storageResponse.ok ? 200 : storageResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (err) {
    console.error("Clay receiver error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        stack: err instanceof Error ? err.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
