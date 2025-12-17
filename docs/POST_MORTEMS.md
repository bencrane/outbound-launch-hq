# Post-Mortems Index

This document indexes all post-mortem analyses for incidents in the Outbound Launch HQ project.

---

## Post-Mortems

| Date | Title | Severity | Summary |
|------|-------|----------|---------|
| 2025-12-17 | [Company ID Mismatch During Testing](./POST_MORTEM_2025_12_17_COMPANY_ID_MISMATCH.md) | High | AI assistant used wrong company_id in test payload, causing SpotDraft to be marked as Step 6 complete with SecurityPal's data |
| 2025-12-17 | [Incomplete Enrichment State Reset](./POST_MORTEM_2025_12_17_INCOMPLETE_RESET.md) | Medium | Only deleted from destination table, not tracking tables, causing UI to show incorrect state |

---

## Common Themes

### Data Integrity
- Always verify IDs match their associated domains before any operation
- Never trust IDs from context without verification query

### Reset Operations
- Always delete from ALL THREE locations: `enrichment_results_log`, `company_play_step_completions`, and destination table
- Consult `docs/RESETTING_ENRICHMENT_STATE.md` before any delete operation

---

## Prevention Checklist

Before testing with manual payloads:
- [ ] Query the actual database to get correct IDs
- [ ] Verify company_id matches company_domain
- [ ] Prefer using the UI (which has correct ID/domain pairs) over manual curl commands

Before deleting enrichment data:
- [ ] Read `docs/RESETTING_ENRICHMENT_STATE.md`
- [ ] Delete from all three required tables
- [ ] Verify deletion from all tables
