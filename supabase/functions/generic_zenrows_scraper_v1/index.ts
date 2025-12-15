import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * GENERIC ZENROWS SCRAPER v1
 *
 * This edge function scrapes a URL using the ZenRows API.
 * It constructs the URL from company_domain in the payload.
 *
 * Expected payload fields:
 * - company_domain: The domain to scrape (e.g., "securitypalhq.com")
 * - workflow_id: For tracking
 * - workflow_slug: For tracking
 * - receiver_function_url: Where to send the scraped data
 * - hq_target_company_id: Company ID for storage tracking
 *
 * The scraper:
 * 1. Constructs URL as https://{company_domain}
 * 2. Calls ZenRows API to scrape the page
 * 3. Sends scraped HTML + original payload to receiver
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("=== GENERIC ZENROWS SCRAPER v1 ===");

    // Parse incoming payload (pass-through from orchestrator)
    const payload = await req.json();

    console.log("Received payload keys:", Object.keys(payload));
    console.log("company_domain:", payload.company_domain);
    console.log("workflow_slug:", payload.workflow_slug);

    // Get company_domain to construct URL
    const companyDomain = payload.company_domain;
    if (!companyDomain) {
      return new Response(
        JSON.stringify({
          error: "company_domain is required in payload",
          received_keys: Object.keys(payload)
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Construct URL to scrape (homepage)
    const urlToScrape = `https://${companyDomain}`;
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
    const receiverPayload = {
      ...payload,  // Pass through all original data
      scraped_html: scrapedHtml,
      scraped_url: urlToScrape,
      scraped_at: new Date().toISOString(),
    };

    // Send to receiver
    const receiverUrl = payload.receiver_function_url;
    if (!receiverUrl) {
      return new Response(
        JSON.stringify({
          error: "No receiver_function_url in payload",
          hint: "Orchestrator should include receiver_function_url from workflow config"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Sending to receiver:", receiverUrl);

    // Add auth for Supabase functions
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const isSupabaseFunction = receiverUrl.includes("supabase.co/functions/");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (isSupabaseFunction && supabaseKey) {
      headers["Authorization"] = `Bearer ${supabaseKey}`;
    }

    const receiverResponse = await fetch(receiverUrl, {
      method: "POST",
      headers,
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
