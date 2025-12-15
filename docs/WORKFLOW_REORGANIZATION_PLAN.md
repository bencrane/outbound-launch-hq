# Plan: Reorganize & Migrate Workflows to Unified Logging Architecture

## Executive Summary

**Goals**:
1. **Reorganize**: Rename and recategorize ALL workflows for clarity and consistency
2. **Standardize**: Ensure all workflows properly log to `enrichment_logs` table
3. **Clean up**: Remove/archive deprecated workflows, create missing destination tables

**Current State**:
- 13 total workflows across inconsistent categories
- 5 workflows properly log (use `generic_storage_worker_v1`)
- 4 workflows have custom storage workers that may not log
- 4 workflows have NO logging configured at all
- Naming is inconsistent (mix of phase-based, action-based, provider-based)

**Approach**:
1. First, reorganize workflows with consistent naming and categories
2. Then, ensure all workflows log properly (via generic_storage_worker or adding logging to custom workers)

---

## Proposed Reorganization

### Naming Convention Options

#### Option A: Phase-Action-Entity-Provider (Recommended)
**Pattern**: `phase-{N}-{action}-{entity}-{provider}`

**Pros**:
- Clear pipeline ordering (phase-1, phase-2, etc.)
- Self-documenting what step comes next
- Easy to see dependencies

**Cons**:
- Longer names
- Phase numbers may need renumbering if pipeline changes

**Example**: `phase-3-enrich-linkedin-profile-clay`

---

#### Option B: Action-Entity-Provider (Shorter)
**Pattern**: `{action}-{entity}-{provider}`

**Pros**:
- Shorter, cleaner names
- Action-first makes it easy to find "all enrichment workflows"

**Cons**:
- No inherent ordering
- Relies on category for pipeline position

**Example**: `enrich-linkedin-profile-clay`

---

#### Option C: Entity-Action-Provider (Entity-First)
**Pattern**: `{entity}-{action}-{provider}`

**Pros**:
- Easy to find "all person workflows" or "all company workflows"
- Groups related entities together alphabetically

**Cons**:
- No inherent ordering
- Action buried in middle

**Example**: `person-enrich-linkedin-clay`

---

### Recommended: Option A with Simplified Actions

**Simplified Action Vocabulary**:
| Action | Meaning | Used For |
|--------|---------|----------|
| `find` | Discover/locate something | Finding URLs, finding contacts |
| `scrape` | Fetch raw HTML/data | Zenrows, web scraping |
| `clean` | Process/clean raw data | HTML cleaning, parsing |
| `extract` | Pull structured data from unstructured | AI extraction from text |
| `enrich` | Add data from external source | Clay, API enrichments |
| `expand` | Generate variations/derivatives | AI job title expansion |

**Simplified Entity Vocabulary**:
| Entity | Meaning |
|--------|---------|
| `case-study` | Case study page/URL |
| `buyer` | Person extracted from case study |
| `person` or `profile` | LinkedIn profile data |
| `company` | Company data |
| `contact` | New person found at company |
| `job-title` | ICP job titles |

---

### Category Structure Options

#### Option A: Numbered Pipeline Stages (Recommended)
| Category | Description |
|----------|-------------|
| `1-data-collection` | Scraping, initial data gathering |
| `2-extraction` | AI/parsing to extract structured data |
| `3-person-enrichment` | Enrich person/buyer profiles |
| `4-company-enrichment` | Enrich company data |
| `5-contact-discovery` | Find new contacts at companies |

**Pros**: Visual pipeline ordering in UI dropdowns

---

#### Option B: Semantic Categories (No Numbers)
| Category | Description |
|----------|-------------|
| `data-collection` | Scraping, initial data gathering |
| `extraction` | AI/parsing to extract structured data |
| `person-enrichment` | Enrich person/buyer profiles |
| `company-enrichment` | Enrich company data |
| `contact-discovery` | Find new contacts at companies |

**Pros**: Cleaner names without arbitrary numbers

---

### Full Rename Mapping (Using Option A)

#### GTM Teaser Pipeline

| # | Current Slug | Proposed Slug | Category |
|---|-------------|---------------|----------|
| 1 | `ai-determine-main-case-studies-page-url` | `phase-1-find-case-study-page-ai` | 1-data-collection |
| 2 | `zenrows_scrape_main_case_studies_page_url` | `phase-1-scrape-case-study-page-zenrows` | 1-data-collection |
| 3 | `clean_extracted_main_case_studies_page_raw_scraped_content` | `phase-2-clean-case-study-html` | 2-extraction |
| 4 | `send_to_ai_extract_specific_case_study_urls` | `phase-2-extract-case-study-urls-ai` | 2-extraction |
| 5 | `company_specific_case_study_url_details_claygent_extraction` | `phase-2-extract-buyer-details-clay` | 2-extraction |
| 6 | `get-person-linkedin-url` | `phase-3-find-buyer-linkedin-clay` | 3-person-enrichment |
| 7 | `clay-enrich-person-linkedin-profile` | `phase-3-enrich-linkedin-profile-clay` | 3-person-enrichment |
| 8 | `expand-icp-job-titles` | `phase-3-expand-job-titles-ai` | 3-person-enrichment |
| 9 | `clay-enrich-company-from-work-history` | `phase-4-enrich-company-clay` | 4-company-enrichment |
| 10 | `enrich-buyer-past-employers` | `phase-4-enrich-company-waterfall` | 4-company-enrichment |
| 11 | `clay-find-contacts-at-buyer-past-employer` | `phase-5-find-contacts-clay` | 5-contact-discovery |

#### Outbound Launch HQ Pipeline

| # | Current Slug | Proposed Slug | Category |
|---|-------------|---------------|----------|
| 12 | `company_zenrows_scrape_home_page` | `ol-phase-1-scrape-homepage-zenrows` | 1-data-collection |
| 13 | `company_zenrows_raw_data_cleaning` | `ol-phase-2-clean-homepage-html` | 2-extraction |

**Note**: `ol-` prefix = Outbound Launch (distinguishes from GTM Teaser pipeline)

---

### Alternative: Letter-Based Ordering

Instead of `phase-1`, `phase-2`, use letters that describe the stage:

| Stage | Letter | Example |
|-------|--------|---------|
| Data Collection | `a-collect` | `a-collect-scrape-case-study-zenrows` |
| Extraction | `b-extract` | `b-extract-buyer-details-clay` |
| Person Enrichment | `c-enrich-person` | `c-enrich-person-linkedin-clay` |
| Company Enrichment | `d-enrich-company` | `d-enrich-company-clay` |
| Contact Discovery | `e-discover` | `e-discover-contacts-clay` |

**Pros**: Letters provide ordering AND semantic meaning
**Cons**: Longer names, may feel awkward

---

## Table Verification Results

**GTM Teaser DB**:
| Table | Status |
|-------|--------|
| `company_case_studies_page_raw_scraped` | Does NOT exist |
| `company_case_studies_page_cleaned` | Does NOT exist |
| `company_specific_case_study_urls` | Does NOT exist |
| `ai_expanded_icp_job_titles` | EXISTS |
| `extracted_buyer_details_from_case_study_urls` | EXISTS |

**Outbound Launch HQ DB**: Pending verification for zenrows tables

---

## Current Workflow Inventory

### Category A: ALREADY WORKING (No changes needed)
| Workflow Slug | Storage Worker | Logs? |
|--------------|----------------|-------|
| `get-person-linkedin-url` | `generic_storage_worker_v1` | Yes |
| `clay-enrich-person-linkedin-profile` | `generic_storage_worker_v1` | Yes |
| `clay-find-contacts-at-buyer-past-employer` | `generic_storage_worker_v1` | Yes |
| `clay-enrich-company-from-work-history` | `generic_storage_worker_v1` | Yes |
| `enrich-buyer-past-employers` | `generic_storage_worker_v1` | Yes |

### Category B: CUSTOM STORAGE WORKERS (Need migration)
| Workflow Slug | Current Storage Worker | Destination Table |
|--------------|------------------------|-------------------|
| `zenrows_scrape_main_case_studies_page_url` | `store-raw-zenrows-scraped-main-case-studies-page-content` | `company_case_studies_page_raw_scraped` |
| `clean_extracted_main_case_studies_page_raw_scraped_content` | `store-cleaned-main-case-studies-url-zenrows-scrape-data` | `company_case_studies_page_cleaned` |
| `send_to_ai_extract_specific_case_study_urls` | `store-ai-returned-specific-case-study-links` | `company_specific_case_study_urls` |
| `expand-icp-job-titles` | `expand_icp_job_titles_v1` | `ai_expanded_icp_job_titles` |

### Category C: NO LOGGING AT ALL (Need configuration)
| Workflow Slug | Issue |
|--------------|-------|
| `ai-determine-main-case-studies-page-url` | `global_logger_function_url` is NULL |
| `company_specific_case_study_url_details_claygent_extraction` | Both storage_worker and logger URLs are NULL |
| `company_zenrows_scrape_home_page` | Both URLs are NULL (Outbound Launch HQ category) |
| `company_zenrows_raw_data_cleaning` | Both URLs are NULL (Outbound Launch HQ category) |

---

## Key Discovery: Custom Storage Workers Don't Exist Locally

The exploration revealed that **the custom storage workers referenced in Category B do not exist in the local codebase**. They may be:
1. Deployed directly to Supabase but not in version control
2. Legacy/orphaned references that never worked
3. Deleted but workflow config not updated

**This is actually good news** - it means we can confidently migrate to `generic_storage_worker_v1` without worrying about preserving custom logic.

---

## Architecture: How generic_storage_worker_v1 Works

```
┌─────────────────────────────────────────────────────────────────┐
│ INCOMING PAYLOAD (from Clay/API via master_receiver_v1)         │
│ {                                                               │
│   "workflow_id": "uuid",                                        │
│   "hq_target_company_id": "uuid",                               │
│   "hq_target_company_domain": "example.com",                    │
│   "field1": "value1",                                           │
│   "field2": "value2",                                           │
│   "nested_payload": { ... }  // Optional raw payload            │
│ }                                                               │
└────────────────────────────────────────────────────────────────▼┘
                                                                   │
┌──────────────────────────────────────────────────────────────────┤
│ generic_storage_worker_v1                                        │
│                                                                  │
│ 1. Look up workflow config by workflow_id                        │
│ 2. Map fields using destination_field_mappings                   │
│ 3. Insert into destination_table_name                            │
│ 4. Explode arrays using array_field_configs (if configured)      │
│ 5. Store raw payload in raw_payload_table_name (if configured)   │
│ 6. Call global_logger_function_url with success/error            │
└──────────────────────────────────────────────────────────────────┘
```

**Key Configuration Fields**:
- `destination_table_name` - Where to store the enriched data
- `destination_field_mappings` - JSON mapping: `{ "source_field": "destination_column" }`
- `storage_worker_function_url` - Must point to `generic_storage_worker_v1`
- `global_logger_function_url` - Must point to `global-enrichment-logger-worker`

---

## Migration Strategy

### Phase 1: Audit & Document Current State
1. Query all workflows and their current configurations
2. Identify which destination tables exist vs need creation
3. Document the expected field mappings for each workflow

### Phase 2: Ensure Destination Tables Exist
For each workflow, verify the destination table exists in GTM Teaser DB. If not, create migration.

### Phase 3: Update Workflow Configurations
For each workflow in Categories B and C:
1. Set `storage_worker_function_url` to `generic_storage_worker_v1`
2. Set `global_logger_function_url` to `global-enrichment-logger-worker`
3. Configure `destination_table_name`
4. Configure `destination_field_mappings` (JSON)

### Phase 4: Test Each Workflow
1. Trigger a test enrichment for each migrated workflow
2. Verify data appears in destination table
3. Verify log entry appears in `enrichment_logs`

---

## Detailed Migration Plan by Workflow

### Workflow 1: `ai-determine-main-case-studies-page-url`
**Category**: C (No logging)
**Current State**: Has storage worker `store-ai-determined-main-case-studies-url-response` but no logger URL
**Destination Table**: `hq_target_companies` (updates `ai_determined_case_studies_main_page_url` column)

**Issue**: This workflow UPDATES an existing record rather than INSERTING a new one. The `generic_storage_worker_v1` only does INSERTs.

**Options**:
- A) Keep custom storage worker, add logging call to it
- B) Create a separate results table and update the main table via trigger
- C) Modify generic_storage_worker to support upserts

**Recommendation**: Option A - Keep custom worker but add logging. This is the simplest path for UPDATE workflows.

---

### Workflow 2: `zenrows_scrape_main_case_studies_page_url`
**Category**: B (Custom storage worker)
**Destination Table**: `company_case_studies_page_raw_scraped` (needs verification)

**Migration**:
1. Verify/create destination table with schema:
   ```sql
   CREATE TABLE company_case_studies_page_raw_scraped (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     hq_target_company_id UUID,
     hq_target_company_name TEXT,
     hq_target_company_domain TEXT,
     case_studies_page_url TEXT,
     raw_html TEXT,
     workflow_id UUID,
     workflow_slug TEXT,
     enriched_at TIMESTAMPTZ DEFAULT now()
   );
   ```
2. Update workflow config with field mappings

---

### Workflow 3: `clean_extracted_main_case_studies_page_raw_scraped_content`
**Category**: B (Custom storage worker)
**Destination Table**: `company_case_studies_page_cleaned`

**Migration**:
1. Verify/create destination table
2. Configure field mappings for cleaned content

---

### Workflow 4: `send_to_ai_extract_specific_case_study_urls`
**Category**: B (Custom storage worker)
**Destination Table**: `company_specific_case_study_urls`

**Migration**:
1. Verify table exists (referenced in enrichment_logs)
2. Configure field mappings

---

### Workflow 5: `expand-icp-job-titles`
**Category**: B (Custom storage worker)
**Current State**: Uses `expand_icp_job_titles_v1` which does custom AI processing
**Destination Table**: `ai_expanded_icp_job_titles`

**Issue**: This is NOT a simple storage workflow. It:
1. Calls OpenAI to expand job titles
2. Generates multiple output records from one input
3. Has complex business logic

**Recommendation**: This workflow should remain as a custom function BUT we should add a logging call to the existing function. Do NOT migrate to generic_storage_worker.

---

### Workflow 6: `company_specific_case_study_url_details_claygent_extraction`
**Category**: C (No storage worker or logger)
**Current State**: Neither storage_worker_function_url nor global_logger_function_url configured

**Migration**:
1. Determine destination table (likely `extracted_buyer_details_from_case_study_urls`)
2. Configure storage worker and logger URLs
3. Add field mappings

---

### Workflows 7-8: Outbound Launch HQ Category
`company_zenrows_scrape_home_page` and `company_zenrows_raw_data_cleaning`

**Assessment**: These appear to be older workflows for the Outbound Launch HQ company pipeline (not GTM Teaser). They may be:
- Deprecated/unused
- Waiting to be configured
- Part of a different use case

**Recommendation**: Consult with user on whether these are active/needed before migrating.

---

## Implementation Plan (Ordered Steps)

### Step 1: Create Missing Destination Tables
Create migrations in `/supabase/migrations-gtm-teaser/` for:
- [ ] `case_studies_page_raw_scraped` - For zenrows scrape output
- [ ] `case_studies_page_cleaned` - For cleaned HTML content
- [ ] `case_study_urls` - For AI-extracted case study URLs (if not using existing `hq_case_study_urls`)

### Step 2: Rename All Workflows (Database Updates)
Update `db_driven_enrichment_workflows` table via SQL:
```sql
-- Example: UPDATE workflow slugs, titles, and categories
UPDATE db_driven_enrichment_workflows
SET
  workflow_slug = 'phase-1-find-case-studies-page-ai',
  title = 'Phase 1: Find Case Studies Page (AI)',
  category = '1-data-collection'
WHERE workflow_slug = 'ai-determine-main-case-studies-page-url';
-- ... repeat for all 13 workflows
```

### Step 3: Configure Logging for All Workflows
For each workflow, ensure these fields are set:
- `storage_worker_function_url` → `generic_storage_worker_v1` (where applicable)
- `global_logger_function_url` → `global-enrichment-logger-worker`
- `destination_table_name` → correct destination table
- `destination_field_mappings` → JSON field mapping

### Step 4: Add Logging to Custom Functions
For workflows that must keep custom logic (UPDATE operations, AI processing):
- [ ] `expand_icp_job_titles_v1/index.ts` - Add logging call
- [ ] Create/update storage workers for UPDATE-based workflows with logging

### Step 5: Update UI to Reflect New Categories
- [ ] Update Company Enrichment Status page to group by new categories
- [ ] Update any hardcoded workflow references in UI

### Step 6: Test End-to-End
- [ ] Test each workflow produces logs in `enrichment_logs`
- [ ] Verify Company Enrichment Status page shows accurate data
- [ ] Verify no regressions in actual enrichment functionality

---

## Files to Modify

### Database Migrations (New)
- `/supabase/migrations-gtm-teaser/YYYYMMDD_create_case_studies_page_raw_scraped.sql`
- `/supabase/migrations-gtm-teaser/YYYYMMDD_create_case_studies_page_cleaned.sql`

### Edge Functions (Modify)
- `/supabase/functions/expand_icp_job_titles_v1/index.ts` - Add logging call

### UI Components (Modify)
- `/src/app/admin/company-enrichment-status/page.tsx` - Update category display

### Workflow Config (Database)
- `db_driven_enrichment_workflows` table - Update 13 rows

---

## Workflow Migration Details by Phase

### Phase 1: Data Collection (2 workflows)

**1. `phase-1-find-case-studies-page-ai`** (was: `ai-determine-main-case-studies-page-url`)
- Type: UPDATE workflow (updates `hq_target_companies.ai_determined_case_studies_main_page_url`)
- Action: Keep custom storage worker, add logging call
- Status: Needs logging added

**2. `phase-1-scrape-case-studies-page-zenrows`** (was: `zenrows_scrape_main_case_studies_page_url`)
- Type: INSERT workflow
- Destination: `case_studies_page_raw_scraped` (NEW TABLE)
- Action: Migrate to generic_storage_worker + create destination table
- Status: Needs table + full config

### Phase 2: Extraction (3 workflows)

**3. `phase-2-clean-case-studies-html`** (was: `clean_extracted_main_case_studies_page_raw_scraped_content`)
- Type: INSERT workflow
- Destination: `case_studies_page_cleaned` (NEW TABLE)
- Action: Migrate to generic_storage_worker + create destination table
- Status: Needs table + full config

**4. `phase-2-extract-case-study-urls-ai`** (was: `send_to_ai_extract_specific_case_study_urls`)
- Type: INSERT workflow
- Destination: `hq_case_study_urls` (EXISTS - verify)
- Action: Migrate to generic_storage_worker
- Status: Needs full config

**5. `phase-2-extract-buyer-from-case-study-clay`** (was: `company_specific_case_study_url_details_claygent_extraction`)
- Type: INSERT workflow
- Destination: `extracted_buyer_details_from_case_study_urls` (EXISTS)
- Action: Migrate to generic_storage_worker
- Status: Needs full config

### Phase 3: Person Enrichment (3 workflows) - MOSTLY WORKING

**6. `phase-3-find-linkedin-url-clay`** (was: `get-person-linkedin-url`)
- Status: Already logs correctly
- Action: Rename only

**7. `phase-3-enrich-linkedin-profile-clay`** (was: `clay-enrich-person-linkedin-profile`)
- Status: Already logs correctly
- Action: Rename only

**8. `phase-3-expand-job-titles-ai`** (was: `expand-icp-job-titles`)
- Type: Custom AI processing (generates multiple records)
- Action: Keep custom function, add logging call to code
- Status: Needs code change for logging

### Phase 4: Company Enrichment (2 workflows) - WORKING

**9. `phase-4-enrich-company-clay`** (was: `clay-enrich-company-from-work-history`)
- Status: Already logs correctly
- Action: Rename only

**10. `phase-4-enrich-past-employer-waterfall`** (was: `enrich-buyer-past-employers`)
- Status: Already logs correctly
- Action: Rename only

### Phase 5: Contact Discovery (1 workflow) - WORKING

**11. `phase-5-find-contacts-clay`** (was: `clay-find-contacts-at-buyer-past-employer`)
- Status: Already logs correctly
- Action: Rename only

### Outbound Launch HQ (2 workflows)

**12. `ol-phase-1-scrape-homepage-zenrows`** (was: `company_zenrows_scrape_home_page`)
- Type: INSERT workflow
- Destination: TBD (Outbound Launch HQ DB)
- Action: Full config needed
- Status: Needs table + full config

**13. `ol-phase-2-clean-homepage-html`** (was: `company_zenrows_raw_data_cleaning`)
- Type: INSERT workflow
- Destination: TBD (Outbound Launch HQ DB)
- Action: Full config needed
- Status: Needs table + full config

---

## Summary: Work Breakdown

| Category | Workflows | Action Required |
|----------|-----------|-----------------|
| Rename only | 5 | Update slug, title, category in DB |
| Add logging to custom code | 2 | Modify edge function code |
| Full migration + new table | 4 | Create table + configure generic_storage_worker |
| Full migration (table exists) | 2 | Configure generic_storage_worker only |
| **Total** | **13** | |

### Estimated Effort
- **Database migrations**: 2-3 new tables
- **Workflow config updates**: 13 SQL UPDATE statements
- **Code changes**: 1-2 edge functions need logging added
- **UI updates**: Minor - category display in status page

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Breaking existing workflows | Medium | High | Test thoroughly in sequence; keep backups of workflow configs |
| Missing destination tables | Low | Medium | Verify tables exist before updating workflow configs |
| Field mapping errors | Medium | Medium | Document expected payloads; test with real data |
| Custom logic workflows fail | Low | High | Don't migrate expand-icp-job-titles to generic worker |

---

## Success Criteria

1. All active workflows have `global_logger_function_url` configured
2. All storage workers either use `generic_storage_worker_v1` OR call the logger explicitly
3. Company Enrichment Status page shows accurate completion data for SecurityPal AI
4. No regression in existing enrichment functionality
