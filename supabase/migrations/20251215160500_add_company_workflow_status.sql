-- Track last completed workflow step per company
-- Used to determine which companies are eligible for the next pipeline step

CREATE TABLE IF NOT EXISTS company_workflow_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  last_completed_step INTEGER NOT NULL,
  workflow_id UUID REFERENCES db_driven_enrichment_workflows(id),
  workflow_slug TEXT,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Each company has one status record that gets updated as they progress
  UNIQUE(company_id)
);

-- Index for filtering companies by last completed step
CREATE INDEX idx_company_workflow_status_step ON company_workflow_status(last_completed_step);

-- Index for looking up by company
CREATE INDEX idx_company_workflow_status_company ON company_workflow_status(company_id);

-- Enable RLS
ALTER TABLE company_workflow_status ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Allow read access" ON company_workflow_status
  FOR SELECT USING (true);

-- Allow service role to insert/update
CREATE POLICY "Allow service role full access" ON company_workflow_status
  FOR ALL USING (true);
