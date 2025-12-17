# Outbound Launch HQ - AI Onboarding

**Last Updated:** 2025-12-17

---

## MUST-READ FILES (In Order)

Before doing ANY work, read these files:

| # | File | Why |
|---|------|-----|
| 1 | `docs/SOURCE_OF_TRUTH_TABLES.md` | **MISSION CRITICAL** - Which tables control what |
| 2 | `docs/ENRICHMENT_SYSTEM_ARCHITECTURE.md` | How the pipeline works |
| 3 | `docs/RESETTING_ENRICHMENT_STATE.md` | **CRITICAL** - How to properly reset/delete enrichment data |
| 4 | This file | Project overview |
| 5 | `UPDATES.md` | Development changelog - **check latest date for current state** |

---

## CRITICAL: Resetting Enrichment State

**When the user asks to "delete", "reset", or "re-run" enrichment data for any step:**

1. **ALWAYS** consult `docs/RESETTING_ENRICHMENT_STATE.md` FIRST
2. **NEVER** delete only from the destination table
3. **ALWAYS** delete from ALL THREE locations:

| Table | Database | Purpose |
|-------|----------|---------|
| `enrichment_results_log` | HQ | Audit trail of attempts |
| `company_play_step_completions` | HQ | **Controls UI state** |
| Destination table (varies by step) | Workspace | Actual data |

**If you only delete the data but not the tracking records, the UI will show incorrect state.**

See `docs/POST_MORTEM_2025_12_17_INCOMPLETE_RESET.md` for what happens when this is done wrong.

---

## CRITICAL: Company ID/Domain Verification

**Mixing company IDs with wrong domains is a DATA INTEGRITY VIOLATION.**

When testing, debugging, or constructing ANY payload that includes `company_id`:

1. **NEVER** assume a company_id belongs to a specific domain
2. **NEVER** use IDs from conversation context without verification
3. **ALWAYS** query the database first:
   ```bash
   curl "...companies?company_domain=eq.{DOMAIN}&select=id,company_name,company_domain"
   ```
4. **VERIFY** the ID matches the domain before using it

**Preferred approach:** Use the UI to trigger tests. The UI maintains correct ID/domain pairs.

**If manual testing is required:**
```bash
# FIRST: Query to get correct company data
curl -s "https://wvjhddcwpedmkofmhfcp.supabase.co/rest/v1/companies?company_domain=eq.securitypalhq.com&select=id,company_name,company_domain" \
  -H "apikey: $API_KEY" -H "Authorization: Bearer $API_KEY"

# THEN: Use the EXACT id from that response in your test payload
```

See `docs/POST_MORTEM_2025_12_17_COMPANY_ID_MISMATCH.md` for what happens when this is violated.

---

## Current Project State (2025-12-18)

### CRITICAL PRINCIPLE

**"DB IS SOURCE OF TRUTH"**

All configuration comes from the database, not hardcoded in code:
- Edge function names → `destination_config.edge_function_name`
- Source table/columns → `destination_config.source_config`
- Destination table/fields → `destination_config.destinations`
- Endpoint URLs → `destination_config.destination_endpoint_url`

### Current Workflow Steps

| Step | Name | Edge Function | Status |
|------|------|---------------|--------|
| 1 | Scrape Homepage | `scrape_homepage_v1` | ✅ Working |
| 2 | Find Case Studies Page URL | `find_case_studies_page_v1` | 🔄 Config-driven, needs testing |
| 3 | Scrape Case Studies Page | `scrape_case_studies_page_v1` | Needs testing |
| 4 | Extract Specific Case Study URLs | `extract_case_study_urls_v1` | Needs testing |
| 5 | Extract Buyer Details via Clay | `extract_buyer_details_v1` | Needs testing |
| 6 | Get Buyer LinkedIn URL | `get_buyer_linkedin_url_v1` | Needs testing |
| 7 | Enrich LinkedIn Profile | `enrich_linkedin_profile_v1` | Needs testing |

**Data Flow (new - autoparse, no cleaning steps):**
```
Homepage (autoparse) → Case Studies Page URL (AI) → Scrape Case Studies → Extract URLs → Extract Buyers
```

### What Was Just Changed (2025-12-18)

1. **Deprecated n8n cleaning workflows** - Zenrows autoparse returns structured data
2. **Dropped tables:** `company_homepage_cleaned`, `case_studies_page_cleaned`
3. **Renumbered workflows** - Steps are now 1-7 continuous
4. **Added `edge_function_name`** to all workflow configs in DB
5. **Updated UI** to read edge function from DB instead of hardcoded mapping
6. **Reset all data** - Clean slate for testing

### Test Companies (3 enrolled in "case-study-champions" play)

- nostra.ai
- securitypalhq.com
- forethought.ai

### Key UI Pages

- `/manual-gtm-enrichment` - Send companies through pipeline steps
- `/admin/pipeline-monitor` - Real-time monitoring of data flow

### For Latest Details

Always check the most recent date section in `UPDATES.md` for:
- What was just built/fixed
- Specific implementation details
- Any gotchas discovered

---

## Project Overview

**What:** Solo operator command center for GTM enrichment workflows.

**Tech Stack:**
- Frontend: Next.js 15, React 19, TypeScript, Tailwind CSS v4
- Backend: Supabase (PostgreSQL + Edge Functions)
- Enrichment: Zenrows (scraping), n8n (processing), Clay (enrichment)

---

## Two-Database Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    OUTBOUND LAUNCH HQ (HQ)                       │
│              Project: wvjhddcwpedmkofmhfcp                       │
├─────────────────────────────────────────────────────────────────┤
│  Purpose: Orchestration, Config, Logging                         │
│                                                                  │
│  Key Tables:                                                     │
│  - companies                    (target companies)               │
│  - db_driven_enrichment_workflows (workflow config)              │
│  - company_play_step_completions  (UI source of truth)           │
│  - enrichment_results_log         (audit trail)                  │
│  - enrichment_batches             (batch tracking)               │
│                                                                  │
│  Edge Functions: All deployed here                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    WORKSPACE DB                                  │
│              Project: kwxdezafluqhcmovnwbn                       │
├─────────────────────────────────────────────────────────────────┤
│  Purpose: Enrichment Data Storage                                │
│                                                                  │
│  Key Tables:                                                     │
│  - company_homepage_scrapes     (Step 1 - autoparse data)        │
│  - company_case_studies_page    (Step 2 output)                  │
│  - (other step outputs...)                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Architecture Principle

### VERIFIED STORAGE BEFORE COMPLETION

```
Receiver → storage_worker_v2 → [VERIFY DATA EXISTS] → enrichment_logger_v1 → company_play_step_completions
```

**No completion record can exist without verified data in destination table.**

This ensures UI always reflects actual data state.

---

## Workflow Configuration

Workflows are configured in `db_driven_enrichment_workflows` with a `destination_config` JSONB column:

```json
{
  "destinations": [
    {
      "db": "workspace",
      "table": "company_homepage_scrapes",
      "fields": {
        "homepage_html": "homepage_html",
        "scraped_at": "scraped_at"
      }
    }
  ]
}
```

- `db`: "workspace" or "hq"
- `table`: destination table name
- `fields`: mapping from payload field → DB column (null = store as raw JSONB)

---

## Key Edge Functions

| Function | Purpose |
|----------|---------|
| `scrape_homepage_v1` | Step 1: Calls Zenrows, sends to storage_worker |
| `clean_homepage_v1` | Step 2: Sends raw HTML to n8n for cleaning |
| `clean_homepage_receiver_v1` | Step 2: Receives n8n callback, sends to storage_worker |
| `storage_worker_v2` | **Generic**: Stores data based on workflow config, verifies, calls logger |
| `enrichment_logger_v1` | **Generic**: Writes to enrichment_results_log + company_play_step_completions |

---

## Data Flow

```
1. UI: User clicks "Send to Step X" for selected companies
              │
              ▼
2. Workflow Function (e.g., scrape_homepage_v1)
   - Calls external API (Zenrows, n8n, Clay)
   - Sends result to storage_worker_v2
              │
              ▼
3. storage_worker_v2
   - Looks up workflow config by workflow_id
   - Reads destination_config
   - Inserts into destination table
   - VERIFIES insert succeeded (queries back)
   - Calls enrichment_logger_v1
              │
              ▼
4. enrichment_logger_v1
   - Writes to enrichment_results_log (always)
   - Writes to company_play_step_completions (on success)
              │
              ▼
5. UI Updates
   - company_play_step_completions drives UI state
   - Company appears in next step's queue
```

---

## Source of Truth Tables

| Table | Database | Controls |
|-------|----------|----------|
| `company_play_step_completions` | HQ | UI progression, step queues |
| `enrichment_results_log` | HQ | Audit trail |
| Destination tables (varies) | Workspace | Actual enriched data |

**CRITICAL RULE:** Always cross-check completion records against actual data. Never trust completion records alone.

---

## Key UI Pages

| Path | Purpose |
|------|---------|
| `/manual-gtm-enrichment` | **Main UI** - Run companies through enrichment steps |
| `/companies` | View all target companies |
| `/admin` | Admin tools |

---

## Environment Variables

Edge functions run in **HQ project** but need to write to **Workspace DB**.

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | HQ DB URL (auto-set by Supabase) |
| `SUPABASE_SERVICE_ROLE_KEY` | HQ DB full access (auto-set by Supabase) |
| `WORKSPACE_URL` | Workspace DB URL (manually configured) |
| `WORKSPACE_SERVICE_ROLE_KEY` | Workspace DB full access (manually configured) |
| `STORAGE_WORKER_URL` | URL of storage_worker_v2 edge function |
| `ENRICHMENT_LOGGER_URL` | URL of enrichment_logger_v1 edge function |
| `ZENROWS_API_KEY` | For scraping |

**Cross-function calls must include authorization:**
```typescript
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
await fetch(storageWorkerUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${supabaseServiceKey}`,
  },
  body: JSON.stringify(data),
});
```

---

## Deploying Edge Functions

```bash
supabase functions deploy <function_name> --project-ref wvjhddcwpedmkofmhfcp
```

---

## After Completing Work

1. Update `UPDATES.md` with dated entry
2. Run data audit: Cross-check `company_play_step_completions` against actual destination tables
3. Commit changes

---

## File Structure

```
outbound-launch-hq/
├── docs/
│   ├── AI_ONBOARDING.md              ← You are here
│   ├── SOURCE_OF_TRUTH_TABLES.md     ★ MISSION CRITICAL
│   ├── ENRICHMENT_SYSTEM_ARCHITECTURE.md
│   └── RESETTING_ENRICHMENT_STATE.md
├── src/
│   ├── app/
│   │   ├── manual-gtm-enrichment/    ★ Main enrichment UI
│   │   ├── companies/
│   │   └── admin/
│   └── types/
│       └── database.ts
├── supabase/
│   └── functions/
│       ├── storage_worker_v2/        ★ Generic storage with verification
│       ├── enrichment_logger_v1/     ★ Centralized logging
│       ├── scrape_homepage_v1/       Step 1
│       ├── clean_homepage_v1/        Step 2 sender
│       └── clean_homepage_receiver_v1/ Step 2 receiver
├── UPDATES.md
└── guidance.md
```
