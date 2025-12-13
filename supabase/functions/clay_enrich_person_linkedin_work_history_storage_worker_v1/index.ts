import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WorkHistoryEntry {
  url?: string;
  title?: string;
  org_id?: number;
  company?: string;
  summary?: string;
  end_date?: string;
  locality?: string;
  company_id?: string;
  is_current?: boolean;
  start_date?: string;
  company_domain?: string;
}

interface IncomingPayload {
  // Source record references
  source_record_id?: string;
  id?: string;
  buyer_detail_id?: string;

  // Company context (target company, not job company)
  hq_target_company_id?: string;
  hq_target_company_name?: string;
  hq_target_company_domain?: string;

  // Work history - can be array or single entry
  experience?: WorkHistoryEntry[];
  work_history?: WorkHistoryEntry[];

  // Or individual fields if sent as single entry
  url?: string;
  title?: string;
  org_id?: number;
  company?: string;
  summary?: string;
  end_date?: string;
  locality?: string;
  company_id?: string;
  is_current?: boolean;
  start_date?: string;
  company_domain?: string;

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
    console.log("=== WORK HISTORY STORAGE WORKER ===");

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

    // Determine work history entries
    let entries: WorkHistoryEntry[] = [];

    if (payload.experience && Array.isArray(payload.experience)) {
      entries = payload.experience;
    } else if (payload.work_history && Array.isArray(payload.work_history)) {
      entries = payload.work_history;
    } else if (payload.company || payload.title) {
      // Single entry sent as flat fields
      entries = [{
        url: payload.url,
        title: payload.title,
        org_id: payload.org_id,
        company: payload.company,
        summary: payload.summary,
        end_date: payload.end_date,
        locality: payload.locality,
        company_id: payload.company_id,
        is_current: payload.is_current,
        start_date: payload.start_date,
        company_domain: payload.company_domain,
      }];
    }

    if (entries.length === 0) {
      return new Response(
        JSON.stringify({
          message: "No work history entries found in payload",
          source_record_id: sourceRecordId
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${entries.length} work history entries`);

    // Build records for insertion
    const records = entries.map(entry => ({
      source_record_id: sourceRecordId,
      buyer_detail_id: payload.buyer_detail_id || null,
      hq_target_company_id: payload.hq_target_company_id || null,
      hq_target_company_name: payload.hq_target_company_name || null,
      hq_target_company_domain: payload.hq_target_company_domain || null,
      url: entry.url || null,
      title: entry.title || null,
      org_id: entry.org_id || null,
      company: entry.company || null,
      summary: entry.summary || null,
      end_date: entry.end_date || null,
      locality: entry.locality || null,
      company_id: entry.company_id || null,
      is_current: entry.is_current || false,
      start_date: entry.start_date || null,
      company_domain: entry.company_domain || null,
      workflow_id: payload.workflow_id || null,
      workflow_slug: payload.workflow_slug || null,
      enriched_at: new Date().toISOString(),
    }));

    console.log("Inserting records:", JSON.stringify(records, null, 2));

    // Insert all records
    const { data, error: insertError } = await gtmSupabase
      .from("clay_person_enriched_linkedin_work_history")
      .insert(records)
      .select();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: insertError.message, details: insertError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Insert successful: ${data?.length || 0} rows`);

    return new Response(
      JSON.stringify({
        success: true,
        rows_inserted: data?.length || 0,
        source_record_id: sourceRecordId,
        data
      }),
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
