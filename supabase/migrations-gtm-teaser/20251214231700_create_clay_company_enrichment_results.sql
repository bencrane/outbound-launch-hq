-- Migration: Create destination table for clay_company_enrichment provider
-- Target DB: GTM Teaser (kwxdezafluqhcmovnwbn)

CREATE TABLE IF NOT EXISTS clay_company_enrichment_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source references (pass-through from dispatcher)
  source_record_id UUID,
  hq_target_company_id UUID,
  hq_target_company_name TEXT,
  hq_target_company_domain TEXT,

  -- Workflow context
  workflow_id UUID,
  workflow_slug TEXT,
  enrichment_provider TEXT DEFAULT 'clay_company_enrichment',

  -- Core company fields
  linkedin_url TEXT,
  company_name TEXT,
  slug TEXT,
  company_type TEXT,                     -- "Public Company", "Private", etc.
  domain TEXT,
  website TEXT,
  logo_url TEXT,
  industry TEXT,
  description TEXT,
  locality TEXT,                         -- "Redwood City, CA"
  country TEXT,
  founded INT,

  -- IDs
  org_id INT,
  company_id INT,
  clay_company_id INT,

  -- Size/financials
  size TEXT,                             -- "1,001-5,000 employees"
  employee_count INT,
  follower_count INT,
  annual_revenue TEXT,                   -- "1B-10B"
  total_funding_range TEXT,              -- "$250M+"

  -- Derived datapoints (flattened key fields)
  derived_industry JSONB,
  derived_subindustry JSONB,
  derived_description TEXT,
  derived_scale_scope TEXT,
  derived_pattern_tags TEXT,
  derived_business_type JSONB,
  derived_business_stage TEXT,
  derived_revenue_streams JSONB,
  derived_primary_offerings JSONB,

  -- Resolved domain info
  resolved_domain_value TEXT,
  resolved_domain_is_live BOOLEAN,
  resolved_domain_redirects BOOLEAN,

  -- Arrays stored as JSONB
  specialties JSONB,
  locations JSONB,

  -- Raw nested objects
  resolved_domain_raw JSONB,
  derived_datapoints_raw JSONB,

  -- Metadata
  last_refresh TIMESTAMPTZ,
  enriched_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clay_ce_source_record ON clay_company_enrichment_results(source_record_id);
CREATE INDEX IF NOT EXISTS idx_clay_ce_hq_company ON clay_company_enrichment_results(hq_target_company_id);
CREATE INDEX IF NOT EXISTS idx_clay_ce_domain ON clay_company_enrichment_results(domain);
CREATE INDEX IF NOT EXISTS idx_clay_ce_linkedin ON clay_company_enrichment_results(linkedin_url);
CREATE INDEX IF NOT EXISTS idx_clay_ce_workflow ON clay_company_enrichment_results(workflow_id);

-- RLS
ALTER TABLE clay_company_enrichment_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON clay_company_enrichment_results FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE clay_company_enrichment_results IS
'Enriched company data from Clay provider.
Used by waterfall enrichment workflow: enrich-buyer-past-employers';
