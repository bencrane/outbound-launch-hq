-- Source data configuration for each workflow
-- The data getter queries this to know where to fetch data from
CREATE TABLE workflow_source_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES db_driven_enrichment_workflows(id) ON DELETE CASCADE,
  source_config JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workflow_id)
);

-- Example source_config structure:
-- {
--   "database": "gtm_teaser" | "outbound_launch_hq",
--   "table": "table_or_view_name",
--   "select_columns": ["col1", "col2"] or "*",
--   "filter_column": "hq_target_company_id",
--   "filter_type": "in"
-- }

COMMENT ON TABLE workflow_source_config IS 'Defines where the data getter fetches source data for each workflow';
COMMENT ON COLUMN workflow_source_config.source_config IS 'JSONB config: database, table, select_columns, filter_column, filter_type';
