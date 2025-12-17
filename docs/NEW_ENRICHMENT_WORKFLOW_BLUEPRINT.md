# [ARCHIVED] New Enrichment Workflow Blueprint

> **ARCHIVED: 2025-12-17**
>
> This document is outdated. It references the old architecture with master_dispatcher_v1, master_receiver_v1, generic_storage_worker_v1, and writes to the wrong logging tables.
>
> **Use the new document instead: `CREATING_ENRICHMENT_WORKFLOWS.md`**

---

~~This document defines the standard process for creating a new enrichment workflow in the Outbound Launch HQ + GTM Teaser system.~~

---

## ⚠️ PREREQUISITE: Understand the Config System First

**Before reading this document, you MUST understand the core config pattern.**

Read `AI_ONBOARDING.md` Section 6 ("Workflow Configuration System") first. Key points:

1. **`db_driven_enrichment_workflows`** is THE config table for all workflows
2. **Dispatcher** reads: `source_table_name`, `source_table_company_fk`, `source_table_select_columns`, `destination_endpoint_url`
3. **Storage worker** reads: `destination_table_name`, `destination_field_mappings`, `array_field_configs`
4. **Everything is DB-driven** - no hardcoded logic in the storage worker

---

## Quick Reference: What Gets Sent to Clay

The **master_dispatcher_v1** sends the following payload to Clay for EACH record in the source table:

```json
{
  // 1. ALL columns specified in source_table_select_columns
  "id": "source-record-uuid",
  "company_name": "Airtable",
  "company_domain": "airtable.com",
  "company_linkedin_url": "https://linkedin.com/company/airtable",
  // ... any other columns from source_table_select_columns

  // 2. ALWAYS added by dispatcher (from the record)
  "source_record_id": "source-record-uuid",  // Same as 'id', renamed for clarity

  // 3. ALWAYS added by dispatcher (from workflow config in db_driven_enrichment_workflows)
  "workflow_id": "workflow-uuid",
  "workflow_slug": "leadmagic-company-enrich-of-buyer-past-employers",
  "receiver_function_url": "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/master_receiver_v1"
}
```

**IMPORTANT**: The dispatcher ALWAYS includes `workflow_id`, `workflow_slug`, and `receiver_function_url`. These come from the `db_driven_enrichment_workflows` table, not from the source table.

---

## Architecture: How Data Flows

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: UI (hq-target-companies page)                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ User selects companies → clicks "Send to Enrichment" → selects workflow    │
│                                                                             │
│ POST to master_dispatcher_v1:                                               │
│ {                                                                           │
│   "companies": [                                                            │
│     { "company_id": "uuid", "company_name": "X", "company_domain": "x.com" }│
│   ],                                                                        │
│   "workflow": { "id": "workflow-uuid" }                                     │
│ }                                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: master_dispatcher_v1                                                │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Looks up workflow config from db_driven_enrichment_workflows             │
│    - Gets: source_table_name, source_table_company_fk,                      │
│            source_table_select_columns, destination_endpoint_url,           │
│            receiver_function_url, workflow_slug                             │
│                                                                             │
│ 2. Queries GTM Teaser DB:                                                   │
│    SELECT {source_table_select_columns}                                     │
│    FROM {source_table_name}                                                 │
│    WHERE {source_table_company_fk} IN (company_ids from request)            │
│                                                                             │
│ 3. For EACH record, POSTs to Clay (with 100ms delay between requests):      │
│    {                                                                        │
│      ...all_columns_from_select,                                            │
│      "source_record_id": record.id,                                         │
│      "workflow_id": config.id,                                              │
│      "workflow_slug": config.workflow_slug,                                 │
│      "receiver_function_url": config.receiver_function_url                  │
│    }                                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: Clay Webhook                                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ - Receives the payload                                                      │
│ - Runs enrichment steps (API calls, AI, etc.)                               │
│ - HTTP Action POSTs results back to receiver_function_url                   │
│                                                                             │
│ CRITICAL: Clay must pass through these fields in the response:              │
│   - workflow_id (REQUIRED for routing)                                      │
│   - source_record_id                                                        │
│   - hq_target_company_id, hq_target_company_name, hq_target_company_domain  │
│   - Any other context fields needed for storage                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: master_receiver_v1                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Extracts workflow_id from payload (REQUIRED)                             │
│ 2. Looks up storage_worker_function_url from db_driven_enrichment_workflows │
│ 3. Forwards entire payload to the storage worker                            │
│                                                                             │
│ NOTE: If workflow has source_record_array_field set (e.g., "people"),       │
│       receiver iterates over the array and calls storage worker per item    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 5: generic_storage_worker_v1 (DB-DRIVEN - NO HARDCODED LOGIC)          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ THE STORAGE WORKER READS ALL ITS BEHAVIOR FROM THE CONFIG TABLE:            │
│                                                                             │
│ 1. Extracts workflow_id from payload                                        │
│                                                                             │
│ 2. Queries db_driven_enrichment_workflows:                                  │
│    SELECT destination_table_name,                                           │
│           destination_field_mappings,                                       │
│           array_field_configs,                                              │
│           raw_payload_table_name,                                           │
│           raw_payload_field                                                 │
│    FROM db_driven_enrichment_workflows                                      │
│    WHERE id = payload.workflow_id                                           │
│                                                                             │
│ 3. Uses destination_field_mappings to map payload → DB columns:             │
│    { "clay_field": "db_column" } means payload.clay_field → record.db_column│
│                                                                             │
│ 4. INSERTs into destination_table_name                                      │
│                                                                             │
│ 5. If array_field_configs exists, explodes arrays into child tables         │
│                                                                             │
│ 6. Optionally calls global_logger_function_url                              │
│                                                                             │
│ ⚠️ THERE IS NO PER-WORKFLOW CODE. ALL BEHAVIOR COMES FROM CONFIG.          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Creating a New Workflow: Step-by-Step

### Phase 1: Dispatch Only (Test Clay Integration)

When first setting up a workflow, you may want to just send data to Clay and see what comes back before configuring storage.

#### Step 1.1: Gather Required Information

| Field | Description | Example |
|-------|-------------|---------|
| `title` | Human-readable name | "Enrich Buyer Past Employers (LeadMagic)" |
| `workflow_slug` | Machine identifier (lowercase, hyphens) | `leadmagic-company-enrich-of-buyer-past-employers` |
| `category` | UI grouping | `company-enrichments` |
| `destination_endpoint_url` | Clay webhook URL | `https://api.clay.com/v3/sources/webhook/...` |
| `source_table_name` | Table/view in GTM Teaser DB | `clay_work_history_with_job_titles` |
| `source_table_company_fk` | Column linking to companies | `hq_target_company_id` |
| `source_table_select_columns` | Columns to send to Clay | See below |

#### Step 1.2: Determine Source Columns

Check what columns exist in your source table:

```bash
# Query sample record to see available columns
GTM_KEY="your-gtm-anon-key"
curl -s "https://kwxdezafluqhcmovnwbn.supabase.co/rest/v1/{source_table}?select=*&limit=1" \
  -H "apikey: $GTM_KEY" -H "Authorization: Bearer $GTM_KEY"
```

Common patterns for `source_table_select_columns`:

```
# For company enrichment (LeadMagic, etc.)
id,source_record_id,hq_target_company_id,hq_target_company_name,hq_target_company_domain,company_name,company_domain,company_linkedin_url

# For person enrichment (LinkedIn profile, etc.)
id,source_record_id,hq_target_company_id,hq_target_company_name,hq_target_company_domain,contact_linkedin_url,extracted_contact_name

# For finding contacts at companies (includes job titles)
id,source_record_id,hq_target_company_id,hq_target_company_name,hq_target_company_domain,person_name,company_name,company_domain,company_linkedin_url,ai_icp_job_title_one,ai_icp_job_title_two,...
```

#### Step 1.3: Insert Workflow Config

```bash
API_KEY="your-outbound-launch-anon-key"

curl -s -X POST "https://wvjhddcwpedmkofmhfcp.supabase.co/rest/v1/db_driven_enrichment_workflows" \
  -H "apikey: $API_KEY" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "title": "Enrich Buyer Past Employers (LeadMagic)",
    "workflow_slug": "leadmagic-company-enrich-of-buyer-past-employers",
    "description": "Sends buyer past employer companies to Clay for LeadMagic company enrichment",
    "category": "company-enrichments",
    "status": "active",
    "request_type": "POST",
    "destination_type": "api",
    "destination_endpoint_url": "https://api.clay.com/v3/sources/webhook/...",
    "source_table_name": "clay_work_history_with_job_titles",
    "source_table_company_fk": "hq_target_company_id",
    "source_table_select_columns": "id,source_record_id,hq_target_company_id,hq_target_company_name,hq_target_company_domain,person_name,company_name,company_domain,company_linkedin_url",
    "dispatcher_function_name": "master_dispatcher_v1",
    "dispatcher_function_url": "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/master_dispatcher_v1",
    "receiver_function_name": "master_receiver_v1",
    "receiver_function_url": "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/master_receiver_v1"
  }'
```

#### Step 1.4: Test Dispatch

1. Go to http://localhost:3006/hq-target-companies
2. Select the workflow's category filter
3. Select a company with eligible records
4. Click "Send to Enrichment" → select your workflow
5. Check Clay to see the data arrived

---

### Phase 2: Configure Storage (After Seeing Clay Response)

Once you know what Clay returns, configure the storage side.

#### Step 2.1: Create Destination Table in GTM Teaser DB

```sql
CREATE TABLE {destination_table_name} (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source reference
  source_record_id UUID,

  -- Company context (denormalized for easy querying)
  hq_target_company_id UUID,
  hq_target_company_name TEXT,
  hq_target_company_domain TEXT,

  -- Enriched fields (from Clay response)
  {enriched_field_1} {type},
  {enriched_field_2} {type},
  ...

  -- Metadata
  workflow_id UUID,
  workflow_slug TEXT,
  enriched_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_{table}_source_record ON {destination_table_name}(source_record_id);
CREATE INDEX idx_{table}_company ON {destination_table_name}(hq_target_company_id);
```

#### Step 2.2: Update Workflow Config with Storage Settings

```bash
# Update the workflow with storage configuration
curl -s -X PATCH "https://wvjhddcwpedmkofmhfcp.supabase.co/rest/v1/db_driven_enrichment_workflows?workflow_slug=eq.{your-workflow-slug}" \
  -H "apikey: $API_KEY" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "storage_worker_function_name": "generic_storage_worker_v1",
    "storage_worker_function_url": "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/generic_storage_worker_v1",
    "destination_table_name": "{your_destination_table}",
    "destination_field_mappings": {
      "clay_field_name": "db_column_name",
      "another_clay_field": "another_db_column",
      "source_record_id": "source_record_id",
      "hq_target_company_id": "hq_target_company_id",
      "hq_target_company_name": "hq_target_company_name",
      "hq_target_company_domain": "hq_target_company_domain"
    }
  }'
```

#### Step 2.3: Configure Clay HTTP Action

In Clay, add an HTTP action at the end of the table that POSTs to master_receiver_v1.

**URL**: `https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/master_receiver_v1`

**Method**: POST

**Body** (must include workflow_id for routing):
```json
{
  "workflow_id": "{{workflow_id}}",
  "workflow_slug": "{{workflow_slug}}",
  "source_record_id": "{{source_record_id}}",
  "hq_target_company_id": "{{hq_target_company_id}}",
  "hq_target_company_name": "{{hq_target_company_name}}",
  "hq_target_company_domain": "{{hq_target_company_domain}}",
  "enriched_field_1": "{{enriched_field_1}}",
  "enriched_field_2": "{{enriched_field_2}}"
}
```

---

## Real Examples

### Example 1: LeadMagic Company Enrichment

```json
{
  "title": "Enrich Buyer Past Employers (LeadMagic)",
  "workflow_slug": "leadmagic-company-enrich-of-buyer-past-employers",
  "category": "company-enrichments",
  "source_table_name": "clay_work_history_with_job_titles",
  "source_table_company_fk": "hq_target_company_id",
  "source_table_select_columns": "id,source_record_id,hq_target_company_id,hq_target_company_name,hq_target_company_domain,person_name,company_name,company_domain,company_linkedin_url",
  "destination_endpoint_url": "https://api.clay.com/v3/sources/webhook/...",
  "dispatcher_function_url": "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/master_dispatcher_v1",
  "receiver_function_url": "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/master_receiver_v1"
}
```

### Example 2: Find Contacts at Buyer Past Employer

```json
{
  "title": "Find Contacts at Buyer Past Employer with Clay",
  "workflow_slug": "clay-find-contacts-at-buyer-past-employer",
  "category": "contact-enrichments",
  "source_table_name": "clay_work_history_with_job_titles",
  "source_table_company_fk": "hq_target_company_id",
  "source_table_select_columns": "id,source_record_id,hq_target_company_id,hq_target_company_name,hq_target_company_domain,person_name,company_name,company_domain,company_linkedin_url,ai_icp_job_title_one,ai_icp_job_title_two,ai_icp_job_title_three,ai_icp_job_title_four,ai_icp_job_title_five,ai_icp_job_title_six,ai_icp_job_title_seven,ai_icp_job_title_eight,ai_icp_job_title_nine,ai_icp_job_title_ten",
  "destination_table_name": "clay_find_contact_profile_data",
  "storage_worker_function_url": "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/generic_storage_worker_v1",
  "source_record_array_field": "find_contacts_payload.people"
}
```

---

## Key Database Tables

### db_driven_enrichment_workflows (Outbound Launch HQ DB)

| Column | Purpose |
|--------|---------|
| `id` | Primary key, used as workflow_id |
| `title` | Human-readable name for UI |
| `workflow_slug` | Machine identifier |
| `category` | UI filtering |
| `status` | "active" or "draft" |
| `source_table_name` | Table in GTM DB to read from |
| `source_table_company_fk` | Column to filter by company |
| `source_table_select_columns` | Columns to fetch and send to Clay |
| `destination_endpoint_url` | Clay webhook URL |
| `dispatcher_function_url` | Always master_dispatcher_v1 |
| `receiver_function_url` | Always master_receiver_v1 |
| `storage_worker_function_url` | generic_storage_worker_v1 or custom |
| `destination_table_name` | Table in GTM DB to write results |
| `destination_field_mappings` | JSON mapping Clay fields → DB columns |
| `array_field_configs` | Config for exploding arrays to child tables |
| `source_record_array_field` | If Clay returns array, field path to iterate |

---

## Troubleshooting

### "workflow_id is required for routing"
Clay HTTP action is not passing through the workflow_id field.

### Data not showing in Clay
- Check source_table_select_columns includes the fields Clay needs
- Verify source_table_company_fk is correct
- Check there are actually records in source table for selected companies

### Storage worker not receiving data
- Verify storage_worker_function_url is set in workflow config
- Check Clay HTTP action is POSTing (not GET)
- Ensure workflow_id is in Clay response payload

### Fields are NULL in destination table
- Check destination_field_mappings maps the correct Clay field names
- Verify Clay is returning those fields in the HTTP action body

---

## Rate Limiting

- Master dispatcher enforces **100ms delay** between requests to Clay
- This equals max **10 requests/second**
- For 1000 records, dispatch takes ~100 seconds

---

## URLs Reference

| Function | URL |
|----------|-----|
| Master Dispatcher | `https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/master_dispatcher_v1` |
| Master Receiver | `https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/master_receiver_v1` |
| Generic Storage Worker | `https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/generic_storage_worker_v1` |
| Global Logger | `https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/global-enrichment-logger-worker` |
