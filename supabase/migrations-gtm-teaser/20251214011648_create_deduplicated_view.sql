-- Drop existing view and recreate with deduplication
DROP VIEW IF EXISTS clay_work_history_with_job_titles;

CREATE VIEW clay_work_history_with_job_titles AS
WITH unique_companies AS (
  SELECT DISTINCT ON (wh.hq_target_company_id, wh.company_name)
    wh.id,
    wh.source_record_id,
    wh.hq_target_company_id,
    wh.hq_target_company_name,
    wh.hq_target_company_domain,
    wh.person_name,
    wh.company_name,
    wh.company_domain,
    wh.company_linkedin_url,
    ble.extracted_buyer_company
  FROM clay_linkedin_profile_work_history wh
  JOIN buyer_linkedin_enrichments ble ON wh.source_record_id = ble.id
  WHERE wh.company_name IS DISTINCT FROM ble.extracted_buyer_company
  ORDER BY wh.hq_target_company_id, wh.company_name, wh.id
)
SELECT 
  uc.*,
  jsonb_array_elements_text(ej.expanded_job_titles) AS job_title_to_search
FROM unique_companies uc
JOIN ai_expanded_icp_job_titles ej ON uc.hq_target_company_id = ej.hq_target_company_id;
