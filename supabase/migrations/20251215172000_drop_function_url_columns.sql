-- Remove function URL/name columns from workflows table
ALTER TABLE db_driven_enrichment_workflows
DROP COLUMN IF EXISTS destination_endpoint_url,
DROP COLUMN IF EXISTS dispatcher_function_name,
DROP COLUMN IF EXISTS receiver_function_name,
DROP COLUMN IF EXISTS dispatcher_function_url,
DROP COLUMN IF EXISTS receiver_function_url,
DROP COLUMN IF EXISTS storage_worker_function_name,
DROP COLUMN IF EXISTS storage_worker_function_url,
DROP COLUMN IF EXISTS global_logger_function_url;
