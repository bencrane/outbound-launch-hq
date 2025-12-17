-- Step 6 Output: Individual case study URLs extracted from Step 5's links array
-- One row per case study URL (for Clay batching compatibility)

CREATE TABLE IF NOT EXISTS company_specific_case_study_urls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  company_domain TEXT NOT NULL,
  company_name TEXT,
  case_study_url TEXT NOT NULL,
  case_study_text TEXT,  -- The link text from the page (e.g., "How Orum Accelerated Sales...")
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_company_case_study_url UNIQUE (company_domain, case_study_url)
);

-- Index for querying by company
CREATE INDEX IF NOT EXISTS idx_case_study_urls_company_domain ON company_specific_case_study_urls(company_domain);
CREATE INDEX IF NOT EXISTS idx_case_study_urls_company_id ON company_specific_case_study_urls(company_id);

COMMENT ON TABLE company_specific_case_study_urls IS 'Step 6 output: Individual case study URLs extracted by AI from Step 5 links. One row per URL for Clay batching.';
