-- Remove source_table columns from workflows table
-- This config will move to a separate table with JSONB
ALTER TABLE db_driven_enrichment_workflows
DROP COLUMN IF EXISTS source_table_name,
DROP COLUMN IF EXISTS source_table_company_fk,
DROP COLUMN IF EXISTS source_table_select_columns;
