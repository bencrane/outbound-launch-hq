-- Step 3 destination table: stores the identified case studies page URL for each company
CREATE TABLE IF NOT EXISTS company_case_studies_page (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  company_domain TEXT NOT NULL,
  company_name TEXT,
  case_studies_page_url TEXT,  -- The identified URL (could be relative or absolute)
  confidence TEXT,              -- AI confidence: high, medium, low
  reasoning TEXT,               -- AI explanation for why this URL was chosen
  created_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT unique_company_domain_case_studies UNIQUE (company_domain)
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_company_case_studies_page_domain ON company_case_studies_page(company_domain);
CREATE INDEX IF NOT EXISTS idx_company_case_studies_page_company_id ON company_case_studies_page(company_id);

-- Enable RLS
ALTER TABLE company_case_studies_page ENABLE ROW LEVEL SECURITY;

-- Allow all operations (adjust as needed)
CREATE POLICY "Allow all on company_case_studies_page" ON company_case_studies_page FOR ALL USING (true);
