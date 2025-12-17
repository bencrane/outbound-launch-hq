# Source of Truth Tables

## MISSION CRITICAL

This document defines which tables are the authoritative source for each part of the system.

---

## UI Data Sources

| Page | Source of Truth Table | Database | What It Controls |
|------|----------------------|----------|------------------|
| Manual GTM Enrichment Stages | `company_play_step_completions` | HQ | Which companies appear in each step's queue, "LAST STEP" column |
| Company Enrichment Pipeline | `company_play_step_completions` | HQ | "X / 12 steps completed" count, checkmarks on steps |

---

## Core Tables

### `company_play_step_completions` (HQ)

**THE source of truth for pipeline progression.**

| Column | Purpose |
|--------|---------|
| `company_id` | Which company |
| `play_name` | Which play (e.g., "case-study-champions") |
| `step_number` | Which step completed |
| `workflow_slug` | Which workflow completed it |
| `completed_at` | When |

**If this table doesn't get written to:**
- UI won't update
- Company won't appear in next step's queue
- Pipeline appears stuck

**Only written by:** `enrichment_logger_v1` (after verified storage)

---

### `enrichment_results_log` (HQ)

Audit trail of every enrichment attempt.

| Column | Purpose |
|--------|---------|
| `company_id` | Which company |
| `company_domain` | Domain |
| `step_number` | Which step |
| `status` | "success" or "error" |
| `error_message` | If failed, why |
| `result_table` | Where data was stored |

**Written by:** `enrichment_logger_v1`

---

### Destination Tables (Workspace)

Actual enrichment data. Examples:
- `company_homepage_scrapes` (Step 1 - autoparse structured data)
- `company_case_studies_page` (Step 2)

**Critical Rule:** A record in `company_play_step_completions` should NEVER exist without corresponding data in the destination table.

---

## Data Integrity Rule

```
ALWAYS cross-check completion records against actual data.
Never trust completion records alone.
```

To verify integrity:
1. Query `company_play_step_completions` for a company
2. For each completed step, verify data exists in the destination table
3. If completion exists without data = orphaned record = delete it

---

## Architecture Flow

```
Receiver → storage_worker_v2 → [VERIFY DATA EXISTS] → enrichment_logger_v1 → company_play_step_completions
```

The logger ONLY writes to `company_play_step_completions` after storage_worker confirms data was verified.
