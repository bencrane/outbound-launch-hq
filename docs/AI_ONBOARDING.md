# Outbound Launch HQ - AI Onboarding

**Last Updated:** 2025-12-17

---

## MUST-READ FILES (In Order)

Before doing ANY work, read these files:

| # | File | Why |
|---|------|-----|
| 1 | `docs/SOURCE_OF_TRUTH_TABLES.md` | **MISSION CRITICAL** - Which tables control what |
| 2 | `docs/ENRICHMENT_SYSTEM_ARCHITECTURE.md` | How the pipeline works |
| 3 | This file | Project overview |
| 4 | `UPDATES.md` | Development changelog |

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
│  - company_homepage_scrapes     (Step 1 output)                  │
│  - company_homepage_cleaned     (Step 2 output)                  │
│  - (future step outputs...)                                      │
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
