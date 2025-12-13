import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ClayPayload {
  // Pass-through data (flexible - Clay may use different field names)
  case_study_url_id?: string;
  case_study_url?: string;
  hq_target_company_id?: string;
  hq_target_company_name?: string | null;
  hq_target_company_domain?: string | null;
  customer_name?: string | null;
  workflow_id?: string;
  workflow_slug?: string;
  // Extracted data from Clay/Helium
  extracted_buyer_company?: string | null;
  extracted_contact_name?: string | null;
  extracted_contact_role?: string | null;
  // Allow any other fields Clay might send
  [key: string]: unknown;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Diagnostic logging - log everything about the request
    console.log("=== REQUEST DIAGNOSTICS ===");
    console.log("Method:", req.method);
    console.log("URL:", req.url);
    console.log("Headers:", JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2));

    // Read raw body first
    const rawBody = await req.text();
    console.log("Raw body length:", rawBody.length);
    console.log("Raw body (first 500 chars):", rawBody.substring(0, 500));

    // Check if body is empty
    if (!rawBody || rawBody.trim() === "") {
      console.error("Empty request body received");
      return new Response(
        JSON.stringify({
          error: "Empty request body",
          method: req.method,
          hint: "Clay must send a POST request with JSON body"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Try to parse JSON
    let payload: ClayPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      console.error("Body that failed to parse:", rawBody);
      return new Response(
        JSON.stringify({
          error: "Invalid JSON in request body",
          parseError: parseError instanceof Error ? parseError.message : "Unknown parse error",
          bodyPreview: rawBody.substring(0, 200)
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log parsed payload
    console.log("Parsed payload:", JSON.stringify(payload, null, 2));

    // Soft validation - log warning but don't fail
    if (!payload.case_study_url_id) {
      console.warn("Warning: case_study_url_id not provided");
    }
    if (!payload.workflow_id) {
      console.warn("Warning: workflow_id not provided");
    }

    // Connect to GTM Teaser DB to store enriched data
    const gtmUrl = Deno.env.get("GTM_SUPABASE_URL");
    const gtmKey = Deno.env.get("GTM_SUPABASE_SERVICE_ROLE_KEY");

    console.log("GTM_SUPABASE_URL configured:", !!gtmUrl);
    console.log("GTM_SUPABASE_SERVICE_ROLE_KEY configured:", !!gtmKey);

    if (!gtmUrl || !gtmKey) {
      console.error("Missing GTM credentials - GTM_SUPABASE_URL:", !!gtmUrl, "GTM_SUPABASE_SERVICE_ROLE_KEY:", !!gtmKey);
      return new Response(
        JSON.stringify({
          error: "GTM Teaser DB credentials not configured",
          details: {
            GTM_SUPABASE_URL: gtmUrl ? "set" : "missing",
            GTM_SUPABASE_SERVICE_ROLE_KEY: gtmKey ? "set" : "missing"
          }
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gtmSupabase = createClient(gtmUrl, gtmKey);

    // Store enriched data - only include fields that have values
    const enrichmentRecord: Record<string, unknown> = {
      enriched_at: new Date().toISOString(),
      source: "clay",
    };

    // Add fields if they exist in payload
    if (payload.case_study_url_id) enrichmentRecord.case_study_url_id = payload.case_study_url_id;
    if (payload.case_study_url) enrichmentRecord.case_study_url = payload.case_study_url;
    if (payload.hq_target_company_id) enrichmentRecord.hq_target_company_id = payload.hq_target_company_id;
    if (payload.hq_target_company_name) enrichmentRecord.hq_target_company_name = payload.hq_target_company_name;
    if (payload.hq_target_company_domain) enrichmentRecord.hq_target_company_domain = payload.hq_target_company_domain;
    if (payload.customer_name) enrichmentRecord.customer_name = payload.customer_name;
    if (payload.extracted_buyer_company) enrichmentRecord.extracted_buyer_company = payload.extracted_buyer_company;
    if (payload.extracted_contact_name) enrichmentRecord.extracted_contact_name = payload.extracted_contact_name;
    if (payload.extracted_contact_role) enrichmentRecord.extracted_contact_role = payload.extracted_contact_role;
    if (payload.workflow_id) enrichmentRecord.workflow_id = payload.workflow_id;
    if (payload.workflow_slug) enrichmentRecord.workflow_slug = payload.workflow_slug;

    console.log("Inserting record:", JSON.stringify(enrichmentRecord, null, 2));

    const { data: insertedData, error: insertError } = await gtmSupabase
      .from("extracted_buyer_details_from_case_study_urls")
      .insert(enrichmentRecord)
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({
          error: `Failed to store enrichment: ${insertError.message}`,
          code: insertError.code,
          details: insertError.details,
          hint: insertError.hint
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Insert successful:", insertedData);

    // Update status on original case_study_urls record (only if we have the ID)
    if (payload.case_study_url_id) {
      const { error: updateError } = await gtmSupabase
        .from("case_study_urls")
        .update({ status: "enriched" })
        .eq("id", payload.case_study_url_id);

      if (updateError) {
        console.warn("Failed to update case_study_urls status:", updateError);
      }
    }

    // Log to GTM Teaser workflow logs (in Outbound Launch HQ DB) - optional, don't fail if this fails
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);

        await supabase.from("gtm_teaser_workflow_logs").insert({
          workflow_id: payload.workflow_id || null,
          workflow_slug: payload.workflow_slug || null,
          event_type: "enrichment_received",
          source: "clay",
          record_id: payload.case_study_url_id || null,
          record_type: "case_study_url",
          hq_target_company_id: payload.hq_target_company_id || null,
          hq_target_company_name: payload.hq_target_company_name || null,
          case_study_url: payload.case_study_url || null,
          extracted_data: {
            buyer_company: payload.extracted_buyer_company || null,
            contact_name: payload.extracted_contact_name || null,
            contact_role: payload.extracted_contact_role || null,
          },
          created_at: new Date().toISOString(),
        });
      }
    } catch (logError) {
      console.warn("Failed to log to workflow logs (non-fatal):", logError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Enrichment stored successfully",
        data: insertedData,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Receiver error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
        stack: err instanceof Error ? err.stack : undefined
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
