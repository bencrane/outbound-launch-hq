-- ============================================================================
-- Find Contact Profile Tables
--
-- These tables store data from the "find contacts at buyer's prior company" workflow.
-- Clay returns a `people[]` array with full LinkedIn profiles for each found contact.
-- This mirrors the structure used for direct LinkedIn profile enrichment.
-- ============================================================================

-- Main profile table for found contacts
CREATE TABLE IF NOT EXISTS clay_find_contact_profile_data (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Context: which source record triggered this search
    source_record_id UUID,                    -- FK to clay_work_history_with_job_titles row

    -- Context: the target company we're building a contact list for
    hq_target_company_id UUID,
    hq_target_company_name TEXT,
    hq_target_company_domain TEXT,

    -- Context: the company we searched at (the buyer's prior employer)
    searched_company_name TEXT,
    searched_company_domain TEXT,
    searched_company_linkedin_url TEXT,

    -- Context: which job title search found this person
    searched_job_title TEXT,

    -- Profile data from Clay
    name TEXT,
    title TEXT,
    headline TEXT,
    contact_linkedin_url TEXT,
    location TEXT,
    city TEXT,
    state TEXT,
    country TEXT,
    summary TEXT,
    follower_count INTEGER,
    connection_count INTEGER,
    is_open_to_work BOOLEAN,

    -- Metadata
    workflow_id UUID,
    workflow_slug TEXT,
    enriched_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Work history for found contacts
CREATE TABLE IF NOT EXISTS clay_find_contact_work_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Link to parent profile
    profile_record_id UUID REFERENCES clay_find_contact_profile_data(id) ON DELETE CASCADE,

    -- Context fields (denormalized for query convenience)
    source_record_id UUID,
    hq_target_company_id UUID,
    hq_target_company_name TEXT,
    hq_target_company_domain TEXT,
    person_name TEXT,                         -- The found contact's name

    -- Work history entry data
    company_name TEXT,
    company_domain TEXT,
    company_linkedin_url TEXT,
    job_title TEXT,
    summary TEXT,
    start_date TEXT,
    end_date TEXT,
    is_current BOOLEAN,
    locality TEXT,
    org_id TEXT,

    -- Metadata
    workflow_id UUID,
    workflow_slug TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Education for found contacts
CREATE TABLE IF NOT EXISTS clay_find_contact_education (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Link to parent profile
    profile_record_id UUID REFERENCES clay_find_contact_profile_data(id) ON DELETE CASCADE,

    -- Context fields
    source_record_id UUID,
    hq_target_company_id UUID,
    hq_target_company_name TEXT,
    hq_target_company_domain TEXT,
    person_name TEXT,

    -- Education data
    school_name TEXT,
    degree TEXT,
    field_of_study TEXT,
    grade TEXT,
    activities TEXT,
    start_date TEXT,
    end_date TEXT,

    -- Metadata
    workflow_id UUID,
    workflow_slug TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Certifications for found contacts
CREATE TABLE IF NOT EXISTS clay_find_contact_certifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Link to parent profile
    profile_record_id UUID REFERENCES clay_find_contact_profile_data(id) ON DELETE CASCADE,

    -- Context fields
    source_record_id UUID,
    hq_target_company_id UUID,
    hq_target_company_name TEXT,
    hq_target_company_domain TEXT,
    person_name TEXT,

    -- Certification data
    title TEXT,
    company_name TEXT,
    issue_date TEXT,
    credential_id TEXT,
    verify_url TEXT,
    summary TEXT,

    -- Metadata
    workflow_id UUID,
    workflow_slug TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raw payloads for debugging (optional but helpful)
CREATE TABLE IF NOT EXISTS clay_find_contact_raw_payloads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Context
    source_record_id UUID,
    hq_target_company_id UUID,
    hq_target_company_name TEXT,
    hq_target_company_domain TEXT,
    searched_company_name TEXT,
    contact_linkedin_url TEXT,
    name TEXT,

    -- Raw data
    raw_payload JSONB,

    -- Metadata
    workflow_id UUID,
    workflow_slug TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_find_contact_profile_hq_company
    ON clay_find_contact_profile_data(hq_target_company_id);
CREATE INDEX IF NOT EXISTS idx_find_contact_profile_searched_company
    ON clay_find_contact_profile_data(searched_company_domain);
CREATE INDEX IF NOT EXISTS idx_find_contact_profile_linkedin_url
    ON clay_find_contact_profile_data(contact_linkedin_url);
CREATE INDEX IF NOT EXISTS idx_find_contact_work_history_profile
    ON clay_find_contact_work_history(profile_record_id);
CREATE INDEX IF NOT EXISTS idx_find_contact_work_history_company
    ON clay_find_contact_work_history(company_domain);
CREATE INDEX IF NOT EXISTS idx_find_contact_education_profile
    ON clay_find_contact_education(profile_record_id);
CREATE INDEX IF NOT EXISTS idx_find_contact_certifications_profile
    ON clay_find_contact_certifications(profile_record_id);
