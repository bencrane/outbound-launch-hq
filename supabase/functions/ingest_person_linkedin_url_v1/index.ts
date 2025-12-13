import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ClayPayload {
  // Required - links back to source record
  buyer_detail_id: string;
  // Company context (for easy querying)
  hq_target_company_id?: string | null;
  hq_target_company_name?: string | null;
  hq_target_company_domain?: string | null;
  // LinkedIn data from Clay
  contact_linkedin_url?: string | null;
  buyer_company_linkedin_url?: string | null;
  // Optional
  response?: string | null;
  reasoning?: string | null;
  confidence?: string | null;
  [key: string]: unknown;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("=== REQUEST ===");
    console.log("Method:", req.method);

    const rawBody = await req.text();
    console.log("Raw body:", rawBody.substring(0, 500));

    if (!rawBody || rawBody.trim() === "") {
      return new Response(
        JSON.stringify({ error: "Empty request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let payload: ClayPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Payload:", JSON.stringify(payload, null, 2));

    if (!payload.buyer_detail_id) {
      return new Response(
        JSON.stringify({ error: "buyer_detail_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gtmUrl = Deno.env.get("GTM_SUPABASE_URL");
    const gtmKey = Deno.env.get("GTM_SUPABASE_SERVICE_ROLE_KEY");

    if (!gtmUrl || !gtmKey) {
      return new Response(
        JSON.stringify({ error: "GTM DB credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gtmSupabase = createClient(gtmUrl, gtmKey);

    // Build record with essential fields + company context for easy querying
    const record: Record<string, unknown> = {
      buyer_detail_id: payload.buyer_detail_id,
      enriched_at: new Date().toISOString(),
    };

    // Company context (for easy querying without joins)
    if (payload.hq_target_company_id) record.hq_target_company_id = payload.hq_target_company_id;
    if (payload.hq_target_company_name) record.hq_target_company_name = payload.hq_target_company_name;
    if (payload.hq_target_company_domain) record.hq_target_company_domain = payload.hq_target_company_domain;

    // LinkedIn data from Clay
    if (payload.contact_linkedin_url) record.contact_linkedin_url = payload.contact_linkedin_url;
    if (payload.buyer_company_linkedin_url) record.buyer_company_linkedin_url = payload.buyer_company_linkedin_url;
    if (payload.response !== undefined) record.response = payload.response;
    if (payload.reasoning !== undefined) record.reasoning = payload.reasoning;
    if (payload.confidence !== undefined) record.confidence = payload.confidence;

    console.log("Inserting:", JSON.stringify(record, null, 2));

    const { data, error: insertError } = await gtmSupabase
      .from("buyer_linkedin_enrichments")
      .insert(record)
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update source record status
    await gtmSupabase
      .from("extracted_buyer_details_from_case_study_urls")
      .update({ linkedin_enrichment_status: "enriched" })
      .eq("id", payload.buyer_detail_id);

    return new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
