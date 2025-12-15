-- Remove request_type and destination_type columns
ALTER TABLE db_driven_enrichment_workflows
DROP COLUMN IF EXISTS request_type,
DROP COLUMN IF EXISTS destination_type;
