-- Migration: Add workflow_provider_configs table for waterfall enrichment
-- This table stores provider-specific config for workflows that use multiple enrichment providers

CREATE TABLE IF NOT EXISTS workflow_provider_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to parent workflow
  workflow_id UUID NOT NULL REFERENCES db_driven_enrichment_workflows(id) ON DELETE CASCADE,

  -- Provider identifier (e.g., "leadmagic", "clearbit", "apollo")
  enrichment_provider TEXT NOT NULL,

  -- Storage config (same fields as db_driven_enrichment_workflows but provider-specific)
  destination_table_name TEXT NOT NULL,
  destination_field_mappings JSONB,
  array_field_configs JSONB,
  raw_payload_table_name TEXT,
  raw_payload_field TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Unique constraint: one config per workflow + provider combination
  UNIQUE(workflow_id, enrichment_provider)
);

-- Index for fast lookups by workflow_id + enrichment_provider
CREATE INDEX IF NOT EXISTS idx_workflow_provider_configs_lookup
ON workflow_provider_configs(workflow_id, enrichment_provider);

-- Enable RLS
ALTER TABLE workflow_provider_configs ENABLE ROW LEVEL SECURITY;

-- Allow all access (solo operator tool - no auth)
CREATE POLICY "Allow all access" ON workflow_provider_configs
FOR ALL USING (true) WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE workflow_provider_configs IS
'Provider-specific storage config for waterfall enrichment workflows.
When a payload has enrichment_provider set, the generic_storage_worker looks up config here
instead of using the workflow-level config from db_driven_enrichment_workflows.';
