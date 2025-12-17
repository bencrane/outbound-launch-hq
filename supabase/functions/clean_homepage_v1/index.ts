import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CompanyInput {
  company_id: string;
  company_name: string;
  company_domain: string;
}

interface WorkflowInfo {
  id: string;
  slug: string;
  title: string;
}

interface RequestBody {
  companies: CompanyInput[];
  play_name: string;
  step_number: number;
  workflow: WorkflowInfo;
  use_test_endpoint?: boolean;
}

const N8N_WEBHOOK_URL_PROD = "https://n8n-mission-control.onrender.com/webhook/n8n-jobs-manager-clean-main-case-studies-page-content";
const N8N_WEBHOOK_URL_TEST = "https://n8n-mission-control.onrender.com/webhook-test/n8n-jobs-manager-clean-main-case-studies-page-content";
const RECEIVER_URL = "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/clean_homepage_receiver_v1";

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    const { companies, play_name, step_number, workflow, use_test_endpoint } = body;

    // Select webhook URL based on test mode
    const N8N_WEBHOOK_URL = use_test_endpoint ? N8N_WEBHOOK_URL_TEST : N8N_WEBHOOK_URL_PROD;
    console.log(`Using n8n endpoint: ${use_test_endpoint ? "TEST" : "PROD"} - ${N8N_WEBHOOK_URL}`);

    if (!companies || companies.length === 0) {
      return new Response(
        JSON.stringify({ error: "No companies provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get environment variables
    const hqUrl = Deno.env.get("SUPABASE_URL");
    const hqServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const workspaceUrl = Deno.env.get("WORKSPACE_URL");
    const workspaceServiceKey = Deno.env.get("WORKSPACE_SERVICE_ROLE_KEY");

    if (!hqUrl || !hqServiceKey || !workspaceUrl || !workspaceServiceKey) {
      return new Response(
        JSON.stringify({ error: "Missing required environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase clients
    const hqClient = createClient(hqUrl, hqServiceKey);
    const workspaceClient = createClient(workspaceUrl, workspaceServiceKey);

    // 1. Create batch record
    const { data: batch, error: batchError } = await hqClient
      .from("enrichment_batches")
      .insert({
        play_name,
        step_number,
        step_name: "Clean Homepage HTML",
        provider: "n8n",
        records_sent: companies.length,
        records_received: 0,
        status: "in_progress",
      })
      .select()
      .single();

    if (batchError) {
      console.error("Error creating batch:", batchError);
      return new Response(
        JSON.stringify({ error: "Failed to create batch record", details: batchError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const batchId = batch.id;
    let sentCount = 0;
    let failedToSend = 0;
    const results: Array<{ company_domain: string; status: string; error?: string }> = [];

    // 2. Fire off requests to n8n for each company (don't wait for processing)
    for (const company of companies) {
      try {
        // First, fetch the raw HTML from Workspace DB (from Step 1)
        const { data: scrapeData, error: scrapeError } = await workspaceClient
          .from("company_homepage_scrapes")
          .select("homepage_html")
          .eq("company_domain", company.company_domain)
          .single();

        if (scrapeError || !scrapeData) {
          throw new Error(`No scraped HTML found for ${company.company_domain}. Run Step 1 first.`);
        }

        // Fire to n8n with callback info (don't await the processing result)
        const n8nPayload = {
          raw_html: scrapeData.homepage_html,
          company_id: company.company_id,
          company_name: company.company_name,
          company_domain: company.company_domain,
          play_name,
          step_number,
          batch_id: batchId,
          workflow: {
            id: workflow.id,
            slug: workflow.slug,
            title: workflow.title,
          },
          callback_url: RECEIVER_URL,
        };

        // Fire and don't wait for n8n to finish processing
        fetch(N8N_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(n8nPayload),
        }).catch(err => {
          console.error(`Failed to send to n8n for ${company.company_domain}:`, err);
        });

        sentCount++;
        results.push({ company_domain: company.company_domain, status: "sent" });

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.error(`Error preparing ${company.company_domain}:`, errorMessage);

        // Log failure to send
        await hqClient.from("enrichment_results_log").insert({
          batch_id: batchId,
          company_id: company.company_id,
          company_domain: company.company_domain,
          play_name,
          step_number,
          status: "failed",
          error_message: errorMessage,
        });

        failedToSend++;
        results.push({ company_domain: company.company_domain, status: "failed", error: errorMessage });
      }
    }

    return new Response(
      JSON.stringify({
        batch_id: batchId,
        total: companies.length,
        sent: sentCount,
        failed_to_send: failedToSend,
        message: "Requests sent to n8n. Results will be stored via callback.",
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("Error in clean_homepage_v1:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
