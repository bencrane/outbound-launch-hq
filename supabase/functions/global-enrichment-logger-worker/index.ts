  import "jsr:@supabase/functions-js/edge-runtime.d.ts";
  import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    const body = await req.json();
    console.log("Logging enrichment:", JSON.stringify(body, null, 2));

    const {
      company_id,
      company_domain,
      workflow_id,
      workflow_slug,
      workflow_title,
      status = "success",
      result_table,
      result_record_id,
      error_message,
    } = body;

    if (!company_id || !company_domain || !workflow_slug) {
      console.log("ERROR: company_id, company_domain, and workflow_slug required");
      return new Response(
        JSON.stringify({ error: "company_id, company_domain, and workflow_slug required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.log("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return new Response(
        JSON.stringify({ error: "Server configuration error - missing credentials" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Logging: ${company_domain} -> ${workflow_slug} (${status})`);

    const { data, error } = await supabase
      .from("enrichment_logs")
      .insert({
        company_id,
        company_domain,
        workflow_id,
        workflow_slug,
        workflow_title,
        status,
        result_table,
        result_record_id,
        error_message,
      })
      .select()
      .single();

    if (error) {
      console.log("ERROR logging:", error.message);
      return new Response(
        JSON.stringify({ error: "Failed to log enrichment", details: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`SUCCESS: Logged with id ${data.id}`);

    return new Response(
      JSON.stringify({ status: "ok", log_id: data.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  });