# Outbound Launch HQ - Development Updates

## 2025-12-09

### Session Start
- Project initialized with Next.js, TypeScript, Tailwind
- Core guidance document in place (`guidance.md`)
- Supabase backend configured with initial tables:
  - `pdl_companies` - 23M reference records
  - `companies` - core working table
  - `people` - core working table
- Work continues from a previous session (context not available)

### Admin Section
- Created `/admin` page with card-based navigation
- Added Table Schema Viewer (`/admin/schema`) - requires SQL functions in Supabase
- Added Enrichment Workflows config (`/admin/enrichment-workflows`)

### Companies Page
- Built full Companies table with sortable columns
- Added row selection (individual + select all with indeterminate state)
- Added "Send to Enrichment" functionality:
  - Shows when records selected
  - Dropdown lists active workflows from `enrichment_workflows` table
  - Separate Test/Prod buttons per workflow
  - POSTs selected companies to n8n webhook URL

### Database Types Added
- `EnrichmentWorkflow` type in `src/types/database.ts`
- Fields: id, name, description, pipedream_webhook_url, n8n_webhook_url_test, n8n_webhook_url_prod, is_active, timestamps

### Enrichment Flow
- Data is always sent to Pipedream first (primary endpoint)
- Pipedream receives the selected companies + workflow metadata including the n8n URL
- Pipedream can then forward to n8n as needed
- Payload sent to Pipedream:
  ```json
  {
    "companies": [...],
    "workflow": {
      "name": "Workflow Name",
      "n8n_webhook_url": "https://...",
      "mode": "test" | "prod"
    }
  }
  ```

### SQL Required for New Features
```sql
-- enrichment_workflows table
CREATE TABLE enrichment_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  pipedream_webhook_url TEXT,
  n8n_webhook_url_test TEXT,
  n8n_webhook_url_prod TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE enrichment_workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON enrichment_workflows FOR ALL USING (true);

-- Schema viewer functions (optional)
-- See /admin/schema page for full SQL
```

---

## 2025-12-12

### GTM Teaser Integration - Clay Enrichment Workflows

This session focused on building a complete enrichment pipeline between Outbound Launch HQ (orchestration layer) and GTM Teaser Demo DB (data layer), using Clay as the enrichment provider.

#### Architecture Overview

**Two Supabase Projects:**
1. **Outbound Launch HQ** (`wvjhddcwpedmkofmhfcp`) - Orchestration, workflow config, edge functions
2. **GTM Teaser Demo DB** (`kwxdezafluqhcmovnwbn`) - Source data and enrichment results

**Enrichment Flow Pattern:**
```
[Outbound Launch HQ UI]
       ↓ POST (companies + workflow)
[Dispatcher Edge Function]
       ↓ POST (rate-limited, 100ms between requests)
[Clay Webhook]
       ↓ (Clay enriches data)
       ↓ POST (enriched data + pass-through IDs)
[Receiver Edge Function]
       ↓ INSERT
[GTM Teaser DB Tables]
```

**Key Design Principles:**
- Dispatchers accept `companies` array (matches UI), look up related records
- Pass-through fields (`buyer_detail_id`, `hq_target_company_id`, etc.) enable linking results back to source
- Receivers store to GTM Teaser DB, update source record status
- Rate limiting: 100ms delay between Clay requests (max 10 req/sec)
- Deploy with `--no-verify-jwt` for external webhook access

---

### Workflow 1: Extract Buyer Details from Case Study URLs

**Purpose:** Send case study URLs to Clay, extract buyer contact information using AI.

**Edge Functions:**
- `dispatch_case_study_urls_to_clay_v1` - Dispatcher
- `ingest_case_study_from_clay_v1` - Receiver

**Source Table (GTM Teaser):** `case_study_urls`
**Destination Table (GTM Teaser):** `extracted_buyer_details_from_case_study_urls`

**Fields stored:**
- `case_study_url_id`, `case_study_url`
- `hq_target_company_id`, `hq_target_company_name`, `hq_target_company_domain`
- `customer_name`
- `extracted_buyer_company`, `extracted_contact_name`, `extracted_contact_role`
- `source` ('clay' or 'manual')
- `workflow_id`, `workflow_slug`

---

### Workflow 2: Get LinkedIn URL for Person

**Purpose:** Take extracted buyer details, find their LinkedIn profile URL via Clay.

**Edge Functions:**
- `dispatch_get_person_linkedin_url_v1` - Dispatcher
- `ingest_person_linkedin_url_v1` - Receiver

**Source Table (GTM Teaser):** `extracted_buyer_details_from_case_study_urls`
**Destination Table (GTM Teaser):** `buyer_linkedin_enrichments`

**Dispatcher sends to Clay:**
```json
{
  "buyer_detail_id": "uuid",
  "hq_target_company_id": "uuid",
  "hq_target_company_name": "Company Name",
  "hq_target_company_domain": "company.com",
  "extracted_buyer_company": "Buyer's Company",
  "extracted_contact_name": "John Smith",
  "extracted_contact_role": "VP Sales",
  "receiver_function_url": "https://..."
}
```

**Receiver expects from Clay:**
```json
{
  "buyer_detail_id": "uuid",
  "hq_target_company_id": "uuid",
  "hq_target_company_name": "Company Name",
  "hq_target_company_domain": "company.com",
  "contact_linkedin_url": "https://linkedin.com/in/...",
  "buyer_company_linkedin_url": "https://linkedin.com/company/...",
  "response": "optional",
  "reasoning": "optional",
  "confidence": "optional"
}
```

**SQL for buyer_linkedin_enrichments:**
```sql
CREATE TABLE buyer_linkedin_enrichments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_detail_id UUID NOT NULL,
  hq_target_company_id UUID,
  hq_target_company_name TEXT,
  hq_target_company_domain TEXT,
  contact_linkedin_url TEXT,
  buyer_company_linkedin_url TEXT,
  response TEXT,
  reasoning TEXT,
  confidence TEXT,
  enriched_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_buyer_linkedin_enrichments_buyer_detail
ON buyer_linkedin_enrichments(buyer_detail_id);

CREATE INDEX idx_buyer_linkedin_enrichments_company
ON buyer_linkedin_enrichments(hq_target_company_id);
```

---

### Workflow 3: Enrich Person LinkedIn Profile (PLANNED - NOT YET BUILT)

**Purpose:** Take LinkedIn URL, get full profile data from Clay. Splits into two callbacks for reliability.

**Edge Functions (to create):**
- `dispatch_clay_enrich_person_linkedin_url_v1` - Dispatcher
- `ingest_clay_person_linkedin_profile_v1` - Profile receiver
- `ingest_clay_person_linkedin_work_history_v1` - Work history receiver

**Source Table:** `buyer_linkedin_enrichments` (records with `contact_linkedin_url`)

**Destination Tables (to create in GTM Teaser):**

**1. `clay_person_enriched_linkedin_profile`** - Flat profile data
```sql
CREATE TABLE clay_person_enriched_linkedin_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_detail_id UUID NOT NULL,
  hq_target_company_id UUID,
  hq_target_company_name TEXT,
  hq_target_company_domain TEXT,
  contact_linkedin_url TEXT,
  -- Profile fields (all flat)
  profile_id BIGINT,
  slug TEXT,
  url TEXT,
  name TEXT,
  first_name TEXT,
  last_name TEXT,
  title TEXT,
  org TEXT,
  headline TEXT,
  summary TEXT,
  country TEXT,
  location_name TEXT,
  connections INT,
  num_followers INT,
  jobs_count INT,
  last_refresh TIMESTAMPTZ,
  -- Education as JSONB (less critical for querying)
  education JSONB,
  enriched_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**2. `clay_person_enriched_linkedin_work_history`** - One row per job (fully flat)
```sql
CREATE TABLE clay_person_enriched_linkedin_work_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_detail_id UUID NOT NULL,
  hq_target_company_id UUID,
  hq_target_company_name TEXT,
  hq_target_company_domain TEXT,
  -- Experience fields (all flat, one row per job)
  url TEXT,
  title TEXT,
  org_id BIGINT,
  company TEXT,
  summary TEXT,
  end_date TEXT,
  locality TEXT,
  company_id TEXT,
  is_current BOOLEAN,
  start_date TEXT,
  company_domain TEXT,
  enriched_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_clay_work_history_buyer_detail
ON clay_person_enriched_linkedin_work_history(buyer_detail_id);

CREATE INDEX idx_clay_work_history_company_domain
ON clay_person_enriched_linkedin_work_history(company_domain);
```

**Why two tables?**
- Work history can have 5-10+ entries per person
- Each job becomes a row for later company enrichment workflows
- Avoids large JSONB payloads that may cause Clay HTTP issues
- Enables SQL queries like "find all people who worked at company X"

---

### Manual Upload Feature

**Page:** `/admin/gtm/upload-manual-buyers`

**Purpose:** Upload pre-extracted buyer data (e.g., from testimonial cards) directly to `extracted_buyer_details_from_case_study_urls` without going through Clay.

**Key difference:** Sets `source: "manual"` to distinguish from Clay-enriched records.

---

### Admin UI Updates

**Assign Edge Functions page** (`/admin/assign-edge-functions`):
- Added receiver function role (was missing, only had dispatcher/storage_worker/global_logger)
- UI allows linking edge functions to workflows with proper roles

---

### Workflow Configuration Table

**Table:** `db_driven_enrichment_workflows` (in Outbound Launch HQ DB)

**Key fields:**
- `id`, `workflow_slug`, `status` ('active'/'draft')
- `destination_endpoint_url` - Clay webhook URL
- `receiver_function_url` - Callback URL for Clay to send results
- `dispatcher_function_id`, `receiver_function_id` - FK to edge function registry

---

### Environment Variables Required

**Outbound Launch HQ Edge Functions:**
```
SUPABASE_URL (auto-set)
SUPABASE_SERVICE_ROLE_KEY (auto-set)
GTM_SUPABASE_URL=https://kwxdezafluqhcmovnwbn.supabase.co
GTM_SUPABASE_SERVICE_ROLE_KEY=<service role key>
```

---

### tsconfig.json Fix

Added `"supabase"` to exclude array to prevent Next.js from trying to compile Deno-based edge functions:

```json
{
  "exclude": ["node_modules", "supabase"]
}
```

---

### Deployment Commands

```bash
# Deploy edge function (--no-verify-jwt required for external webhooks)
supabase functions deploy <function_name> --no-verify-jwt

# Set secrets for edge functions
supabase secrets set GTM_SUPABASE_URL=https://...
supabase secrets set GTM_SUPABASE_SERVICE_ROLE_KEY=...
```

---

### Debugging Tips

**Clay sending GET instead of POST:**
- Clay changed default request type - must explicitly set to POST in Clay table settings

**401 Invalid JWT errors:**
- Deploy with `--no-verify-jwt` flag

**NULL values in stored records:**
- Field name mismatch between what Clay sends and what receiver expects
- Check exact field names in Clay HTTP action config

**Workflow not showing in UI:**
- Check `status` field is 'active' not 'draft'

---

### Next Steps (Resuming)

**Workflow 3 - LinkedIn Profile Enrichment:**
1. Create `dispatch_clay_enrich_person_linkedin_url_v1`
2. Create `ingest_clay_person_linkedin_profile_v1`
3. Create `ingest_clay_person_linkedin_work_history_v1`
4. Create both destination tables in GTM Teaser DB
5. Add workflow record to `db_driven_enrichment_workflows`
6. Deploy and test

---

### Workflow 4 & 5: Find ICP People + Enrich Work Email (PLANNED)

**Business Logic:**
- Target company's champions previously worked at other companies
- We want to find prospects at those companies (in ICP roles) who might know/trust the champion
- Then enrich to get work email for cold outreach

**Flow:**
```
[Work History Table: company_domain from champion's past jobs]
       ↓
[Workflow 4: Find People in ICP Roles]
       ↓ Clay finds people matching ICP at those companies
[New Table: clay_found_icp_people]
       ↓ (select limited batch - not whole TAM, just X for outreach)
[Workflow 5: Enrich Work Email]
       ↓ Clay enriches for work email
[New Table: clay_enriched_prospect_emails]
       ↓
[Ready for cold email campaigns]
```

**Workflow 4: Find ICP People at Companies**
- **Input**: Companies (from `clay_person_enriched_linkedin_work_history.company_domain`)
- **Dispatcher**: `dispatch_clay_find_icp_people_v1`
- **Receiver**: `ingest_clay_found_icp_people_v1`
- **Destination Table**: `clay_found_icp_people`

**Workflow 5: Enrich Work Email**
- **Input**: Limited selection from `clay_found_icp_people`
- **Dispatcher**: `dispatch_clay_enrich_work_email_v1`
- **Receiver**: `ingest_clay_enriched_work_email_v1`
- **Destination Table**: `clay_enriched_prospect_emails`

**Note**: Will implement table rotation before hitting 50k row threshold per Clay table

---

### Vision: One-Click TAM Generation Pipeline

**End Goal:** Single click generates full TAM with qualified prospects ready for outreach.

**Architecture - DB as State Machine:**
Each table = a stage in the pipeline. Each row = a unit of work with embedded parameters for the next enrichment.

```
[Input: Target Company]
       ↓
[AI: Define TAM Parameters] ← One-time cost per company
  - Verticals, employee range, geo, ICP titles, etc.
       ↓
[Clay: Find Companies] ← Cheap + FREE firmographics
  - Employee range, revenue, funding, industry, location
       ↓ Store in DB
[AI Gate 1: "Is this B2B?"] ← Filter before expensive ops
       ↓ Qualified companies only
[Clay: Find People in ICP Roles]
       ↓ Store in DB
[AI Gate 2: "Is this person relevant?"] ← Filter again
       ↓ Qualified people only
[Clay: Enrich Work Email] ← Only pay for qualified
       ↓ Store in DB
[GTM Dashboard UI]
  - Filter, sort, segment
  - Export to outreach tools
  - Track engagement
```

**Cost Optimization:**
- AI gates before expensive enrichments
- Clay Find Companies = cheap + free firmographics
- Email enrichment only for qualified prospects
- Staged qualification reduces wasted spend

**Key Insight:**
Dispatcher sends parameters that drive Clay's enrichment logic. The DB doesn't just store data - it encodes what enrichment runs next and with what parameters. Pass-through fields carry context through the entire pipeline.

**Front-End:**
GTM Dashboard on top of the data layer - filterable, sortable, exportable. All the TAM intelligence in one place

---

## 2025-12-13

### Documentation & AI Onboarding

Created comprehensive technical documentation for AI assistant onboarding.

#### New File: `docs/AI_ONBOARDING.md`

A complete technical architecture document covering:

1. **Project Overview** - Purpose, business workflow, tech stack
2. **Two-Database Architecture** - Outbound Launch HQ (orchestration) vs GTM Teaser (data)
3. **Complete Database Schemas** - All tables with SQL and field explanations
4. **Enrichment Pipeline Deep Dive** - 6-step flow with payload examples at each stage
5. **Edge Function Patterns** - Dispatcher, Master Receiver, Storage Worker code patterns
6. **Workflow Configuration System** - DB-driven config explanation
7. **Frontend Architecture** - Key pages and their purposes
8. **Environment & Deployment** - Secrets, deployment commands, tsconfig notes
9. **Critical Gotchas** - Clay POST vs GET, JWT verification, field name mismatches, rate limiting
10. **MUST-READ Files** - Prioritized reading order for any AI starting work

**Purpose:** Any AI instance can read this document and immediately understand:
- How the enrichment pipeline works end-to-end
- How to create new workflows following the blueprint
- What pitfalls to avoid
- Which files to read for specific patterns

#### Key Files Reference

| File | Purpose |
|------|---------|
| `docs/AI_ONBOARDING.md` | Complete technical architecture (NEW) |
| `docs/NEW_ENRICHMENT_WORKFLOW_BLUEPRINT.md` | 8-step workflow creation checklist |
| `guidance.md` | Project context and preferences |
| `UPDATES.md` | This file - development changelog |

---

## 2025-12-17

### Major Pipeline Progress - Steps 1-4 Working End-to-End

After fixing issues from a previous session, the enrichment pipeline now has 4 working steps with proper data storage and logging.

#### Architecture Clarifications

**Current (Correct) Architecture:**
- **storage_worker_v2** - Generic storage worker, reads `destination_config` from workflow
- **enrichment_logger_v1** - Writes to `enrichment_results_log` (always) and `company_play_step_completions` (on success)

**Deprecated (Do Not Use):**
- `master_dispatcher_v1`, `master_receiver_v1`
- `generic_storage_worker_v1`
- `global-enrichment-logger-worker`
- `enrichment_logs` table (use `enrichment_results_log` instead)

**Key Tables (HQ DB):**
- `enrichment_results_log` - Every storage operation logged here
- `company_play_step_completions` - Tracks which companies completed which steps
- `enrichment_batches` - Groups of companies sent through together

---

### Pipeline Monitor Page

**New Page:** `/admin/pipeline-monitor`

Real-time monitoring UI showing:
- `enrichment_results_log` entries with success/error status
- `company_play_step_completions` entries
- Destination table data for selected workflow
- Auto-refresh every 5 seconds
- Filter by workflow/step

---

### Step 3: Find Case Studies Page URL (AI)

**Edge Function:** `find_case_studies_page_v1`

**Purpose:** Analyze href attributes from cleaned homepage, identify the main case studies page, construct full URL.

**Model:** gpt-4o (o1-mini not available on API key)

**Key Innovation - Phased Prompting:**
The AI follows a structured 4-phase approach:

```
PHASE 1 - FILTER: Skip irrelevant hrefs (tel:, mailto:, #, social media)
PHASE 2 - IDENTIFY: Find main case studies page (not individual articles)
PHASE 3 - CONSTRUCT: Build full URL from relative paths + domain
PHASE 4 - VALIDATE: Ensure result is valid https:// URL
```

**Why phased approach:**
- Raw href values can be relative (`/customers`), absolute (`https://...`), or special protocols
- Calling them "links" confused the AI - renamed to "href values extracted from anchor tags"
- Explicit URL construction rules prevent AI from returning relative paths

**Destination Table (Workspace DB):** `company_case_studies_page`
```sql
CREATE TABLE company_case_studies_page (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  company_domain TEXT NOT NULL,
  company_name TEXT,
  case_studies_page_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_company_domain_case_studies UNIQUE (company_domain)
);
```

**Results:**
| Company | Output |
|---------|--------|
| nostra.ai | `https://nostra.ai/success-stories` |
| securitypalhq.com | `https://securitypalhq.com/customers` |
| forethought.ai | `https://forethought.ai/customers` |

---

### Step 4: Scrape Case Studies Page (Zenrows)

**Edge Function:** `scrape_case_studies_page_v1`

**Purpose:** Fetch the case studies page URL from Step 3, scrape with Zenrows.

**Flow:**
1. Read `case_studies_page_url` from `company_case_studies_page` table
2. Call Zenrows with same settings as Step 1 (js_render, premium_proxy, us)
3. Store HTML to `case_studies_page_scrapes`

**Destination Table (Workspace DB):** `case_studies_page_scrapes`
```sql
CREATE TABLE case_studies_page_scrapes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  company_domain TEXT NOT NULL,
  company_name TEXT,
  case_studies_page_url TEXT,
  case_studies_page_html TEXT,
  scraped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_company_domain_cs_scrapes UNIQUE (company_domain)
);
```

---

### Complete Pipeline (Steps 1-4)

```
Step 1: Scrape Homepage (Zenrows)
  └─→ company_homepage_scrapes (Workspace DB)
       ↓
Step 2: Clean Homepage HTML (AI)
  └─→ company_homepage_cleaned (Workspace DB)
       ↓
Step 3: Find Case Studies Page URL (AI - gpt-4o)
  └─→ company_case_studies_page (Workspace DB)
       ↓
Step 4: Scrape Case Studies Page (Zenrows)
  └─→ case_studies_page_scrapes (Workspace DB)
```

**All steps tested successfully with 3 companies:**
- nostra.ai
- securitypalhq.com
- forethought.ai

---

### UI Updates

**Manual GTM Enrichment Page** (`/manual-gtm-enrichment`):
- `stepToEdgeFunction` mapping updated for Steps 1-4

```typescript
const stepToEdgeFunction: Record<number, string> = {
  1: "scrape_homepage_v1",
  2: "clean_homepage_v1",
  3: "find_case_studies_page_v1",
  4: "scrape_case_studies_page_v1",
};
```

**Sidebar:** Added "Pipeline Monitor" link

---

### Fixes Applied

1. **play_name consistency** - All workflows updated to use `case-study-champions` (was mismatched)

2. **scrape_homepage_v1** - Added `play_name` pass-through to storage worker

3. **Edge function auth** - All functions deployed with `--no-verify-jwt`

4. **Step 3 prompt engineering** - Multiple iterations to get AI to return proper full URLs

---

### Cost Estimates

**Step 3 (gpt-4o) for 1000 companies:**
- Input: ~2.5M tokens × $2.50/1M = $6.25
- Output: ~30K tokens × $10/1M = $0.30
- **Total: ~$7 per 1000 companies**

---

### Next Steps

- Step 5: Clean case studies page HTML (AI)
- Step 6+: Extract individual case study URLs, scrape each, extract buyer details

---

*Updates will be added as milestones are completed.*
