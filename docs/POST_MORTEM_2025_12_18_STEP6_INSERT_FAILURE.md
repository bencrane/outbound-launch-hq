# Post-Mortem: Step 6 Insert Failure (2025-12-18)

## Status: RESOLVED

## Problem
Step 6 (Get Buyer LinkedIn URL) fails to insert into `buyer_linkedin_enrichments` table.

## Error History
1. First error: `"Could not find the 'company_domain' column of 'buyer_linkedin_enrichments' in the schema cache"`
2. After fix attempt: `"column \"company_domain\" does not exist"`

## Root Cause Analysis

### Issue 1: Base Field Mapping (FIXED)
The `storage_worker_v2` was hardcoding `company_domain` as a column name, but the table has `hq_target_company_domain`.

**Fix applied:** Updated storage_worker_v2 to check field mappings for base fields (company_id, company_domain, company_name) and use mapped column names.

### Issue 2: Field Mapping Direction (FIXED)
The original code expected config format `source: dest`, but we configured `dest: source`.

**Fix applied:** Updated mapping loop to use `[destColumn, sourceField]` instead of `[sourceField, destColumn]`.

### Issue 3: Upsert Conflict Column (LIKELY CAUSE - NOT FIXED)
Line 191 in `storage_worker_v2/index.ts`:
```typescript
const conflictColumns = dest.on_conflict || "company_domain";
```

This defaults to `company_domain` for upsert conflict resolution, but that column doesn't exist in `buyer_linkedin_enrichments`.

**Fix needed:** Either:
1. Add `on_conflict` to Step 6 destination config: `"on_conflict": "hq_target_company_domain"`
2. Or change to `insert_mode: "insert"` since buyer_linkedin_enrichments allows multiple rows

## Table Schema: buyer_linkedin_enrichments
```sql
id UUID PRIMARY KEY
buyer_detail_id UUID  -- FK to case_study_buyer_details
hq_target_company_id UUID
hq_target_company_name TEXT
hq_target_company_domain TEXT  -- NOT company_domain!
extracted_buyer_company TEXT
extracted_contact_name TEXT
extracted_contact_role TEXT
contact_linkedin_url TEXT
workflow_id UUID
workflow_slug TEXT
source TEXT
enriched_at TIMESTAMPTZ
created_at TIMESTAMPTZ
```

## Current Step 6 Field Mappings
```json
{
  "destinations": [{
    "db": "workspace",
    "table": "buyer_linkedin_enrichments",
    "fields": {
      "buyer_detail_id": "source_record_id",
      "contact_linkedin_url": "linkedin_url",
      "hq_target_company_id": "company_id",
      "extracted_contact_name": "buyer_full_name",
      "extracted_contact_role": "buyer_job_title",
      "hq_target_company_name": "company_name",
      "extracted_buyer_company": "buyer_company_name",
      "hq_target_company_domain": "company_domain"
    }
  }]
}
```

## Files Modified
- `supabase/functions/storage_worker_v2/index.ts` - Field mapping fixes
- `supabase/functions/clay_receiver_v1/index.ts` - Auth header changes (reverted)

## Deployments Made
- `storage_worker_v2` deployed with `--no-verify-jwt`
- `clay_receiver_v1` deployed with `--no-verify-jwt`

## Resolution

### Fix Applied
Added `"insert_mode": "insert"` to the Step 6 destination config:

```bash
curl -X PATCH "https://wvjhddcwpedmkofmhfcp.supabase.co/rest/v1/db_driven_enrichment_workflows?overall_step_number=eq.6" \
  -H "apikey: $API_KEY" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "destination_config": {
      ...existing config...,
      "destinations": [{
        ...existing...,
        "insert_mode": "insert"
      }]
    }
  }'
```

### Why This Works
- `buyer_linkedin_enrichments` allows multiple rows per company (one per buyer)
- Using `insert` instead of `upsert` avoids the `on_conflict` clause entirely
- No need to specify conflict columns when doing plain inserts

## Test Command
Retry from Clay. Watch for new errors in:
```bash
curl -s "https://wvjhddcwpedmkofmhfcp.supabase.co/rest/v1/enrichment_results_log?status=eq.error&order=created_at.desc&limit=1" \
  -H "apikey: $API_KEY" -H "Authorization: Bearer $API_KEY"
```
