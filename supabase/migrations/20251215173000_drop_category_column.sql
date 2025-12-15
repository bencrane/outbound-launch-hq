-- Remove category column from workflows table
ALTER TABLE db_driven_enrichment_workflows
DROP COLUMN IF EXISTS category;
