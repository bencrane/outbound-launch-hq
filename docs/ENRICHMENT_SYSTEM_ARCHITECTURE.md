# Enrichment System Architecture

## Overview

The enrichment system processes companies through a series of workflow steps. Each step enriches company data (e.g., scrape homepage, extract case studies, find contacts). The system is designed around these principles:

1. **Workflow ID is the key** - Every operation is tied to a workflow ID
2. **DB is source of truth** - Workflow config in the database determines routing and behavior
3. **Separation of concerns** - Each function has one job
4. **Manual triggering, shared infrastructure** - Users trigger steps manually, but execution uses shared workers

---

## Two Databases

| Database | Purpose | Examples |
|----------|---------|----------|
| **HQ (Outbound Launch HQ)** | Command center, orchestration, logging | `companies`, `db_driven_enrichment_workflows`, `enrichment_results_log`, `company_play_step_completions` |
| **Workspace** | Enrichment data storage | `company_homepage_scrapes`, `company_case_studies_page` |

---

## Core Components

### 1. Workflow-Specific Functions

These are unique per enrichment type. They know HOW to get the data.

**Example: `scrape_homepage_v1`**
- Knows how to call Zenrows API
- Knows the Zenrows parameters (js_render, premium_proxy, etc.)
- Does NOT know where to store data (that's config-driven)

**Responsibility:**
1. Receive company info + workflow_id
2. Call external API (Zenrows, n8n, Clay, etc.)
3. Pass result to storage worker with workflow_id

### 2. Storage Worker (`storage_worker_v2`)

Generic. Works for ALL workflows. Config-driven.

**Responsibility:**
1. Receive `{ workflow_id, company_id, company_domain, data }`
2. Look up workflow config from DB using workflow_id
3. Determine destination DB (workspace or hq) from config
4. Map fields using `destination_field_mappings` from config
5. Insert into `destination_table_name` from config
6. Call logger with result

**Does NOT know:**
- What the data means
- Where it came from
- It just follows config

### 3. Logger (`enrichment_logger_v1`)

Generic. Same for ALL workflows.

**Responsibility:**
1. Receive `{ workflow_id, workflow_slug, company_id, company_domain, play_name, step_number, status, result_table, batch_id? }`
2. Insert into `enrichment_results_log` table in HQ DB (always)
3. Insert into `company_play_step_completions` table in HQ DB (on success)

**Logging Tables:**
| Table | Purpose | When Written |
|-------|---------|--------------|
| `enrichment_results_log` | Records every enrichment result | Always |
| `company_play_step_completions` | Tracks step completion per company | On success |

**NOT used:** `enrichment_logs` (legacy/outdated)

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                           USER ACTION                                │
│                    (clicks "Run Step 1" in UI)                       │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     WORKFLOW-SPECIFIC FUNCTION                       │
│                        (scrape_homepage_v1)                          │
│                                                                      │
│  1. Receive { companies, workflow: { id, slug } }                    │
│  2. Call Zenrows API for each company                                │
│  3. POST to storage_worker_v2 with:                                  │
│     { workflow_id, company_id, company_domain, data: { html } }      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        STORAGE WORKER                                │
│                       (storage_worker_v2)                            │
│                                                                      │
│  1. Lookup config: SELECT * FROM db_driven_enrichment_workflows      │
│                    WHERE id = workflow_id                            │
│                                                                      │
│  2. Config tells us:                                                 │
│     - destination_db: "workspace"                                    │
│     - destination_table_name: "company_homepage_scrapes"             │
│     - destination_field_mappings: { "homepage_html": "homepage_html" }│
│                                                                      │
│  3. Connect to Workspace DB                                          │
│  4. INSERT into company_homepage_scrapes                             │
│  5. POST to enrichment_logger_v1                                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           LOGGER                                     │
│                    (enrichment_logger_v1)                            │
│                                                                      │
│  1. Receive { workflow_id, workflow_slug, company_id, play_name,     │
│               step_number, status, result_table, batch_id? }         │
│  2. INSERT into enrichment_results_log (HQ DB) - always              │
│  3. INSERT into company_play_step_completions (HQ DB) - on success   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Workflow Config Table

`db_driven_enrichment_workflows` in HQ DB:

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key, used by all functions |
| `workflow_slug` | TEXT | Human-readable identifier |
| `title` | TEXT | Display name |
| `overall_step_number` | INT | Order in the pipeline |
| `provider` | TEXT | External service (zenrows, n8n, clay) |
| `destination_db` | TEXT | "workspace" or "hq" |
| `destination_table_name` | TEXT | Where to store data |
| `destination_field_mappings` | JSONB | How to map fields |

**Example config:**
```json
{
  "id": "a30e9102-c4a5-4d0d-b07f-08ca3c54c98a",
  "workflow_slug": "scrape-homepage-via-zenrows",
  "title": "Scrape Homepage",
  "overall_step_number": 1,
  "provider": "zenrows",
  "destination_db": "workspace",
  "destination_table_name": "company_homepage_scrapes",
  "destination_field_mappings": {
    "homepage_html": "homepage_html",
    "scraped_at": "scraped_at"
  }
}
```

---

## Environment Variables

Set on Supabase Edge Functions:

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | HQ DB URL (auto-set) |
| `SUPABASE_SERVICE_ROLE_KEY` | HQ DB key (auto-set) |
| `WORKSPACE_URL` | Workspace DB URL |
| `WORKSPACE_SERVICE_ROLE_KEY` | Workspace DB key |
| `STORAGE_WORKER_URL` | URL of storage_worker_v2 |
| `ENRICHMENT_LOGGER_URL` | URL of enrichment_logger_v1 |
| `ZENROWS_API_KEY` | For scraping |

---

## Why This Architecture?

### 1. Workflow ID as the key
- Single source of truth
- One lookup gives you all routing info
- No hardcoded table names in functions

### 2. Separation of concerns
- Workflow functions: know HOW to call external APIs
- Storage worker: knows HOW to store (config-driven)
- Logger: knows HOW to log
- Changes to logging don't require changing storage worker
- Changes to storage don't require changing workflow functions

### 3. DB-driven config
- Add new workflow = add row to table
- Change destination table = update config, not code
- No redeployment needed for config changes

### 4. Shared infrastructure
- One storage worker serves all workflows
- One logger serves all workflows
- Consistent behavior, less code to maintain

---

## Adding a New Enrichment Step

1. **Create workflow config** in `db_driven_enrichment_workflows`:
   ```sql
   INSERT INTO db_driven_enrichment_workflows (
     workflow_slug, title, overall_step_number, provider,
     destination_db, destination_table_name, destination_field_mappings
   ) VALUES (
     'extract-case-studies-via-n8n',
     'Extract Case Studies',
     3,
     'n8n',
     'workspace',
     'company_case_studies',
     '{"case_study_urls": "urls", "extracted_at": "extracted_at"}'
   );
   ```

2. **Create destination table** in Workspace DB:
   ```sql
   CREATE TABLE company_case_studies (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     company_id UUID,
     company_domain TEXT,
     urls JSONB,
     extracted_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ DEFAULT now()
   );
   ```

3. **Create workflow-specific function** (if needed):
   - Only if calling a new external API
   - Otherwise, can reuse existing patterns

---

## Receiver Pattern (for async callbacks)

Some providers (n8n, Clay) are async - they call back when done.

```
┌──────────────┐     fire & forget     ┌───────────────┐
│ clean_v1     │ ───────────────────▶  │     n8n       │
│ (sender)     │                       │               │
└──────────────┘                       └───────────────┘
                                              │
                                              │ callback
                                              ▼
                                       ┌───────────────┐
                                       │  receiver_v1  │
                                       │               │
                                       └───────────────┘
                                              │
                                              ▼
                                       ┌───────────────┐
                                       │storage_worker │
                                       └───────────────┘
                                              │
                                              ▼
                                       ┌───────────────┐
                                       │    logger     │
                                       └───────────────┘
```

The receiver is thin:
1. Parse callback data
2. Pass to storage worker with workflow_id
3. Storage worker handles the rest

---

## Summary

| Component | Count | Job |
|-----------|-------|-----|
| Workflow functions | Many (1 per step) | Call external APIs |
| Storage worker | 1 | Store data per config |
| Logger | 1 | Log to enrichment_results_log + company_play_step_completions |
| Workflow configs | Many (1 per step) | Define routing |

The workflow_id ties everything together. Functions don't make decisions - they follow config.
