-- Add source_record_array_field column to db_driven_enrichment_workflows
-- This column tells the master_receiver to iterate over an array field (e.g., "people")
-- and call the storage worker once per item in the array.
-- Used for workflows like find-contacts where Clay returns multiple people per request.

ALTER TABLE db_driven_enrichment_workflows
ADD COLUMN IF NOT EXISTS source_record_array_field TEXT;

COMMENT ON COLUMN db_driven_enrichment_workflows.source_record_array_field IS
'If set, the master_receiver will iterate over this array field in the payload and call the storage worker once per item. E.g., "people" for find contacts workflow.';
