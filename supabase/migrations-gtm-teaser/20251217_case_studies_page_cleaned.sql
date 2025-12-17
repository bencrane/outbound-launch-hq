-- Step 5 destination table: stores cleaned case studies page content
CREATE TABLE IF NOT EXISTS case_studies_page_cleaned (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  company_domain TEXT NOT NULL,
  company_name TEXT,
  case_studies_page_url TEXT,
  cleaned_content TEXT,
  links JSONB,                    -- All links from the page
  compact_html TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT unique_company_domain_cs_cleaned UNIQUE (company_domain)
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_cs_cleaned_domain ON case_studies_page_cleaned(company_domain);
CREATE INDEX IF NOT EXISTS idx_cs_cleaned_company_id ON case_studies_page_cleaned(company_id);

-- Enable RLS
ALTER TABLE case_studies_page_cleaned ENABLE ROW LEVEL SECURITY;

-- Allow all operations (adjust as needed)
CREATE POLICY "Allow all on case_studies_page_cleaned" ON case_studies_page_cleaned FOR ALL USING (true);
