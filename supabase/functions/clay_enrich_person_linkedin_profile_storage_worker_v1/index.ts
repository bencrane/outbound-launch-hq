import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface IncomingPayload {
  // Source record references
  source_record_id?: string;
  id?: string;
  buyer_detail_id?: string;

  // Company context
  hq_target_company_id?: string;
  hq_target_company_name?: string;
  hq_target_company_domain?: string;

  // Input (what we sent to Clay)
  contact_linkedin_url?: string;

  // Profile fields from Clay
  profile_id?: number;
  slug?: string;
  url?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  org?: string;
  headline?: string;
  summary?: string;
  country?: string;
  location_name?: string;
  connections?: number;
  num_followers?: number;
  jobs_count?: number;
  last_refresh?: string;
  education?: unknown;

  // Workflow context
  workflow_id?: string;
  workflow_slug?: string;

  [key: string]: unknown;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("=== PROFILE STORAGE WORKER ===");

    const rawBody = await req.text();
    console.log("Raw body length:", rawBody.length);

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

    // Get source record ID
    const sourceRecordId = payload.source_record_id || payload.id;
    if (!sourceRecordId) {
      return new Response(
        JSON.stringify({ error: "source_record_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Connect to GTM Teaser DB
    const gtmUrl = Deno.env.get("GTM_SUPABASE_URL");
    const gtmKey = Deno.env.get("GTM_SUPABASE_SERVICE_ROLE_KEY");

    if (!gtmUrl || !gtmKey) {
      return new Response(
        JSON.stringify({ error: "GTM DB credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gtmSupabase = createClient(gtmUrl, gtmKey);

    // Build record for insertion
    const record: Record<string, unknown> = {
      source_record_id: sourceRecordId,
      enriched_at: new Date().toISOString(),
    };

    // Source references
    if (payload.buyer_detail_id) record.buyer_detail_id = payload.buyer_detail_id;

    // Company context
    if (payload.hq_target_company_id) record.hq_target_company_id = payload.hq_target_company_id;
    if (payload.hq_target_company_name) record.hq_target_company_name = payload.hq_target_company_name;
    if (payload.hq_target_company_domain) record.hq_target_company_domain = payload.hq_target_company_domain;

    // Input
    if (payload.contact_linkedin_url) record.contact_linkedin_url = payload.contact_linkedin_url;

    // Profile fields from Clay
    if (payload.profile_id !== undefined) record.profile_id = payload.profile_id;
    if (payload.slug) record.slug = payload.slug;
    if (payload.url) record.url = payload.url;
    if (payload.name) record.name = payload.name;
    if (payload.first_name) record.first_name = payload.first_name;
    if (payload.last_name) record.last_name = payload.last_name;
    if (payload.title) record.title = payload.title;
    if (payload.org) record.org = payload.org;
    if (payload.headline) record.headline = payload.headline;
    if (payload.summary) record.summary = payload.summary;
    if (payload.country) record.country = payload.country;
    if (payload.location_name) record.location_name = payload.location_name;
    if (payload.connections !== undefined) record.connections = payload.connections;
    if (payload.num_followers !== undefined) record.num_followers = payload.num_followers;
    if (payload.jobs_count !== undefined) record.jobs_count = payload.jobs_count;
    if (payload.last_refresh) record.last_refresh = payload.last_refresh;
    if (payload.education) record.education = payload.education;

    // Workflow context
    if (payload.workflow_id) record.workflow_id = payload.workflow_id;
    if (payload.workflow_slug) record.workflow_slug = payload.workflow_slug;

    console.log("Inserting record:", JSON.stringify(record, null, 2));

    // Insert into destination table
    const { data, error: insertError } = await gtmSupabase
      .from("clay_person_enriched_linkedin_profile")
      .insert(record)
      .select()
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: insertError.message, details: insertError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Insert successful:", data);

    return new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Storage worker error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
