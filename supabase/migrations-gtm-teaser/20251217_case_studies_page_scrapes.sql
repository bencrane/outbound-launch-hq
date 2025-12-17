-- Step 4 destination table: stores the scraped HTML from case studies pages
CREATE TABLE IF NOT EXISTS case_studies_page_scrapes (
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

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_cs_scrapes_domain ON case_studies_page_scrapes(company_domain);
CREATE INDEX IF NOT EXISTS idx_cs_scrapes_company_id ON case_studies_page_scrapes(company_id);

-- Enable RLS
ALTER TABLE case_studies_page_scrapes ENABLE ROW LEVEL SECURITY;

-- Allow all operations (adjust as needed)
CREATE POLICY "Allow all on case_studies_page_scrapes" ON case_studies_page_scrapes FOR ALL USING (true);
