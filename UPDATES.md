# Outbound Launch HQ - Development Updates

## 2025-12-09

### Session Start
- Project initialized with Next.js, TypeScript, Tailwind
- Core guidance document in place (`guidance.md`)
- Supabase backend configured with initial tables:
  - `pdl_companies` - 23M reference records
  - `companies` - core working table
  - `people` - core working table
- Work continues from a previous session (context not available)

### Admin Section
- Created `/admin` page with card-based navigation
- Added Table Schema Viewer (`/admin/schema`) - requires SQL functions in Supabase
- Added Enrichment Workflows config (`/admin/enrichment-workflows`)

### Companies Page
- Built full Companies table with sortable columns
- Added row selection (individual + select all with indeterminate state)
- Added "Send to Enrichment" functionality:
  - Shows when records selected
  - Dropdown lists active workflows from `enrichment_workflows` table
  - Separate Test/Prod buttons per workflow
  - POSTs selected companies to n8n webhook URL

### Database Types Added
- `EnrichmentWorkflow` type in `src/types/database.ts`
- Fields: id, name, description, pipedream_webhook_url, n8n_webhook_url_test, n8n_webhook_url_prod, is_active, timestamps

### Enrichment Flow
- Data is always sent to Pipedream first (primary endpoint)
- Pipedream receives the selected companies + workflow metadata including the n8n URL
- Pipedream can then forward to n8n as needed
- Payload sent to Pipedream:
  ```json
  {
    "companies": [...],
    "workflow": {
      "name": "Workflow Name",
      "n8n_webhook_url": "https://...",
      "mode": "test" | "prod"
    }
  }
  ```

### SQL Required for New Features
```sql
-- enrichment_workflows table
CREATE TABLE enrichment_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  pipedream_webhook_url TEXT,
  n8n_webhook_url_test TEXT,
  n8n_webhook_url_prod TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE enrichment_workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON enrichment_workflows FOR ALL USING (true);

-- Schema viewer functions (optional)
-- See /admin/schema page for full SQL
```

---

*Updates will be added as milestones are completed.*
