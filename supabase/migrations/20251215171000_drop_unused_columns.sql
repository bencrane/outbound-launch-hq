-- Remove mostly-unused columns from workflows table
-- This config will move to JSONB in a separate table
ALTER TABLE db_driven_enrichment_workflows
DROP COLUMN IF EXISTS source_record_array_field,
DROP COLUMN IF EXISTS raw_payload_table_name,
DROP COLUMN IF EXISTS array_field_configs,
DROP COLUMN IF EXISTS raw_payload_field,
DROP COLUMN IF EXISTS destination_field_mappings,
DROP COLUMN IF EXISTS destination_table_name,
DROP COLUMN IF EXISTS global_logger_function_name;
