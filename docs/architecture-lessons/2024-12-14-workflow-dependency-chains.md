# Architecture Lesson: Workflow Dependency Chains

**Date:** 2024-12-14
**Severity:** High - Pipeline broken without manual intervention
**Caught by:** User, not system

---

## What Happened

Built a multi-step enrichment pipeline:
1. **LinkedIn Profile Enrichment** → stores work history in `clay_linkedin_profile_work_history`
2. **Job Title Expansion** → reads buyer roles, expands via OpenAI, stores in `ai_expanded_icp_job_titles`
3. **Find Contacts** → reads from view that joins work history + job titles

The view `clay_work_history_with_job_titles` depends on BOTH tables having data. But step 2 was a separate, manually-triggered workflow with no automatic connection to step 1.

**Result:** After LinkedIn enrichment ran, the "Find Contacts" workflow couldn't work because job titles didn't exist. The view returned 0 rows.

---

## The Root Cause

I built each workflow in isolation without thinking about the full pipeline:

```
LinkedIn Enrichment ──→ Work History Table
                                          ╲
                                           ╳──→ View (BROKEN - missing job titles)
                                          ╱
Job Title Expansion ──→ Job Titles Table
       ↑
       └── Never triggered automatically
```

---

## The Fix

Updated `generic_storage_worker_v1` to auto-trigger job title expansion after storing LinkedIn profile data:

```typescript
// After storing work history, check if job titles exist
if (
  config.workflow_slug === "clay-enrich-person-linkedin-profile" &&
  payload.hq_target_company_id &&
  arrayResults["experience"]?.count > 0
) {
  // Check if job titles already exist for this company
  const { data: existingTitles } = await gtmSupabase
    .from("ai_expanded_icp_job_titles")
    .select("id")
    .eq("hq_target_company_id", payload.hq_target_company_id)
    .limit(1);

  if (!existingTitles || existingTitles.length === 0) {
    // Trigger job title expansion
    await fetch(`${supabaseUrl}/functions/v1/expand_icp_job_titles_v1`, {
      method: "POST",
      body: JSON.stringify({
        hq_target_company_id: payload.hq_target_company_id,
        hq_target_company_name: payload.hq_target_company_name,
        hq_target_company_domain: payload.hq_target_company_domain,
      }),
    });
  }
}
```

---

## The Correct Mental Model

When building workflow B that depends on workflow A:

```
┌─────────────────────────────────────────────────────────────┐
│  BEFORE building workflow B, ask:                           │
│                                                             │
│  1. What data does B need to exist?                         │
│  2. What workflow creates that data?                        │
│  3. Is that workflow automatically triggered?               │
│  4. If not, who/what triggers it and when?                  │
│  5. What happens if the dependency data doesn't exist?      │
└─────────────────────────────────────────────────────────────┘
```

---

## Pipeline Dependency Checklist

Before building any workflow that reads from a table/view:

- [ ] List ALL tables/views this workflow reads from
- [ ] For each source, identify what workflow populates it
- [ ] Verify that workflow runs BEFORE this one (automatically or manually)
- [ ] If there's a gap, implement the connection (trigger, chain, or error handling)
- [ ] Test the full chain, not just the individual workflow

---

## What I Should Have Done

1. **Mapped the full pipeline** before building:
   ```
   Case Study Extraction
         ↓
   Buyer LinkedIn URLs (buyer_linkedin_enrichments)
         ↓
   LinkedIn Profile Enrichment → Work History
         ↓                            ↓
   Job Title Expansion ←──────────────┘ (AUTO-TRIGGER)
         ↓
   Find Contacts View Ready
         ↓
   Find Contacts Dispatch
   ```

2. **Identified the dependency**: View needs both work history AND job titles
3. **Implemented the chain**: Auto-trigger job title expansion after work history is stored
4. **Tested end-to-end**: Not just individual workflows

---

## Principle

**A workflow that can't be followed by the next step is a broken workflow.**

Even if each workflow works perfectly in isolation, the pipeline fails if the connections aren't there. Think about the full data flow, not just individual components.

---

## Related Documents

- [Dispatch Filtering Failure](./2024-12-14-dispatch-filtering-failure.md)
- [Design Questions Checklist](./design-questions-checklist.md)
