# Architecture Pattern: View-Based Record Explosion and Deduplication

**Date:** 2024-12-14
**Pattern Type:** Data transformation for dispatch

---

## The Problem

When sending data to external APIs (like Clay), we often need to transform our stored data structure to match what the API expects. In this case:

1. **Job titles stored as array**: We had expanded job titles stored as a JSONB array (10 titles per target company)
2. **Clay needs individual records**: Clay's "Find Contacts" API expects one record per search - each (company, job_title) pair must be a separate API call
3. **Companies duplicated in source**: Work history had 61 records but only 43 unique companies (some people worked at the same company, or worked there twice)
4. **Case study company exclusion**: We shouldn't search for contacts at the company where the buyer was mentioned in the case study

**Without solving this properly:**
- 61 work history records × 10 job titles = 610 API calls
- Many duplicate searches for the same company
- Wasted money and credits

---

## The Solution: Database View with Explosion + Deduplication

Instead of modifying application code or the dispatcher, solve it at the **data layer** with a view.

### The View

```sql
CREATE OR REPLACE VIEW clay_work_history_with_job_titles AS
WITH unique_companies AS (
  -- Step 1: Deduplicate companies per target company
  SELECT DISTINCT ON (wh.hq_target_company_id, wh.company_name)
    wh.id,
    wh.source_record_id,
    wh.hq_target_company_id,
    wh.hq_target_company_name,
    wh.hq_target_company_domain,
    wh.person_name,
    wh.company_name,
    wh.company_domain,
    wh.company_linkedin_url,
    ble.extracted_buyer_company
  FROM clay_linkedin_profile_work_history wh
  JOIN buyer_linkedin_enrichments ble ON wh.source_record_id = ble.id
  -- Step 2: Filter out case study companies
  WHERE wh.company_name IS DISTINCT FROM ble.extracted_buyer_company
  ORDER BY wh.hq_target_company_id, wh.company_name, wh.id
)
-- Step 3: Explode job titles array into individual rows
SELECT
  uc.*,
  jsonb_array_elements_text(ej.expanded_job_titles) AS job_title_to_search
FROM unique_companies uc
JOIN ai_expanded_icp_job_titles ej ON uc.hq_target_company_id = ej.hq_target_company_id;
```

### Key Techniques

1. **`DISTINCT ON (col1, col2)`**: PostgreSQL-specific way to get one row per unique combination
2. **`jsonb_array_elements_text()`**: Explodes a JSONB array into rows (one row per array element)
3. **`IS DISTINCT FROM`**: Null-safe inequality check (handles NULL values correctly)
4. **CTE for clarity**: `WITH unique_companies AS (...)` makes the logic readable

---

## Results

| Metric | Before | After | Savings |
|--------|--------|-------|---------|
| Raw work history records | 61 | - | - |
| Unique companies (after dedup + filter) | - | 36 | 7 duplicates + SecurityPal filtered |
| API calls without optimization | 610 | - | - |
| API calls with optimization | - | 360 | 250 calls (41%) |

---

## Why This Pattern Works

### Separation of Concerns

```
┌─────────────────────────────────────────────────────────────┐
│                     STORAGE LAYER                           │
│  - Store data in normalized form                            │
│  - Job titles as JSONB array (efficient storage)            │
│  - Work history with potential duplicates (that's OK)       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     VIEW LAYER                              │
│  - Transform data for specific dispatch needs               │
│  - Deduplicate companies                                    │
│  - Explode arrays into rows                                 │
│  - Filter out exclusions                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     DISPATCHER                              │
│  - Reads from view (doesn't know about transformation)      │
│  - Sends each row to external API                           │
│  - No special logic needed                                  │
└─────────────────────────────────────────────────────────────┘
```

### Benefits

1. **No code changes**: Dispatcher stays generic
2. **Testable**: Query the view directly to verify output
3. **Visible**: Can inspect row counts at each stage
4. **Reusable**: Same pattern works for other explosion/deduplication needs
5. **Performant**: Database handles the heavy lifting

---

## When to Use This Pattern

Use view-based record explosion when:

- External API needs data in different shape than storage
- Need to explode arrays into individual rows
- Need to deduplicate before dispatch
- Need to join multiple tables for filtering
- Want to keep dispatcher logic generic

---

## Common Pitfalls

1. **Forgetting `DISTINCT ON` ordering**: Must include `ORDER BY` with same columns
2. **Using `unnest()` instead of `jsonb_array_elements_text()`**: `unnest()` works on PostgreSQL arrays, not JSONB
3. **Not handling NULLs**: Use `IS DISTINCT FROM` instead of `!=` for null-safe comparisons
4. **Modifying storage instead**: Don't change how data is stored to solve dispatch problems

---

## Related Documents

- [Dispatch Filtering Failure](./2024-12-14-dispatch-filtering-failure.md) - Why filtering belongs in views, not storage
- [Design Questions Checklist](./design-questions-checklist.md) - Questions to ask before building
