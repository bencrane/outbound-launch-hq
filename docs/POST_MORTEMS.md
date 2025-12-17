# Post-Mortems Index

This document indexes all post-mortem analyses for incidents in the Outbound Launch HQ project.

---

## Post-Mortems

| Date | Title | Severity | Summary |
|------|-------|----------|---------|
| 2025-12-18 | [Hardcoded Edge Function Mapping](./POST_MORTEM_2025_12_18_HARDCODED_EDGE_FUNCTION_MAPPING.md) | High | UI had hardcoded step-to-function mapping that broke after workflow renumbering, causing Step 2 to silently fail |
| 2025-12-17 | [Company ID Mismatch During Testing](./POST_MORTEM_2025_12_17_COMPANY_ID_MISMATCH.md) | High | AI assistant used wrong company_id in test payload, causing SpotDraft to be marked as Step 6 complete with SecurityPal's data |
| 2025-12-17 | [Incomplete Enrichment State Reset](./POST_MORTEM_2025_12_17_INCOMPLETE_RESET.md) | Medium | Only deleted from destination table, not tracking tables, causing UI to show incorrect state |

---

## Common Themes

### DB Is Source of Truth
- **Never hardcode configuration** that exists in the database
- If workflow config is in `db_driven_enrichment_workflows`, read it from there
- Hardcoded mappings create coupling that breaks when DB is updated

### Data Integrity
- Always verify IDs match their associated domains before any operation
- Never trust IDs from context without verification query

### Reset Operations
- Always delete from ALL THREE locations: `enrichment_results_log`, `company_play_step_completions`, and destination table
- Consult `docs/RESETTING_ENRICHMENT_STATE.md` before any delete operation

---

## Prevention Checklist

Before adding/modifying code:
- [ ] Check if this configuration exists in the database
- [ ] If yes, read from DB - don't hardcode
- [ ] Search for existing hardcoded values: `grep -r "step.*[0-9]" src/`

Before testing with manual payloads:
- [ ] Query the actual database to get correct IDs
- [ ] Verify company_id matches company_domain
- [ ] Prefer using the UI (which has correct ID/domain pairs) over manual curl commands

Before deleting enrichment data:
- [ ] Read `docs/RESETTING_ENRICHMENT_STATE.md`
- [ ] Delete from all three required tables
- [ ] Verify deletion from all tables

Before renumbering/reordering workflows:
- [ ] Search codebase for hardcoded step numbers
- [ ] Verify UI reads all config from workflow records
- [ ] Test each step end-to-end after changes
