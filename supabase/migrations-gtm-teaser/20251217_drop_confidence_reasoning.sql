-- Drop unused columns from company_case_studies_page
-- These were originally planned for AI confidence tracking but not needed
ALTER TABLE company_case_studies_page DROP COLUMN IF EXISTS confidence;
ALTER TABLE company_case_studies_page DROP COLUMN IF EXISTS reasoning;
