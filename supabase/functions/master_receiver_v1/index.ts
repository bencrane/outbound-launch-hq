import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface IncomingPayload {
  workflow_id: string;
  workflow_slug?: string;
  [key: string]: unknown;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("=== MASTER RECEIVER ===");
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
    const { data: workflowConfig, error: workflowError } = await supabase
      .from("db_driven_enrichment_workflows")
      .select("id, workflow_slug, storage_worker_function_url")
      .eq("id", payload.workflow_id)
      .single();

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

    console.log("Found workflow:", workflowConfig.workflow_slug);
    console.log("Storage worker URL:", workflowConfig.storage_worker_function_url);

    if (!workflowConfig.storage_worker_function_url) {
      console.error("No storage_worker_function_url configured for workflow");
      return new Response(
        JSON.stringify({
          error: "Workflow has no storage_worker_function_url configured",
          workflow_id: payload.workflow_id,
          workflow_slug: workflowConfig.workflow_slug
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Forward the entire payload to the storage worker
    console.log("Forwarding to storage worker...");

    const storageResponse = await fetch(workflowConfig.storage_worker_function_url, {
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
    console.error("Master receiver error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        stack: err instanceof Error ? err.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
