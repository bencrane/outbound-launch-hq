-- Migration: Create destination table for company_enrichment_dot_com provider
-- Target DB: GTM Teaser (kwxdezafluqhcmovnwbn)

CREATE TABLE IF NOT EXISTS company_enrichment_dot_com_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source references (pass-through from dispatcher)
  source_record_id UUID,
  hq_target_company_id UUID,
  hq_target_company_name TEXT,
  hq_target_company_domain TEXT,

  -- Workflow context
  workflow_id UUID,
  workflow_slug TEXT,
  enrichment_provider TEXT DEFAULT 'company_enrichment_dot_com',

  -- Core company fields (flattened)
  enriched_company_id TEXT,              -- The provider's ID for the company
  company_name TEXT,
  company_type TEXT,                     -- "private", "public", etc.
  company_domain TEXT,
  company_website TEXT,
  industry TEXT,
  description TEXT,
  seo_description TEXT,
  logo_url TEXT,

  -- Size/financials
  employees TEXT,                        -- "501-1K", "1K-5K", etc.
  revenue TEXT,                          -- "50m-100m", etc.
  founded_year INT,
  total_funding BIGINT,
  funding_stage TEXT,                    -- "series_d", "series_c", etc.
  funding_date TIMESTAMPTZ,
  stock_symbol TEXT,
  stock_exchange TEXT,

  -- Location (flattened key fields)
  address TEXT,
  city TEXT,
  state TEXT,
  state_code TEXT,
  country TEXT,
  country_code TEXT,
  postal_code TEXT,
  phone TEXT,
  latitude NUMERIC,
  longitude NUMERIC,

  -- Social URLs (flattened)
  linkedin_url TEXT,
  linkedin_id TEXT,
  twitter_url TEXT,
  facebook_url TEXT,
  youtube_url TEXT,
  instagram_url TEXT,
  crunchbase_url TEXT,
  angellist_url TEXT,
  g2_url TEXT,

  -- Arrays stored as JSONB
  keywords JSONB,
  categories JSONB,
  industries JSONB,
  naics_codes JSONB,
  technologies JSONB,
  funding_rounds JSONB,                  -- Array of funding objects
  subsidiaries JSONB,

  -- Full nested objects (for reference)
  socials_raw JSONB,
  location_raw JSONB,
  financial_raw JSONB,

  -- Metadata
  page_rank NUMERIC,
  provider_updated_at TIMESTAMPTZ,       -- When provider last updated this record
  enriched_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ce_dot_com_source_record ON company_enrichment_dot_com_results(source_record_id);
CREATE INDEX IF NOT EXISTS idx_ce_dot_com_hq_company ON company_enrichment_dot_com_results(hq_target_company_id);
CREATE INDEX IF NOT EXISTS idx_ce_dot_com_domain ON company_enrichment_dot_com_results(company_domain);
CREATE INDEX IF NOT EXISTS idx_ce_dot_com_workflow ON company_enrichment_dot_com_results(workflow_id);

-- RLS
ALTER TABLE company_enrichment_dot_com_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON company_enrichment_dot_com_results FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE company_enrichment_dot_com_results IS
'Enriched company data from CompanyEnrich.com provider.
Used by waterfall enrichment workflow: enrich-buyer-past-employers';
