-- Revert the bad migration that added provider-specific columns
-- These don't belong in a generic workflow table
ALTER TABLE db_driven_enrichment_workflows
DROP COLUMN IF EXISTS scrape_url_template,
DROP COLUMN IF EXISTS scrape_url_field,
DROP COLUMN IF EXISTS scraped_html_field;
