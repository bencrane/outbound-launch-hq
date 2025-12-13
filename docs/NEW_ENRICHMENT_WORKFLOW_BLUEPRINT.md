# New Enrichment Workflow Blueprint

This document defines the standard process for creating a new enrichment workflow in the Outbound Launch HQ + GTM Teaser system.

---

## Pre-Build Questions (Ask User)

### 1. Workflow Identity
- **Workflow name/title**: Human-readable name (e.g., "Get LinkedIn URLs for Buyer Details")
- **Workflow slug**: Machine-readable identifier (e.g., `get-person-linkedin-url`)
- **Category**: Which category? (e.g., `GTM Teaser HQ`, `Outbound Launch HQ`)
- **Description**: Brief description of what this workflow does

### 2. Source Data
- **Source table name**: Which table does the dispatcher read from? (e.g., `extracted_buyer_details_from_case_study_urls`)
- **Source table company FK**: Which column links records to companies? (e.g., `hq_target_company_id`)
- **Source table select columns**: Which columns to fetch and send to Clay? (e.g., `id, hq_target_company_id, hq_target_company_name, extracted_contact_name`)

### 3. Destination/Enrichment
- **Destination type**: Where does data go? (`clay`, `zenrows`, `leadmagic`, etc.)
- **Clay webhook URL**: The Clay table webhook URL (user provides after creating Clay table)
- **What data does Clay need?**: List the fields Clay expects to perform the enrichment

### 4. Return Data
- **What does Clay return?**: List the fields Clay will send back after enrichment
- **Destination table name**: Where to store results in GTM Teaser DB? (e.g., `buyer_linkedin_enrichments`)
- **Destination table schema**: Define columns for the new table (if it doesn't exist)

### 5. Pass-Through Fields
Standard pass-through fields for all workflows:
- `source_record_id` (renamed from `id`)
- `hq_target_company_id`
- `hq_target_company_name`
- `hq_target_company_domain`
- `workflow_id`
- `workflow_slug`
- `receiver_function_url` (master receiver)

---

## Build Checklist

### Step 1: Create Destination Table (GTM Teaser DB)

```sql
-- Template
CREATE TABLE {destination_table_name} (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source record reference
  source_record_id UUID NOT NULL,

  -- Company context (for querying without joins)
  hq_target_company_id UUID,
  hq_target_company_name TEXT,
  hq_target_company_domain TEXT,

  -- Enriched data fields (workflow-specific)
  {field_1} {type},
  {field_2} {type},
  ...

  -- Metadata
  workflow_id UUID,
  workflow_slug TEXT,
  enriched_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for querying by source record
CREATE INDEX idx_{table_name}_source_record
ON {destination_table_name}(source_record_id);

-- Index for querying by company
CREATE INDEX idx_{table_name}_company
ON {destination_table_name}(hq_target_company_id);
```

### Step 2: Create Storage Worker Edge Function

**Location**: `/supabase/functions/{workflow_slug}_storage_worker_v1/index.ts`

**Template structure**:
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface IncomingPayload {
  // Source record reference
  source_record_id: string;
  id?: string; // May also come as 'id'

  // Company context
  hq_target_company_id?: string;
  hq_target_company_name?: string;
  hq_target_company_domain?: string;

  // Workflow context
  workflow_id?: string;
  workflow_slug?: string;

  // Enriched fields from Clay (workflow-specific)
  {enriched_field_1}?: {type};
  {enriched_field_2}?: {type};

  [key: string]: unknown;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();

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

    // Get source record ID (may be 'source_record_id' or 'id')
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

    // Add company context if provided
    if (payload.hq_target_company_id) record.hq_target_company_id = payload.hq_target_company_id;
    if (payload.hq_target_company_name) record.hq_target_company_name = payload.hq_target_company_name;
    if (payload.hq_target_company_domain) record.hq_target_company_domain = payload.hq_target_company_domain;

    // Add workflow context
    if (payload.workflow_id) record.workflow_id = payload.workflow_id;
    if (payload.workflow_slug) record.workflow_slug = payload.workflow_slug;

    // Add enriched fields (workflow-specific)
    if (payload.{enriched_field_1}) record.{enriched_field_1} = payload.{enriched_field_1};
    if (payload.{enriched_field_2}) record.{enriched_field_2} = payload.{enriched_field_2};

    // Insert into destination table
    const { data, error: insertError } = await gtmSupabase
      .from("{destination_table_name}")
      .insert(record)
      .select()
      .single();

    if (insertError) {
      return new Response(
        JSON.stringify({ error: insertError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Optionally update source record status
    // await gtmSupabase
    //   .from("{source_table_name}")
    //   .update({ enrichment_status: "enriched" })
    //   .eq("id", sourceRecordId);

    return new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

### Step 3: Deploy Storage Worker

```bash
supabase functions deploy {workflow_slug}_storage_worker_v1 --no-verify-jwt
```

### Step 4: Add Workflow Config to DB (Outbound Launch HQ)

```sql
INSERT INTO db_driven_enrichment_workflows (
  title,
  workflow_slug,
  description,
  category,
  status,

  -- Source config (dispatcher reads from here)
  source_table_name,
  source_table_company_fk,
  source_table_select_columns,

  -- Destination config
  destination_type,
  destination_endpoint_url,  -- Clay webhook URL (set after Clay table created)

  -- Function URLs
  dispatcher_function_url,
  receiver_function_url,      -- Always master_receiver_v1
  storage_worker_function_url
) VALUES (
  '{Workflow Title}',
  '{workflow-slug}',
  '{Description of what this workflow does}',
  'GTM Teaser HQ',
  'active',

  '{source_table_name}',
  '{source_table_company_fk}',
  '{comma-separated column names}',

  'clay',
  NULL,  -- Set later after Clay table created

  'https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/dispatch_get_person_linkedin_url_v1',  -- Use generic dispatcher
  'https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/master_receiver_v1',
  'https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/{workflow_slug}_storage_worker_v1'
);
```

### Step 5: Create Clay Table

1. Go to Clay
2. Create new table with webhook trigger
3. Configure columns to receive the payload fields
4. Add enrichment steps
5. Add HTTP action to send results back to master receiver
6. Copy webhook URL

### Step 6: Update Workflow Config with Clay Webhook URL

```sql
UPDATE db_driven_enrichment_workflows
SET destination_endpoint_url = '{clay_webhook_url}'
WHERE workflow_slug = '{workflow-slug}';
```

### Step 7: Configure Clay HTTP Response

Clay HTTP action should POST to: `https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/master_receiver_v1`

**Request body template** (pass through IDs + enriched data):
```json
{
  "source_record_id": "{{source_record_id}}",
  "hq_target_company_id": "{{hq_target_company_id}}",
  "hq_target_company_name": "{{hq_target_company_name}}",
  "hq_target_company_domain": "{{hq_target_company_domain}}",
  "workflow_id": "{{workflow_id}}",
  "workflow_slug": "{{workflow_slug}}",
  "{enriched_field_1}": "{{enriched_field_1}}",
  "{enriched_field_2}": "{{enriched_field_2}}"
}
```

### Step 8: Test End-to-End

1. Go to Enrichment Eligible Companies page
2. Select a company with eligible records
3. Click workflow button to send to enrichment
4. Verify:
   - Dispatcher logs show records sent to Clay
   - Clay table receives records
   - Clay enriches and sends back to master receiver
   - Master receiver routes to storage worker
   - Storage worker inserts into destination table

---

## Architecture Diagram

```
[UI: Enrichment Eligible Companies]
          ↓ POST {companies, workflow}
[Dispatcher Function]
  - Reads workflow config from DB (source of truth)
  - Queries source_table_name using source_table_company_fk
  - Selects source_table_select_columns
  - Sends each record to Clay with rate limiting
          ↓ POST (100ms delay between requests)
[Clay Webhook]
  - Receives source data + pass-through IDs
  - Runs enrichment steps
  - Sends results back via HTTP action
          ↓ POST
[Master Receiver]
  - Reads workflow_id from payload
  - Looks up storage_worker_function_url from DB
  - Forwards payload to storage worker
          ↓ POST
[Storage Worker]
  - Parses enriched data
  - Inserts into destination table
  - Optionally updates source record status
          ↓ INSERT
[GTM Teaser DB: Destination Table]
```

---

## Naming Conventions

| Component | Pattern | Example |
|-----------|---------|---------|
| Workflow slug | `{action}-{target}-{detail}` | `get-person-linkedin-url` |
| Dispatcher function | `dispatch_{workflow_slug}_v1` | `dispatch_get_person_linkedin_url_v1` |
| Storage worker function | `{workflow_slug}_storage_worker_v1` | `get_person_linkedin_url_storage_worker_v1` |
| Destination table | `clay_{target}_{result}` | `clay_person_linkedin_profiles` |

---

## Config Fields Reference

| Field | Description | Example |
|-------|-------------|---------|
| `title` | Human-readable name | "Get LinkedIn URLs for Buyer Details" |
| `workflow_slug` | Machine identifier | `get-person-linkedin-url` |
| `category` | Grouping for UI | `GTM Teaser HQ` |
| `status` | `active` or `draft` | `active` |
| `source_table_name` | Table dispatcher reads from | `extracted_buyer_details_from_case_study_urls` |
| `source_table_company_fk` | FK column to filter by company | `hq_target_company_id` |
| `source_table_select_columns` | Columns to fetch | `id, hq_target_company_id, ...` |
| `destination_type` | Enrichment provider | `clay` |
| `destination_endpoint_url` | Clay webhook URL | `https://api.clay.com/...` |
| `dispatcher_function_url` | Dispatcher edge function | `https://.../functions/v1/dispatch_...` |
| `receiver_function_url` | Always master receiver | `https://.../functions/v1/master_receiver_v1` |
| `storage_worker_function_url` | Storage worker edge function | `https://.../functions/v1/..._storage_worker_v1` |

---

## Notes

- **Dispatcher is generic**: The same dispatcher (`dispatch_get_person_linkedin_url_v1`) can potentially serve multiple workflows if they have similar source structures. Config drives behavior.
- **Master receiver routes by workflow_id**: Always send `workflow_id` in payload so master receiver can look up the correct storage worker.
- **Rate limiting**: Dispatcher enforces 100ms delay between Clay requests (max 10/sec).
- **Pass-through fields**: Always include company context for easy querying in destination tables.
