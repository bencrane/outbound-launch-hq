-- Migration: Create destination table for leadmagic_company_enrichment provider
-- Target DB: GTM Teaser (kwxdezafluqhcmovnwbn)

CREATE TABLE IF NOT EXISTS leadmagic_company_enrichment_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source references (pass-through from dispatcher)
  source_record_id UUID,
  hq_target_company_id UUID,
  hq_target_company_name TEXT,
  hq_target_company_domain TEXT,

  -- Workflow context
  workflow_id UUID,
  workflow_slug TEXT,
  enrichment_provider TEXT DEFAULT 'leadmagic_company_enrichment',

  -- Core company fields
  linkedin_url TEXT,
  company_name TEXT,
  universal_name TEXT,
  website_url TEXT,
  logo_url TEXT,
  tagline TEXT,
  industry TEXT,
  description TEXT,
  company_id INT,                        -- LeadMagic's internal ID

  -- Size metrics
  employee_count INT,
  employee_count_range_start INT,
  employee_count_range_end INT,
  follower_count INT,

  -- Founded date (flattened)
  founded_year INT,
  founded_month INT,
  founded_day INT,

  -- Headquarters (flattened)
  hq_city TEXT,
  hq_line1 TEXT,
  hq_line2 TEXT,
  hq_country TEXT,
  hq_postal_code TEXT,
  hq_geographic_area TEXT,
  hq_description TEXT,

  -- Arrays stored as JSONB
  specialities JSONB,
  locations JSONB,

  -- Raw nested objects
  headquarter_raw JSONB,
  founded_on_raw JSONB,
  employee_count_range_raw JSONB,

  -- API response metadata
  message TEXT,
  hashtag TEXT,
  credits_consumed INT,

  -- Timestamps
  enriched_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lm_ce_source_record ON leadmagic_company_enrichment_results(source_record_id);
CREATE INDEX IF NOT EXISTS idx_lm_ce_hq_company ON leadmagic_company_enrichment_results(hq_target_company_id);
CREATE INDEX IF NOT EXISTS idx_lm_ce_linkedin ON leadmagic_company_enrichment_results(linkedin_url);
CREATE INDEX IF NOT EXISTS idx_lm_ce_workflow ON leadmagic_company_enrichment_results(workflow_id);

-- RLS
ALTER TABLE leadmagic_company_enrichment_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON leadmagic_company_enrichment_results FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE leadmagic_company_enrichment_results IS
'Enriched company data from LeadMagic provider.
Used by waterfall enrichment workflow: enrich-buyer-past-employers';
