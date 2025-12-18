-- Step 3 destination: Scraped MAIN case studies listing page (autoparse output)
-- Source: company_case_studies_page.case_studies_page_url (Step 2 output)
-- One row per company - stores the autoparse output from their /customers or /case-studies page

CREATE TABLE IF NOT EXISTS case_studies_page_scrapes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  company_domain TEXT NOT NULL,
  company_name TEXT,

  -- The URL that was scraped
  case_studies_page_url TEXT,

  -- Zenrows autoparse output (structured data, not raw HTML)
  links JSONB,              -- Array of {href, text} - contains individual case study URLs for Step 4
  title TEXT,               -- Page title
  body_text TEXT,           -- Extracted body text
  description TEXT,         -- Meta description

  created_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT unique_company_domain_cs_scrapes UNIQUE (company_domain)
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_cs_scrapes_domain ON case_studies_page_scrapes(company_domain);
CREATE INDEX IF NOT EXISTS idx_cs_scrapes_company_id ON case_studies_page_scrapes(company_id);

-- Enable RLS
ALTER TABLE case_studies_page_scrapes ENABLE ROW LEVEL SECURITY;

-- Allow all operations (adjust as needed)
CREATE POLICY "Allow all on case_studies_page_scrapes" ON case_studies_page_scrapes FOR ALL USING (true);
