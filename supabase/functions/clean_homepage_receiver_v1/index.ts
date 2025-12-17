import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  company_id: string;
  company_name?: string;
  company_domain: string;
  cleaned_content?: string;
  links?: Array<{ href: string; text: string }>;
  compact_html?: string;
  play_name: string;
  step_number: number;
  batch_id?: string;
  workflow: {
    id: string;
    slug: string;
    title: string;
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    const {
      company_id,
      company_name,
      company_domain,
      cleaned_content,
      links,
      compact_html,
      play_name,
      step_number,
      batch_id,
      workflow
    } = body;

    if (!company_id || !company_domain) {
      return new Response(
        JSON.stringify({ error: "company_id and company_domain are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!workflow?.id) {
      return new Response(
        JSON.stringify({ error: "workflow.id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get storage worker URL
    const storageWorkerUrl = Deno.env.get("STORAGE_WORKER_URL");
    if (!storageWorkerUrl) {
      return new Response(
        JSON.stringify({ error: "STORAGE_WORKER_URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build data payload for storage worker
    // These field names will be mapped by storage_worker_v2 using destination_field_mappings
    const data: Record<string, unknown> = {};
    if (cleaned_content !== undefined) data.cleaned_content = cleaned_content;
    if (links !== undefined) data.links = links;
    if (compact_html !== undefined) data.compact_html = compact_html;

    // Call storage_worker_v2 - it handles:
    // 1. Looking up workflow config
    // 2. Mapping fields per destination_field_mappings
    // 3. Inserting into destination table
    // 4. VERIFYING insert succeeded
    // 5. Calling enrichment_logger_v1 (which writes to enrichment_results_log + company_play_step_completions)
    const storageResponse = await fetch(storageWorkerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow_id: workflow.id,
        company_id,
        company_domain,
        company_name,
        play_name,
        batch_id,
        data,
      }),
    });

    const storageResult = await storageResponse.json();

    // Update batch tracking AFTER storage attempt
    // This is separate from record completion - we're tracking that we received the callback
    if (batch_id) {
      await updateBatchTracking(batch_id, storageResponse.ok);
    }

    // Return storage result to caller
    if (!storageResponse.ok) {
      console.error("Storage worker failed:", storageResult);
      return new Response(
        JSON.stringify({
          success: false,
          company_domain,
          error: storageResult.error || "Storage failed",
          details: storageResult,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        company_domain,
        message: "Cleaned data stored and verified successfully",
        record_id: storageResult.record_id,
        verified: storageResult.verified,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("Error in clean_homepage_receiver_v1:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Updates batch tracking after receiving a callback.
 * This is SEPARATE from record completion - it tracks that we received the callback,
 * regardless of whether storage succeeded or failed.
 */
async function updateBatchTracking(batchId: string, storageSucceeded: boolean): Promise<void> {
  const hqUrl = Deno.env.get("SUPABASE_URL");
  const hqServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!hqUrl || !hqServiceKey) {
    console.error("Missing HQ database credentials for batch tracking");
    return;
  }

  const hqClient = createClient(hqUrl, hqServiceKey);

  try {
    // Fetch current batch state
    const { data: batchData, error: batchFetchError } = await hqClient
      .from("enrichment_batches")
      .select("records_received, records_sent")
      .eq("id", batchId)
      .single();

    if (batchFetchError) {
      console.error("Error fetching batch:", batchFetchError);
      return;
    }

    if (!batchData) {
      console.error("Batch not found:", batchId);
      return;
    }

    const newReceived = (batchData.records_received || 0) + 1;
    const isComplete = newReceived >= batchData.records_sent;

    // Update batch record
    const { error: batchUpdateError } = await hqClient
      .from("enrichment_batches")
      .update({
        records_received: newReceived,
        status: isComplete ? "completed" : "in_progress",
        completed_at: isComplete ? new Date().toISOString() : null,
      })
      .eq("id", batchId);

    if (batchUpdateError) {
      console.error("Error updating batch:", batchUpdateError);
    } else {
      console.log(`Batch ${batchId} updated: received=${newReceived}, complete=${isComplete}`);
    }
  } catch (err) {
    console.error("Error in batch tracking:", err);
  }
}
