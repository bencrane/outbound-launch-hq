import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("=== GENERIC ZENROWS SCRAPER ===");

    // Parse incoming payload (pass-through from dispatcher)
    const payload = await req.json();
    const workflowId = payload.workflow_id;

    if (!workflowId) {
      return new Response(
        JSON.stringify({ error: "workflow_id is required in payload" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Workflow ID:", workflowId);

    // Look up workflow config to know how to scrape
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: config, error: configError } = await supabase
      .from("db_driven_enrichment_workflows")
      .select("scrape_url_field, scrape_url_template, scraped_html_field, receiver_function_url")
      .eq("id", workflowId)
      .single();

    if (configError || !config) {
      console.error("Config lookup error:", configError);
      return new Response(
        JSON.stringify({ error: "Failed to load workflow config", details: configError?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine URL to scrape from config
    let urlToScrape: string | null = null;

    if (config.scrape_url_template) {
      // Template like "https://{company_domain}" - replace placeholders with payload values
      urlToScrape = config.scrape_url_template.replace(/\{(\w+)\}/g, (_, key) => {
        return payload[key] || "";
      });
    } else if (config.scrape_url_field && payload[config.scrape_url_field]) {
      // Direct field reference
      urlToScrape = payload[config.scrape_url_field];
    }

    if (!urlToScrape) {
      return new Response(
        JSON.stringify({
          error: "Could not determine URL to scrape",
          hint: "Configure scrape_url_template or scrape_url_field in workflow config",
          config: { scrape_url_field: config.scrape_url_field, scrape_url_template: config.scrape_url_template }
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("URL to scrape:", urlToScrape);

    // Get Zenrows API key
    const zenrowsApiKey = Deno.env.get("ZENROWS_API_KEY");
    if (!zenrowsApiKey) {
      return new Response(
        JSON.stringify({ error: "ZENROWS_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call Zenrows API
    const zenrowsUrl = new URL("https://api.zenrows.com/v1/");
    zenrowsUrl.searchParams.set("apikey", zenrowsApiKey);
    zenrowsUrl.searchParams.set("url", urlToScrape);
    zenrowsUrl.searchParams.set("js_render", "true");

    console.log("Calling Zenrows...");
    const zenrowsResponse = await fetch(zenrowsUrl.toString());

    if (!zenrowsResponse.ok) {
      const errorText = await zenrowsResponse.text();
      console.error("Zenrows error:", zenrowsResponse.status, errorText);
      return new Response(
        JSON.stringify({
          error: `Zenrows API error: ${zenrowsResponse.status}`,
          details: errorText.substring(0, 500)
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const scrapedHtml = await zenrowsResponse.text();
    console.log("Scraped HTML length:", scrapedHtml.length);

    // Build receiver payload - pass through everything + add scraped data
    const scrapedHtmlField = config.scraped_html_field || "scraped_html";
    const receiverPayload = {
      ...payload,  // Pass through all original data
      [scrapedHtmlField]: scrapedHtml,
      scraped_url: urlToScrape,
      scraped_at: new Date().toISOString(),
    };

    // Send to receiver
    const receiverUrl = config.receiver_function_url || payload.receiver_function_url;
    if (!receiverUrl) {
      return new Response(
        JSON.stringify({ error: "No receiver_function_url configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Sending to receiver:", receiverUrl);
    const receiverResponse = await fetch(receiverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(receiverPayload),
    });

    if (!receiverResponse.ok) {
      const errorText = await receiverResponse.text();
      console.error("Receiver error:", receiverResponse.status, errorText);
      return new Response(
        JSON.stringify({
          error: `Receiver error: ${receiverResponse.status}`,
          details: errorText.substring(0, 500)
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const receiverResult = await receiverResponse.json();

    return new Response(
      JSON.stringify({
        success: true,
        scraped_url: urlToScrape,
        html_length: scrapedHtml.length,
        receiver_response: receiverResult,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Zenrows scraper error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
