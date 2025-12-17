-- Drop existing view that explodes job titles into rows
DROP VIEW IF EXISTS clay_work_history_with_job_titles;

-- Create new view that pivots job titles into columns
CREATE VIEW clay_work_history_with_job_titles AS
WITH unique_companies AS (
  -- Deduplicate companies per target company
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
  ej.expanded_job_titles->>0 AS ai_icp_job_title_one,
  ej.expanded_job_titles->>1 AS ai_icp_job_title_two,
  ej.expanded_job_titles->>2 AS ai_icp_job_title_three,
  ej.expanded_job_titles->>3 AS ai_icp_job_title_four,
  ej.expanded_job_titles->>4 AS ai_icp_job_title_five,
  ej.expanded_job_titles->>5 AS ai_icp_job_title_six,
  ej.expanded_job_titles->>6 AS ai_icp_job_title_seven,
  ej.expanded_job_titles->>7 AS ai_icp_job_title_eight,
  ej.expanded_job_titles->>8 AS ai_icp_job_title_nine,
  ej.expanded_job_titles->>9 AS ai_icp_job_title_ten
FROM unique_companies uc
JOIN ai_expanded_icp_job_titles ej ON uc.hq_target_company_id = ej.hq_target_company_id;
