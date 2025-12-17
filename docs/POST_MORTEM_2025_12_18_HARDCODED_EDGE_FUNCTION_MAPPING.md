# Post-Mortem: Hardcoded Edge Function Mapping Caused Silent Failures

**Date:** 2025-12-18
**Severity:** High
**Status:** Resolved

---

## Summary

After deprecating n8n cleaning workflows and renumbering the pipeline steps, Step 2 silently failed because the UI had a hardcoded mapping of step numbers to edge function names that wasn't updated to match the new workflow order.

---

## Timeline

1. **Workflows renumbered** - Deprecated cleaning steps, renumbered from 1-9 to 1-7
2. **User triggered Step 2** - Expected to call `find_case_studies_page_v1`
3. **Nothing sent to Clay** - User reported "nothing is being sent through at all"
4. **Investigation revealed** - UI was calling `clean_homepage_v1` (old Step 2) instead of `find_case_studies_page_v1` (new Step 2)

---

## Root Cause

Hardcoded mapping in `src/app/manual-gtm-enrichment/page.tsx`:

```typescript
// OLD HARDCODED MAPPING (WRONG after renumbering)
const stepToEdgeFunction: Record<number, string> = {
  1: "scrape_homepage_v1",
  2: "clean_homepage_v1",          // ← This was deprecated!
  3: "find_case_studies_page_v1",  // ← This should be Step 2 now
  4: "scrape_case_studies_page_v1",
  // ...
};
```

When workflows were renumbered in the database, this hardcoded mapping was not updated, causing the UI to call the wrong edge function.

---

## Why This Violated Architecture Principles

**"DB IS SOURCE OF TRUTH"**

The workflow configuration in `db_driven_enrichment_workflows` should be the single source of truth for ALL workflow-related configuration, including which edge function to call. Having a separate hardcoded mapping in the UI created a coupling that broke when the DB was updated.

---

## Resolution

1. **Added `edge_function_name` to `destination_config`** in each workflow record:
```json
{
  "edge_function_name": "find_case_studies_page_v1",
  "destinations": [...],
  ...
}
```

2. **Updated UI to read from DB** instead of hardcoded mapping:
```typescript
// NEW - Read from workflow config (DB is source of truth)
const edgeFunctionName = workflow.edge_function_name;
if (!edgeFunctionName) {
  // Error: not configured in DB
}
```

3. **Removed hardcoded mapping entirely** from UI code

---

## Prevention

### For AI Assistants

1. **Never hardcode configuration** that could change independently
2. **If it's in the DB, read it from the DB** - don't duplicate in code
3. **When renumbering/reordering workflows**, check ALL code that references step numbers
4. **Test after configuration changes** - don't assume DB updates propagate to all consumers

### Checklist Before Renumbering Workflows

- [ ] Search codebase for hardcoded step numbers: `grep -r "step.*[0-9]" src/`
- [ ] Search for hardcoded function names: `grep -r "_v1" src/`
- [ ] Verify UI reads all config from workflow records
- [ ] Test each step end-to-end after changes

---

## Related Files

- `src/app/manual-gtm-enrichment/page.tsx` - UI that was fixed
- `db_driven_enrichment_workflows` table - Source of truth for workflow config
- `docs/ENRICHMENT_SYSTEM_ARCHITECTURE.md` - Architecture documentation

---

## Lessons Learned

1. **Silent failures are the worst** - Step 2 appeared to "work" (no errors) but nothing was sent
2. **Configuration drift is dangerous** - DB and code can get out of sync
3. **DB as source of truth must be enforced** - Not just a principle, but implemented in code
