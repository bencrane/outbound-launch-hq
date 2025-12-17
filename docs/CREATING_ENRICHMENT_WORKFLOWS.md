# Creating Enrichment Workflows

This document defines the correct process for creating new enrichment workflows in the Outbound Launch HQ + GTM Teaser system.

**Last updated:** 2025-12-17

---

## Architecture Overview

Every enrichment workflow follows this pattern:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER ACTION                                    │
│                    (clicks "Run Step 1" in UI)                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     WORKFLOW-SPECIFIC FUNCTION                           │
│                        (e.g., scrape_homepage_v1)                        │
│                                                                          │
│  - Knows HOW to call the external API (Zenrows, n8n, Clay, etc.)         │
│  - Receives { companies, workflow: { id, slug } }                        │
│  - Calls external API for each company                                   │
│  - POSTs result to storage_worker_v2                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        STORAGE WORKER                                    │
│                       (storage_worker_v2)                                │
│                                                                          │
│  - GENERIC - works for ALL workflows                                     │
│  - Looks up workflow config from db_driven_enrichment_workflows          │
│  - Stores data to destination table per config                           │
│  - Calls enrichment_logger_v1 with result                                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           LOGGER                                         │
│                    (enrichment_logger_v1)                                │
│                                                                          │
│  - GENERIC - same for ALL workflows                                      │
│  - Writes to enrichment_results_log (always)                             │
│  - Writes to company_play_step_completions (on success)                  │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key principles:**
1. **Workflow ID is the key** - All routing and config comes from the workflow ID
2. **DB is source of truth** - No hardcoded table names in functions
3. **Separation of concerns** - Each function has ONE job
4. **Shared infrastructure** - All workflows use the same storage worker and logger

---

## Two Databases

| Database | Purpose | Examples |
|----------|---------|----------|
| **HQ (Outbound Launch HQ)** | Orchestration, config, logging | `companies`, `db_driven_enrichment_workflows`, `enrichment_results_log` |
| **Workspace (GTM Teaser)** | Enrichment data storage | `company_homepage_scrapes`, `company_homepage_cleaned` |

---

## Logging Tables (ALWAYS write to these)

| Table | Purpose | When Written |
|-------|---------|--------------|
| `enrichment_results_log` | Records every enrichment result (success or error) | Always |
| `company_play_step_completions` | Tracks which steps each company has completed | On success only |

**NOT used:** `enrichment_logs` (this is legacy/outdated)

---

## Creating a New Workflow: Step-by-Step

### Step 1: Add Workflow Config to Database

Insert a row into `db_driven_enrichment_workflows` in the HQ database:

```bash
API_KEY="your-outbound-launch-anon-key"

curl -s -X POST "https://wvjhddcwpedmkofmhfcp.supabase.co/rest/v1/db_driven_enrichment_workflows" \
  -H "apikey: $API_KEY" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "title": "Scrape Homepage",
    "workflow_slug": "scrape-homepage-via-zenrows",
    "description": "Scrapes company homepage HTML using Zenrows",
    "status": "active",
    "play_id": "case-studies-play",
    "overall_step_number": 1,
    "provider": "zenrows",
    "destination_db": "workspace",
    "destination_table_name": "company_homepage_scrapes",
    "destination_field_mappings": {
      "homepage_html": "homepage_html",
      "scraped_at": "scraped_at"
    }
  }'
```

**Required fields for storage worker:**
- `destination_db`: "workspace" or "hq"
- `destination_table_name`: Table to insert enrichment data
- `destination_field_mappings`: How to map input fields to DB columns

**Required fields for logger:**
- `play_id`: Used as play_name for logging (e.g., "case-studies-play")
- `overall_step_number`: Step number in the pipeline

### Step 2: Create Destination Table

Create the destination table in the appropriate database:

```sql
-- In Workspace (GTM Teaser) DB
CREATE TABLE company_homepage_scrapes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID,
  company_domain TEXT,
  company_name TEXT,
  homepage_html TEXT,
  scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_homepage_scrapes_company ON company_homepage_scrapes(company_id);
CREATE INDEX idx_homepage_scrapes_domain ON company_homepage_scrapes(company_domain);
```

### Step 3: Create Workflow-Specific Edge Function

Create the edge function that knows HOW to call the external API.

**File:** `supabase/functions/{workflow_name}/index.ts`

```typescript
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

    const storageWorkerUrl = Deno.env.get("STORAGE_WORKER_URL");
    if (!storageWorkerUrl) {
      return new Response(
        JSON.stringify({ error: "STORAGE_WORKER_URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: Array<{ company_domain: string; status: string; error?: string }> = [];

    for (const company of companies) {
      try {
        // =====================================================
        // YOUR ENRICHMENT LOGIC HERE
        // Call external API (Zenrows, n8n, Clay, etc.)
        // =====================================================
        const enrichmentData = await callExternalApi(company);

        // Send to storage worker
        const storageResponse = await fetch(storageWorkerUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workflow_id: workflow.id,
            company_id: company.company_id,
            company_domain: company.company_domain,
            company_name: company.company_name,
            data: enrichmentData,
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

    return new Response(
      JSON.stringify({
        total: companies.length,
        success: results.filter(r => r.status === "success").length,
        failed: results.filter(r => r.status === "error").length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Function error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Replace with your actual API call
async function callExternalApi(company: CompanyInput): Promise<Record<string, unknown>> {
  // Example: Zenrows
  const apiKey = Deno.env.get("ZENROWS_API_KEY");
  const response = await fetch(`https://api.zenrows.com/v1/?apikey=${apiKey}&url=https://${company.company_domain}`);
  const html = await response.text();
  return {
    homepage_html: html,
    scraped_at: new Date().toISOString(),
  };
}
```

### Step 4: Deploy the Edge Function

**ALWAYS deploy with `--no-verify-jwt`** for internal functions:

```bash
supabase functions deploy {function_name} --no-verify-jwt
```

Example:
```bash
supabase functions deploy scrape_homepage_v1 --no-verify-jwt
```

### Step 5: Set Environment Variables

The storage worker and logger need these environment variables:

```bash
# Set on all edge functions that call storage_worker_v2
supabase secrets set STORAGE_WORKER_URL=https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/storage_worker_v2

# Set on storage_worker_v2
supabase secrets set ENRICHMENT_LOGGER_URL=https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/enrichment_logger_v1
supabase secrets set WORKSPACE_URL=https://kwxdezafluqhcmovnwbn.supabase.co
supabase secrets set WORKSPACE_SERVICE_ROLE_KEY=your-workspace-service-role-key
```

---

## Storage Worker Input Format

The storage worker expects this payload:

```typescript
{
  workflow_id: string;        // Required - used to lookup config
  company_id: string;         // Required
  company_domain: string;     // Required
  company_name?: string;      // Optional
  play_name?: string;         // Optional - falls back to play_id from config
  batch_id?: string;          // Optional - for batch tracking
  data: Record<string, any>;  // The enrichment data to store
}
```

The `data` object is mapped to DB columns using `destination_field_mappings` from the workflow config.

---

## Receiver Pattern (for async callbacks)

Some providers (n8n, Clay) are async - they call back when done.

```
┌──────────────┐     fire & forget     ┌───────────────┐
│ clean_v1     │ ───────────────────▶  │     n8n       │
│ (sender)     │                       │               │
└──────────────┘                       └───────────────┘
                                              │
                                              │ callback
                                              ▼
                                       ┌───────────────┐
                                       │  receiver_v1  │
                                       │               │
                                       └───────────────┘
                                              │
                                              ▼
                                       ┌───────────────┐
                                       │storage_worker │
                                       │     _v2       │
                                       └───────────────┘
                                              │
                                              ▼
                                       ┌───────────────┐
                                       │    logger     │
                                       └───────────────┘
```

For async workflows, create a thin receiver function that:
1. Extracts workflow_id from the callback payload
2. Forwards to storage_worker_v2

---

## Edge Functions Summary

| Function | Purpose | Deploy Flag |
|----------|---------|-------------|
| `scrape_homepage_v1` | Calls Zenrows, sends to storage worker | `--no-verify-jwt` |
| `clean_homepage_v1` | Calls n8n, fire-and-forget | `--no-verify-jwt` |
| `clean_homepage_receiver_v1` | Receives n8n callback, sends to storage worker | `--no-verify-jwt` |
| `storage_worker_v2` | Config-driven storage, calls logger | `--no-verify-jwt` |
| `enrichment_logger_v1` | Logs to enrichment_results_log | `--no-verify-jwt` |

---

## Workflow Config Fields Reference

| Column | Purpose | Example |
|--------|---------|---------|
| `id` | Primary key, passed as workflow_id | UUID |
| `title` | Display name | "Scrape Homepage" |
| `workflow_slug` | Machine identifier | "scrape-homepage-via-zenrows" |
| `play_id` | Play name for logging | "case-studies-play" |
| `overall_step_number` | Step number in pipeline | 1 |
| `provider` | External service | "zenrows", "n8n", "clay" |
| `destination_db` | Which DB to write to | "workspace" or "hq" |
| `destination_table_name` | Table to insert into | "company_homepage_scrapes" |
| `destination_field_mappings` | JSON mapping of input → columns | `{"homepage_html": "homepage_html"}` |

---

## Checklist for New Workflows

- [ ] Added row to `db_driven_enrichment_workflows` with all required fields
- [ ] Created destination table in correct database (HQ or Workspace)
- [ ] Created workflow-specific edge function
- [ ] Deployed with `--no-verify-jwt`
- [ ] Set environment variables (STORAGE_WORKER_URL, etc.)
- [ ] Tested end-to-end with a single company
- [ ] Verified data appears in destination table
- [ ] Verified logs appear in `enrichment_results_log`
- [ ] Verified step completion appears in `company_play_step_completions`
