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

---

## 2025-12-17 (Continued) - Steps 5, 6, 7

### Step 5: Clean Case Studies Page HTML (AI)

**Edge Functions:**
- `clean_case_studies_page_v1` - Dispatcher/AI processor
- `clean_case_studies_page_receiver_v1` - Receiver (stores results)

**Purpose:** Clean raw HTML from case studies page scrapes, extract just the href values from anchor tags.

**Source Table (Workspace):** `case_studies_page_scrapes`
**Destination Table (Workspace):** `case_studies_page_cleaned`

```sql
CREATE TABLE case_studies_page_cleaned (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  company_domain TEXT NOT NULL,
  company_name TEXT,
  case_studies_page_url TEXT,
  cleaned_content TEXT,  -- Extracted href values
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_company_domain_cs_cleaned UNIQUE (company_domain)
);
```

---

### Step 6: Extract Specific Case Study URLs (AI)

**Edge Function:** `extract_case_study_urls_v1`

**Purpose:** AI analyzes href values from cleaned case studies page, identifies URLs that point to individual case study pages (not blog posts, not category pages).

**Source Table (Workspace):** `case_studies_page_cleaned`
**Destination Table (Workspace):** `company_specific_case_study_urls`

```sql
CREATE TABLE company_specific_case_study_urls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  company_domain TEXT NOT NULL,
  company_name TEXT,
  case_study_url TEXT NOT NULL,
  case_study_text TEXT,  -- Link text if available
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_case_study_url UNIQUE (company_domain, case_study_url)
);
```

**Key insight:** One company → many case study URLs. This is the first step that produces multiple rows per company.

---

### Step 7: Extract Buyer Details via Clay (IN PROGRESS)

**Edge Function:** `scrape_case_study_url_v1` - Dispatcher to Clay

**Purpose:** Send each case study URL to Clay. Clay uses Claygent to read the page and extract the buyer's details (the champion featured in the case study).

**Source Table (Workspace):** `company_specific_case_study_urls`
**Destination Table (Workspace):** `case_study_buyer_details`

```sql
CREATE TABLE case_study_buyer_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  company_domain TEXT NOT NULL,
  company_name TEXT,
  case_study_url TEXT NOT NULL,
  buyer_full_name TEXT,
  buyer_first_name TEXT,
  buyer_last_name TEXT,
  buyer_job_title TEXT,
  buyer_company_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_case_study_buyer UNIQUE (company_domain, case_study_url)
);
```

**Clay Webhook:** `https://api.clay.com/v3/sources/webhook/pull-in-data-from-a-webhook-2fa75b82-757c-4de8-9a72-441791e9725f`

**Fields Clay extracts:**
- `buyer_full_name` - Full name of the person featured
- `buyer_first_name` - First name
- `buyer_last_name` - Last name
- `buyer_job_title` - Their job title
- `buyer_company_name` - The company they work for (the customer)

---

### Major Architecture Update: `destination_config` Consolidation

**Problem:** Workflow config had separate columns for `storage_worker_function_url`, `receiver_function_url`, etc. This was messy and required schema changes for new fields.

**Solution:** Consolidated all destination-related config into a single `destination_config` JSONB column.

**New `destination_config` structure:**
```json
{
  "destinations": [
    {
      "db": "workspace",
      "table": "case_study_buyer_details",
      "fields": {
        "case_study_url": "case_study_url",
        "buyer_full_name": "buyer_full_name",
        "buyer_job_title": "buyer_job_title"
      },
      "on_conflict": "company_domain,case_study_url"
    }
  ],
  "clay_webhook_url": "https://api.clay.com/...",
  "receiver_function_url": "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/clay_receiver_v1",
  "storage_worker_function_url": "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/storage_worker_v2"
}
```

**Benefits:**
- Single source of truth for workflow routing
- No schema changes needed for new config options
- Clean separation: workflow metadata in columns, routing/storage config in JSON

---

### New Edge Function: `clay_receiver_v1`

**Why created:** `master_receiver_v1` had persistent CDN caching issues. Despite correct local code and multiple deploys (including delete + redeploy), Supabase kept serving old cached code that referenced non-existent columns.

**Solution:** Created fresh function with new name to bypass CDN cache entirely.

**Location:** `supabase/functions/clay_receiver_v1/index.ts`

**Functionality:**
1. Receives webhook callback from Clay
2. Looks up `workflow_id` in `db_driven_enrichment_workflows`
3. Reads `storage_worker_function_url` from `destination_config`
4. Forwards payload to storage worker
5. Supports both single record and array modes (for workflows returning multiple people)

---

### Updated: `storage_worker_v2` - Flat Payload Support

**Problem:** Storage worker required nested `data` wrapper:
```json
{
  "workflow_id": "...",
  "company_id": "...",
  "data": { "buyer_full_name": "..." }  // Required wrapper
}
```

But Clay sends flat payloads naturally:
```json
{
  "workflow_id": "...",
  "company_id": "...",
  "buyer_full_name": "..."  // Flat, no wrapper
}
```

**Fix:** Updated storage worker to accept both formats. If no `data` wrapper exists, extracts data fields from flat payload automatically.

---

### Complete Pipeline (Steps 1-7)

```
Step 1: Scrape Homepage (Zenrows)
  └─→ company_homepage_scrapes
       ↓
Step 2: Clean Homepage HTML (AI)
  └─→ company_homepage_cleaned
       ↓
Step 3: Find Case Studies Page URL (AI)
  └─→ company_case_studies_page
       ↓
Step 4: Scrape Case Studies Page (Zenrows)
  └─→ case_studies_page_scrapes
       ↓
Step 5: Clean Case Studies Page HTML (AI)
  └─→ case_studies_page_cleaned
       ↓
Step 6: Extract Case Study URLs (AI)
  └─→ company_specific_case_study_urls (multiple rows per company)
       ↓
Step 7: Extract Buyer Details (Clay + Claygent) ← IN PROGRESS
  └─→ case_study_buyer_details
```

---

### UI Updates

**Manual GTM Enrichment Page** - Updated `stepToEdgeFunction`:
```typescript
const stepToEdgeFunction: Record<number, string> = {
  1: "scrape_homepage_v1",
  2: "clean_homepage_v1",
  3: "find_case_studies_page_v1",
  4: "scrape_case_studies_page_v1",
  5: "clean_case_studies_page_v1",
  6: "extract_case_study_urls_v1",
  7: "scrape_case_study_url_v1",
};
```

---

### Debugging Notes

**Supabase Edge Function CDN Caching:**
- Edge functions can get stuck serving old code even after deploy
- Delete + redeploy doesn't always fix it
- **Workaround:** Create new function with different name (e.g., `clay_receiver_v1` instead of `master_receiver_v1`)

**Clay Payload Format:**
- Clay sends flat JSON payloads
- Don't require nested wrappers - handle flat format natively

---

---

## 2025-12-18 - Architecture Cleanup & Config-Driven Transition

### Major Changes

#### 1. Deprecated Old Cleaning Workflows

**Removed from active pipeline:**
- `clean-homepage-html-via-n8n` (was Step 2)
- `clean-case-studies-page-html-via-n8n` (was Step 5)

**Reason:** Switched to Zenrows autoparse which returns structured data (links, bodyText, title, socialLinks) instead of raw HTML. No need for n8n cleaning step anymore.

**Deleted Tables (Workspace DB):**
- `company_homepage_cleaned` - dropped
- `case_studies_page_cleaned` - dropped

Migration file: `supabase/migrations-gtm-teaser/20251218_drop_deprecated_cleaning_tables.sql`

#### 2. Workflow Renumbering

Active workflows are now numbered continuously:

| Step | Workflow | Edge Function |
|------|----------|---------------|
| 1 | Scrape Homepage | `scrape_homepage_v1` |
| 2 | Find Case Studies Page URL | `find_case_studies_page_v1` |
| 3 | Scrape Case Studies Page | `scrape_case_studies_page_v1` |
| 4 | Extract Specific Case Study URLs | `extract_case_study_urls_v1` |
| 5 | Extract Buyer Details via Clay | `extract_buyer_details_v1` |
| 6 | Get Buyer LinkedIn URL | `get_buyer_linkedin_url_v1` |
| 7 | Enrich LinkedIn Profile | `enrich_linkedin_profile_v1` |
| 10 | Expand ICP Job Titles | `expand_icp_job_titles_v1` |
| 11 | Find Contacts at Past Employers | `find_contacts_at_past_employers_v1` |
| 12 | Enrich Past Employer Companies | `enrich_past_employer_companies_v1` |

#### 3. Config-Driven Edge Function Names

**Problem:** UI had hardcoded mapping of step numbers to edge function names. This caused bugs when workflows were renumbered.

**Solution:** Added `edge_function_name` to each workflow's `destination_config` in the database.

**Example destination_config:**
```json
{
  "edge_function_name": "find_case_studies_page_v1",
  "source_config": {
    "db": "workspace",
    "table": "company_homepage_scrapes",
    "select_columns": ["homepage_links"]
  },
  "destinations": [{
    "db": "workspace",
    "table": "company_case_studies_page",
    "fields": {"case_studies_page_url": "case_studies_page_url"}
  }],
  "destination_endpoint_url": "https://api.clay.com/v3/sources/webhook/...",
  "receiver_function_url": "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/clay_receiver_v1",
  "storage_worker_function_url": "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/storage_worker_v2"
}
```

**UI Update:** `src/app/manual-gtm-enrichment/page.tsx` now reads `edge_function_name` from workflow config instead of hardcoded mapping.

#### 4. Step 2 Refactored - Config-Driven Source

**Edge Function:** `find_case_studies_page_v1`

**Before:** Hardcoded to read from specific table
**After:** Reads `source_config` from workflow config:
- `source_config.db` - which database ("workspace" or "hq")
- `source_config.table` - which table to read from
- `source_config.select_columns` - which columns to fetch and pass to endpoint

**Flow:**
1. UI calls edge function with companies + workflow.id
2. Edge function looks up workflow config from DB
3. Reads source data from configured table
4. POSTs to `destination_endpoint_url` (Clay webhook)
5. Clay processes and calls back to `receiver_function_url`
6. Receiver → storage_worker → logger

#### 5. Data Reset

All historical enrichment data deleted for clean testing:

**HQ DB (cleared):**
- `enrichment_results_log`
- `company_play_step_completions`
- `enrichment_batches`

**Workspace DB (cleared):**
- `company_homepage_scrapes`
- `company_case_studies_page`
- `company_specific_case_study_urls`
- `case_study_scrapes`

---

### Current State (Handoff)

**What's Working:**
- Step 1 (Scrape Homepage via Zenrows) - ✅ Tested, autoparse returns structured data
- DB is properly configured with `edge_function_name` in all workflow configs

**In Progress (INCOMPLETE):**
- UI update to read `edge_function_name` from workflow config - **PARTIALLY DONE**
  - `WorkflowStep` interface updated ✅
  - Query updated to fetch `destination_config` ✅
  - Hardcoded mapping removed ✅
  - **NOT TESTED** - user interrupted before testing

**What Needs Testing:**
- Step 2 end-to-end: UI → find_case_studies_page_v1 → Clay webhook → callback → storage
- Verify UI correctly reads edge function name from DB

---

### Key Principle (USER EMPHASIZED)

**"DB IS SOURCE OF TRUTH"**

All configuration should come from the database, not hardcoded in code:
- Edge function names → `destination_config.edge_function_name`
- Source table/columns → `destination_config.source_config`
- Destination table/fields → `destination_config.destinations`
- Endpoint URLs → `destination_config.destination_endpoint_url`

---

### Files Modified This Session

| File | Changes |
|------|---------|
| `src/app/manual-gtm-enrichment/page.tsx` | Removed hardcoded mapping, reads edge_function_name from workflow |
| `supabase/functions/find_case_studies_page_v1/index.ts` | Refactored to be fully config-driven |
| `docs/SOURCE_OF_TRUTH_TABLES.md` | Removed references to deleted tables |
| `docs/AI_ONBOARDING.md` | Updated key tables |
| `docs/RESETTING_ENRICHMENT_STATE.md` | Updated step table and examples |
| `docs/ENRICHMENT_SYSTEM_ARCHITECTURE.md` | Updated Workspace DB examples |

---

### Struggles / Issues Encountered

1. **Hardcoded mappings causing silent failures** - Step 2 wasn't working because UI called wrong edge function after workflow renumbering

2. **Need to be more systematic** - User frustrated that changes were made without thinking through full implications

3. **Config updates require function deployment** - Updating DB config alone doesn't help if the edge function still has old hardcoded logic

---

### Next Steps for New AI Instance

1. **Test Step 2 end-to-end** - Send a company through from UI, verify it reaches Clay webhook
2. **Test remaining steps** - Steps 3-7 need validation with new workflow numbering
3. **Follow the principle** - DB is source of truth. Don't hardcode anything.

---

## 2025-12-18 (Session 2) - Step 6 Setup & Debugging

### Step 6: Get Buyer LinkedIn URL via Clay

**Edge Function Created:** `get_buyer_linkedin_url_v1`

**Purpose:** Take extracted buyer details from case studies, find their LinkedIn profile URL via Clay (serper + claygent fallback).

**Source Table (Workspace):** `case_study_buyer_details`
**Destination Table (Workspace):** `buyer_linkedin_enrichments`

**Clay Webhook:** `https://api.clay.com/v3/sources/webhook/pull-in-data-from-a-webhook-1fb48ed7-51ac-4ede-ac57-fd2c454bb26e`

**Payload sent to Clay:**
```json
{
  "source_record_id": "uuid-of-buyer-detail-record",
  "buyer_full_name": "Brenda Perez",
  "buyer_first_name": "Brenda",
  "buyer_last_name": "Perez",
  "buyer_job_title": "Ex-Senior Legal Operations Manager",
  "buyer_company_name": "Apollo.io",
  "case_study_url": "https://example.com/case-study/apollo",
  "company_id": "uuid",
  "company_domain": "spotdraft.com",
  "company_name": "SpotDraft",
  "workflow_id": "820b7962-f968-48d8-84fa-3a8b27e80adb",
  "workflow_slug": "get-buyer-linkedin-url-via-clay",
  "play_name": "case-study-champions",
  "step_number": 6,
  "receiver_function_url": "https://wvjhddcwpedmkofmhfcp.supabase.co/functions/v1/clay_receiver_v1"
}
```

**Clay should return:**
```json
{
  "source_record_id": "uuid-from-input",
  "company_id": "uuid-from-input",
  "company_domain": "from-input",
  "company_name": "from-input",
  "buyer_full_name": "from-input",
  "buyer_job_title": "from-input",
  "buyer_company_name": "from-input",
  "linkedin_url": "https://linkedin.com/in/the-person",
  "workflow_id": "from-input"
}
```

**Key field Clay populates:** `linkedin_url`

---

### Step 2 Updated: Direct OpenAI Call (No Clay)

**Edge Function:** `find_case_studies_page_v1`

Changed from sending to Clay to calling OpenAI directly with gpt-4o. Clay was having issues.

**Key changes:**
- Calls OpenAI directly instead of Clay webhook
- Uses 4-phase prompt: FILTER → IDENTIFY → CONSTRUCT → VALIDATE
- Returns `case_studies_page_url` directly
- Removed confidence/reasoning fields (unnecessary, increases tokens)

---

### Step 3 Updated: Zenrows Autoparse via Clay

**Edge Function:** `scrape_case_studies_page_v1`

Now sends to Clay which uses Zenrows autoparse. Returns structured data instead of raw HTML.

**Destination Table Updated:** `case_studies_page_scrapes`
```sql
-- Autoparse output (structured data, not raw HTML)
links JSONB,           -- Array of {href, text}
title TEXT,            -- Page title
body_text TEXT,        -- Extracted body text
description TEXT       -- Meta description
```

---

### Bug Fixes Applied This Session

#### 1. storage_worker_v2 Field Mapping Direction

**Problem:** Config format is `{ destination_column: source_field }` but code treated it as `{ source_field: destination_column }`.

**Fix:** Updated mapping loop to use correct direction:
```typescript
// Before (wrong)
for (const [sourceField, destColumn] of Object.entries(dest.fields))

// After (correct)
for (const [destColumn, sourceField] of Object.entries(dest.fields))
```

#### 2. Base Field Custom Mappings

**Problem:** storage_worker always added `company_domain` as column name, but `buyer_linkedin_enrichments` uses `hq_target_company_domain`.

**Fix:** Added custom mapping checks for base fields (company_id, company_domain, company_name). If a mapping exists, uses the mapped column name.

#### 3. JWT Authentication for Internal Calls

**Problem:** `clay_receiver_v1` calling `storage_worker_v2` got 401 errors.

**Fix:** Deploy both functions with `--no-verify-jwt`:
```bash
supabase functions deploy clay_receiver_v1 --no-verify-jwt --project-ref wvjhddcwpedmkofmhfcp
supabase functions deploy storage_worker_v2 --no-verify-jwt --project-ref wvjhddcwpedmkofmhfcp
```

---

### UNRESOLVED: Step 6 Insert Failure

**Current Error:** `"column \"company_domain\" does not exist"`

**Root Cause (Likely):** The upsert `on_conflict` clause defaults to `company_domain`:
```typescript
const conflictColumns = dest.on_conflict || "company_domain";
```

But `buyer_linkedin_enrichments` doesn't have `company_domain` column.

**See:** `docs/POST_MORTEM_2025_12_18_STEP6_INSERT_FAILURE.md` for full analysis and next steps.

**Probable Fix:**
1. Add `"on_conflict": "hq_target_company_domain"` to Step 6 destination config
2. Or use `"insert_mode": "insert"` since table allows multiple rows

---

### Files Modified This Session

| File | Changes |
|------|---------|
| `supabase/functions/get_buyer_linkedin_url_v1/index.ts` | Created new edge function |
| `supabase/functions/storage_worker_v2/index.ts` | Fixed field mapping direction |
| `supabase/functions/clay_receiver_v1/index.ts` | Removed auth headers (use --no-verify-jwt instead) |
| `supabase/functions/find_case_studies_page_v1/index.ts` | Direct OpenAI call, removed confidence/reasoning |
| `supabase/functions/scrape_case_studies_page_v1/index.ts` | Send to Clay instead of Zenrows direct |
| `docs/POST_MORTEM_2025_12_18_STEP6_INSERT_FAILURE.md` | Created - documents unresolved issue |

---

### Deployments Made

```bash
# All deployed with --no-verify-jwt
supabase functions deploy get_buyer_linkedin_url_v1 --no-verify-jwt --project-ref wvjhddcwpedmkofmhfcp
supabase functions deploy storage_worker_v2 --no-verify-jwt --project-ref wvjhddcwpedmkofmhfcp
supabase functions deploy clay_receiver_v1 --no-verify-jwt --project-ref wvjhddcwpedmkofmhfcp
supabase functions deploy find_case_studies_page_v1 --no-verify-jwt --project-ref wvjhddcwpedmkofmhfcp
```

---

### Next Steps for New AI Instance

1. **Fix Step 6 insert failure** - See post-mortem doc. Update workflow config to add `on_conflict` or `insert_mode`.

2. **Test Step 6 again** - After fixing config, retry from Clay.

3. **Key insight about field mappings:**
   - Config format: `{ destination_column: source_field }`
   - Example: `"hq_target_company_domain": "company_domain"` means read from `company_domain` in payload, write to `hq_target_company_domain` in table

---

*Updates will be added as milestones are completed.*
