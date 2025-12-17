-- Drop deprecated cleaning tables (no longer needed with autoparse approach)
-- These were outputs of n8n cleaning workflows which are now deprecated

DROP TABLE IF EXISTS company_homepage_cleaned;
DROP TABLE IF EXISTS case_studies_page_cleaned;

-- Note: Historical data in these tables has been intentionally deleted
-- as part of the migration to Zenrows autoparse approach
