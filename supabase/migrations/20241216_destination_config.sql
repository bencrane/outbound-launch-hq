-- Add destination_config JSONB column (replaces destination_db, destination_table_name, destination_field_mappings)
ALTER TABLE db_driven_enrichment_workflows
ADD COLUMN IF NOT EXISTS destination_config JSONB;

-- Migrate existing data to new format
UPDATE db_driven_enrichment_workflows
SET destination_config = jsonb_build_object(
  'destinations', jsonb_build_array(
    jsonb_build_object(
      'db', COALESCE(destination_db, 'workspace'),
      'table', destination_table_name,
      'fields', destination_field_mappings
    )
  )
)
WHERE destination_table_name IS NOT NULL;

-- Drop old columns
ALTER TABLE db_driven_enrichment_workflows DROP COLUMN IF EXISTS destination_db;
ALTER TABLE db_driven_enrichment_workflows DROP COLUMN IF EXISTS destination_table_name;
ALTER TABLE db_driven_enrichment_workflows DROP COLUMN IF EXISTS destination_field_mappings;
