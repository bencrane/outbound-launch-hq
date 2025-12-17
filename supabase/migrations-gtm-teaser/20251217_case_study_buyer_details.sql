-- Step 7: Extracted buyer details from case study pages
-- Source: company_specific_case_study_urls (Step 6 output)
-- Clay extracts: buyer full name, first name, last name, job title, company name

-- Drop old tables if they exist
DROP TABLE IF EXISTS case_study_scrapes;
DROP TABLE IF EXISTS case_study_buyer_details;

-- Create the table for buyer details
CREATE TABLE case_study_buyer_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  company_domain TEXT NOT NULL,
  company_name TEXT,
  case_study_url TEXT NOT NULL,

  -- Extracted buyer details from Claygent
  buyer_full_name TEXT,
  buyer_first_name TEXT,
  buyer_last_name TEXT,
  buyer_job_title TEXT,
  buyer_company_name TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Unique constraint for upsert operations
  CONSTRAINT unique_case_study_buyer UNIQUE (company_domain, case_study_url)
);

-- Index for lookups
CREATE INDEX idx_case_study_buyer_company_domain ON case_study_buyer_details(company_domain);
CREATE INDEX idx_case_study_buyer_company_id ON case_study_buyer_details(company_id);

-- Enable RLS
ALTER TABLE case_study_buyer_details ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access to case_study_buyer_details"
  ON case_study_buyer_details
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow anon read access
CREATE POLICY "Anon can read case_study_buyer_details"
  ON case_study_buyer_details
  FOR SELECT
  TO anon
  USING (true);
