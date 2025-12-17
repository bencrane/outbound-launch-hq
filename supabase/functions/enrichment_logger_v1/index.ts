import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LogRequest {
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
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: LogRequest = await req.json();

    const {
      company_id,
      company_domain,
      workflow_id,
      workflow_slug,
      play_name,
      step_number,
      batch_id,
      status,
      result_table,
      error_message,
    } = body;

    // Validate required fields
    if (!company_id || !company_domain || !workflow_id || !workflow_slug || !play_name || step_number === undefined) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: company_id, company_domain, workflow_id, workflow_slug, play_name, step_number"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Connect to HQ DB
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(
        JSON.stringify({ error: "Missing database credentials" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Insert into enrichment_results_log (always)
    const { data: logData, error: logError } = await supabase
      .from("enrichment_results_log")
      .insert({
        batch_id: batch_id || null,
        company_id,
        company_domain,
        play_name,
        step_number,
        status,
        result_table: result_table || null,
        error_message: error_message || null,
        stored_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (logError) {
      console.error("Failed to insert into enrichment_results_log:", logError);
      return new Response(
        JSON.stringify({ error: "Failed to insert enrichment_results_log", details: logError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Insert into company_play_step_completions (only on success)
    if (status === "success") {
      const { error: completionError } = await supabase
        .from("company_play_step_completions")
        .insert({
          company_id,
          play_name,
          step_number,
          workflow_slug,
          completed_at: new Date().toISOString(),
        });

      if (completionError) {
        console.error("Failed to insert into company_play_step_completions:", completionError);
        // Log error but don't fail the request - the main log was successful
      }
    }

    return new Response(
      JSON.stringify({ success: true, log_id: logData.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Logger error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
