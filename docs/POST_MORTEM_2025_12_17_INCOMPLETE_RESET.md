# Post-Mortem: Incomplete Enrichment State Reset

**Date:** 2025-12-17
**Severity:** Medium
**Impact:** UI showed incorrect pipeline state; companies appeared to have completed Step 5 when data was deleted

---

## Summary

When asked to delete Step 5 records so the user could re-test their n8n fix, I only deleted from the destination table (`case_studies_page_cleaned`) but failed to delete from the tracking tables (`enrichment_results_log`, `company_play_step_completions`). This caused the UI to incorrectly show companies as "completed Step 5" and ready for Step 6, even though Step 5 data was gone.

---

## Timeline

1. User requested deletion of Step 5 records with null `case_studies_page_url`
2. I deleted only from `case_studies_page_cleaned` (Workspace DB)
3. I did NOT delete from `enrichment_results_log` (HQ DB)
4. I did NOT delete from `company_play_step_completions` (HQ DB)
5. User refreshed UI and saw companies incorrectly listed under Step 6
6. User pointed out the error and referenced `docs/RESETTING_ENRICHMENT_STATE.md`
7. I completed the proper reset by deleting from all required tables

---

## Root Cause

1. **Lack of awareness**: I did not consult the existing documentation (`RESETTING_ENRICHMENT_STATE.md`) before performing the deletion
2. **Incomplete mental model**: I treated "delete records" as only deleting the data, not the tracking/logging records that control UI state
3. **No automated safeguard**: There is no single function or script that performs a complete reset

---

## What Should Have Happened

Per `docs/RESETTING_ENRICHMENT_STATE.md`, when resetting a step, delete from ALL of these tables:

| Table | Database | Purpose |
|-------|----------|---------|
| `enrichment_results_log` | HQ | Audit trail of enrichment attempts |
| `company_play_step_completions` | HQ | Controls which step companies appear under in UI |
| Destination table (varies by step) | Workspace | The actual enriched data |

---

## Action Items

### Immediate (Completed)
- [x] Deleted orphaned records from `enrichment_results_log` for Step 5
- [x] Deleted orphaned records from `company_play_step_completions` for Step 5
- [x] Verified all tables are now consistent

### Preventive Measures

#### 1. AI Onboarding Update
Add explicit instruction to `docs/AI_ONBOARDING.md`:

```markdown
## Critical: Resetting Enrichment State

When the user asks to "delete", "reset", or "re-run" enrichment data for any step:

1. ALWAYS consult `docs/RESETTING_ENRICHMENT_STATE.md` FIRST
2. NEVER delete only from the destination table
3. ALWAYS delete from ALL THREE locations:
   - `enrichment_results_log` (HQ)
   - `company_play_step_completions` (HQ)
   - Destination table (Workspace)
```

#### 2. Create Reset Helper Function (Optional)
Consider creating an edge function `reset_enrichment_step_v1` that:
- Takes `company_domain` and `step_number` as parameters
- Deletes from all required tables atomically
- Returns confirmation of what was deleted

---

## Lessons Learned

1. **Documentation exists for a reason** - Always check for existing docs before performing destructive operations
2. **Enrichment state spans multiple tables** - The UI state depends on tracking tables, not just data tables
3. **"Delete" means "complete reset"** - When user asks to delete enrichment data, assume they want a full reset unless specified otherwise

---

## References

- `docs/RESETTING_ENRICHMENT_STATE.md` - The authoritative guide for resetting enrichment state
- `docs/SOURCE_OF_TRUTH_TABLES.md` - Documents which tables store what data
