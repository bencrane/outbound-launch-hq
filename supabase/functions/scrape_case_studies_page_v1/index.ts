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

interface RequestBody {
  companies: CompanyInput[];
  workflow: {
    id: string;
    slug: string;
  };
  play_name?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    const { companies, workflow, play_name } = body;

    if (!companies || companies.length === 0) {
      return new Response(
        JSON.stringify({ error: "No companies provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!workflow?.id) {
      return new Response(
        JSON.stringify({ error: "workflow.id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const zenrowsApiKey = Deno.env.get("ZENROWS_API_KEY");
    const storageWorkerUrl = Deno.env.get("STORAGE_WORKER_URL");
    const workspaceUrl = Deno.env.get("WORKSPACE_URL");
    const workspaceKey = Deno.env.get("WORKSPACE_SERVICE_ROLE_KEY");

    if (!zenrowsApiKey) {
      return new Response(
        JSON.stringify({ error: "ZENROWS_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!storageWorkerUrl) {
      return new Response(
        JSON.stringify({ error: "STORAGE_WORKER_URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!workspaceUrl || !workspaceKey) {
      return new Response(
        JSON.stringify({ error: "Workspace database credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const workspaceClient = createClient(workspaceUrl, workspaceKey);

    const results: Array<{ company_domain: string; status: string; error?: string; url?: string }> = [];

    // Process each company
    for (const company of companies) {
      try {
        // 1. Fetch the case studies page URL from Step 3 results
        const { data: urlData, error: fetchError } = await workspaceClient
          .from("company_case_studies_page")
          .select("case_studies_page_url")
          .eq("company_domain", company.company_domain)
          .single();

        if (fetchError || !urlData) {
          throw new Error(`No case studies page URL found for ${company.company_domain}. Run Step 3 first.`);
        }

        const targetUrl = urlData.case_studies_page_url;

        if (!targetUrl) {
          throw new Error(`Case studies page URL is null for ${company.company_domain}`);
        }

        // 2. Call Zenrows with the URL
        const zenrowsParams = new URLSearchParams({
          apikey: zenrowsApiKey,
          url: targetUrl,
          js_render: "true",
          premium_proxy: "true",
          proxy_country: "us",
        });

        const zenrowsResponse = await fetch(`https://api.zenrows.com/v1/?${zenrowsParams.toString()}`);

        if (!zenrowsResponse.ok) {
          throw new Error(`Zenrows returned ${zenrowsResponse.status} for ${targetUrl}`);
        }

        const htmlContent = await zenrowsResponse.text();

        // 3. Send to storage worker
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const storageResponse = await fetch(storageWorkerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": supabaseServiceKey || "",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            workflow_id: workflow.id,
            company_id: company.company_id,
            company_domain: company.company_domain,
            company_name: company.company_name,
            play_name: play_name,
            data: {
              case_studies_page_url: targetUrl,
              case_studies_page_html: htmlContent,
              scraped_at: new Date().toISOString(),
            },
          }),
        });

        if (!storageResponse.ok) {
          const errText = await storageResponse.text();
          throw new Error(`Storage worker failed: ${errText}`);
        }

        results.push({ company_domain: company.company_domain, status: "success", url: targetUrl });

      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`Error processing ${company.company_domain}:`, message);
        results.push({ company_domain: company.company_domain, status: "error", error: message });
      }
    }

    const successCount = results.filter(r => r.status === "success").length;

    return new Response(
      JSON.stringify({
        total: companies.length,
        success: successCount,
        failed: companies.length - successCount,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("scrape_case_studies_page_v1 error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
