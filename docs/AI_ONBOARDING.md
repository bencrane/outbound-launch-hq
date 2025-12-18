# Outbound Launch HQ - AI Onboarding

**Last Updated:** 2025-12-18

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
| 2 | Find Case Studies Page URL | `find_case_studies_page_v1` | ✅ Working (direct OpenAI call) |
| 3 | Scrape Case Studies Page | `scrape_case_studies_page_v1` | ✅ Working (Clay + Zenrows autoparse) |
| 4 | Extract Specific Case Study URLs | `extract_case_study_urls_v1` | ✅ Working (direct OpenAI call) |
| 5 | Extract Buyer Details via Clay | `extract_buyer_details_v1` | ✅ Working |
| 6 | Get Buyer LinkedIn URL | `get_buyer_linkedin_url_v1` | ✅ Config fixed (needs testing) |
| 7 | Enrich LinkedIn Profile | `enrich_linkedin_profile_v1` | Not started |

**Data Flow (new - autoparse, no cleaning steps):**
```
Homepage (autoparse) → Case Studies Page URL (AI) → Scrape Case Studies → Extract URLs → Extract Buyers → Get LinkedIn URLs
```

### RECENTLY FIXED: Step 6 Insert Failure

**See:** `docs/POST_MORTEM_2025_12_18_STEP6_INSERT_FAILURE.md`

**Problem:** Insert to `buyer_linkedin_enrichments` failed with "column 'company_domain' does not exist"

**Root Cause:** `storage_worker_v2` defaults `on_conflict` to `"company_domain"` but the table uses `hq_target_company_domain`

**Fix Applied:** Added `"insert_mode": "insert"` to Step 6 destination config (bypasses upsert/on_conflict entirely)

### What Was Just Changed (2025-12-18)

1. **Step 2 now calls OpenAI directly** - Clay was having issues, switched to gpt-4o
2. **Step 3 uses Clay + Zenrows autoparse** - Returns structured data (links, title, bodyText)
3. **Step 4 calls OpenAI directly** - Extracts case study URLs from links array
4. **Step 6 created** - `get_buyer_linkedin_url_v1` dispatches to Clay for LinkedIn lookup
5. **Fixed `storage_worker_v2` field mappings** - Was interpreting config direction backwards
6. **Deprecated n8n cleaning workflows** - Zenrows autoparse returns structured data
7. **Dropped tables:** `company_homepage_cleaned`, `case_studies_page_cleaned`

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
  "destination_endpoint_url": "https://api.clay.com/v3/sources/webhook/...",
  "receiver_function_url": "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/clay_receiver_v1",
  "storage_worker_function_url": "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/storage_worker_v2",
  "edge_function_name": "scrape_homepage_v1",
  "destinations": [
    {
      "db": "workspace",
      "table": "company_homepage_scrapes",
      "fields": {
        "destination_column": "source_field_from_payload"
      },
      "insert_mode": "upsert",
      "on_conflict": "company_domain"
    }
  ]
}
```

### CRITICAL: Field Mapping Format

**Format is `{ destination_column: source_field }` NOT `{ source_field: destination_column }`**

Example for `buyer_linkedin_enrichments` table:
```json
{
  "fields": {
    "hq_target_company_id": "company_id",
    "hq_target_company_domain": "company_domain",
    "contact_linkedin_url": "linkedin_url"
  }
}
```

This means: "put the value of `company_id` from payload into the `hq_target_company_id` column"

### Destination Config Options

- `db`: "workspace" or "hq"
- `table`: destination table name
- `fields`: mapping from DB column → payload field (null = store as raw JSONB)
- `insert_mode`: "upsert" (default) or "insert"
- `on_conflict`: column(s) for upsert conflict resolution (default: "company_domain")

---

## Key Edge Functions

### Step Functions (Dispatchers)
| Function | Step | Purpose |
|----------|------|---------|
| `scrape_homepage_v1` | 1 | Sends to Clay → Zenrows autoparse |
| `find_case_studies_page_v1` | 2 | Calls OpenAI directly (gpt-4o) |
| `scrape_case_studies_page_v1` | 3 | Sends to Clay → Zenrows autoparse |
| `extract_case_study_urls_v1` | 4 | Calls OpenAI directly (gpt-4o) |
| `extract_buyer_details_v1` | 5 | Sends to Clay |
| `get_buyer_linkedin_url_v1` | 6 | Sends to Clay |

### Generic Infrastructure Functions
| Function | Purpose |
|----------|---------|
| `clay_receiver_v1` | Receives all Clay callbacks, routes to storage_worker |
| `storage_worker_v2` | **Generic**: Stores data based on workflow config, verifies, calls logger |
| `enrichment_logger_v1` | **Generic**: Writes to enrichment_results_log + company_play_step_completions |

### Clay Integration Pattern
```
Dispatcher → Clay → [enrichment] → clay_receiver_v1 → storage_worker_v2 → enrichment_logger_v1
```

**IMPORTANT:** When setting up Clay tables:
- Use **POST** method (not GET) - "Empty request body" errors usually mean wrong HTTP method
- Receiver URL: `https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/clay_receiver_v1`
- Include `workflow_id` in payload for routing

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

### Standard deployment (internal functions):
```bash
supabase functions deploy <function_name> --project-ref wvjhddcwpedmkofmhfcp
```

### CRITICAL: External webhook receivers require `--no-verify-jwt`

Functions that receive callbacks from external services (Clay, n8n, Zenrows) **MUST** be deployed with JWT verification disabled:

```bash
supabase functions deploy clay_receiver_v1 --project-ref wvjhddcwpedmkofmhfcp --no-verify-jwt
supabase functions deploy storage_worker_v2 --project-ref wvjhddcwpedmkofmhfcp --no-verify-jwt
```

Without this flag, external webhooks will get **401 Invalid JWT** errors.

**Functions requiring `--no-verify-jwt`:**
- `clay_receiver_v1` - Receives Clay webhook callbacks
- `storage_worker_v2` - Called by receiver functions
- Any `*_receiver_v1` function

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
│   ├── RESETTING_ENRICHMENT_STATE.md
│   └── POST_MORTEM_*.md              ← Post-mortems for bugs/issues
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
│       ├── clay_receiver_v1/         ★ Clay webhook receiver
│       ├── scrape_homepage_v1/       Step 1
│       ├── find_case_studies_page_v1/ Step 2 (OpenAI direct)
│       ├── scrape_case_studies_page_v1/ Step 3 (Clay)
│       ├── extract_case_study_urls_v1/ Step 4 (OpenAI direct)
│       ├── extract_buyer_details_v1/ Step 5 (Clay)
│       └── get_buyer_linkedin_url_v1/ Step 6 (Clay)
├── UPDATES.md                        ★ Development changelog
└── guidance.md
```

## Post-Mortems

When bugs are found and fixed, document them:
- `docs/POST_MORTEM_2025_12_17_INCOMPLETE_RESET.md` - Deleting data without tracking records
- `docs/POST_MORTEM_2025_12_17_COMPANY_ID_MISMATCH.md` - Using wrong company IDs
- `docs/POST_MORTEM_2025_12_18_HARDCODED_EDGE_FUNCTION_MAPPING.md` - UI hardcoding vs DB config
- `docs/POST_MORTEM_2025_12_18_STEP6_INSERT_FAILURE.md` - Step 6 insert failure (RESOLVED)
