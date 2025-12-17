import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: RequestBody = await req.json();
    const { companies, workflow } = body;

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

    const results: Array<{ company_domain: string; status: string; error?: string }> = [];

    // Process each company
    for (const company of companies) {
      try {
        // Call Zenrows
        const targetUrl = `https://${company.company_domain}`;
        const zenrowsParams = new URLSearchParams({
          apikey: zenrowsApiKey,
          url: targetUrl,
          js_render: "true",
          premium_proxy: "true",
          proxy_country: "us",
        });

        const zenrowsResponse = await fetch(`https://api.zenrows.com/v1/?${zenrowsParams.toString()}`);

        if (!zenrowsResponse.ok) {
          throw new Error(`Zenrows returned ${zenrowsResponse.status}`);
        }

        const htmlContent = await zenrowsResponse.text();

        // Send to storage worker (edge function to edge function call)
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
            data: {
              homepage_html: htmlContent,
              scraped_at: new Date().toISOString(),
            },
          }),
        });

        if (!storageResponse.ok) {
          const errText = await storageResponse.text();
          throw new Error(`Storage worker failed: ${errText}`);
        }

        results.push({ company_domain: company.company_domain, status: "success" });

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
    console.error("scrape_homepage_v1 error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
