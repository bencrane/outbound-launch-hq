# Architecture Lesson: Dispatch Logic and Separation of Concerns

**Date:** 2024-12-14
**Severity:** Medium - Design oversight
**Caught by:** User, not system

## What Happened

When building the "Find Contacts at Buyer Past Employer" workflow, I failed to think through **what records should actually be dispatched**. I pointed the workflow at the work history table without considering:
- Should we exclude certain records (e.g., the case study company)?
- What filtering logic is needed?
- Do we need a view?

The user had to catch this and ask: "Can we not send it if it's the same case study company?"

## My Wrong Response

When the issue was raised, I tried to solve it by **modifying the storage worker** to pass through more context fields. This was wrong on multiple levels:

1. **Wrong layer**: This is a dispatch problem, not a storage problem
2. **Overcomplicated**: The storage worker shouldn't change every time a downstream workflow needs different filtering
3. **Multiple options instead of action**: I offered 3 approaches when one simple answer existed

## The Actual Issue

I didn't ask the right design question upfront:

> "For this workflow, what records should be dispatched? All of them, or a filtered subset?"

This should be asked BEFORE building, not discovered after.

## The Simple Fix

```sql
-- Create filtered view for dispatch
CREATE OR REPLACE VIEW clay_work_history_for_contact_search AS
SELECT wh.*, ble.extracted_buyer_company
FROM clay_linkedin_profile_work_history wh
JOIN buyer_linkedin_enrichments ble ON wh.source_record_id = ble.id
WHERE wh.company_name IS DISTINCT FROM ble.extracted_buyer_company;
```

Point the workflow at the view. Done.

## The Correct Separation of Concerns

**Storage Worker**: Store all data consistently. Don't modify it for per-workflow filtering needs.

**Dispatch Layer**: Use views/queries to filter what gets sent. Each workflow can have its own view with its own filters.

You should NOT have to go back and change the storage worker every time a subsequent workflow wants to filter records differently.

## Lessons

### 1. Ask Dispatch Questions Upfront
Before building any enrichment workflow, ask:
- What records should be dispatched?
- Are there exclusion criteria?
- Do we need a filtered view?

### 2. Solve Problems at the Right Layer
- Storage problems → fix storage
- Dispatch problems → fix dispatch (views, queries)
- Don't cross the streams

### 3. Be Decisive
When a problem is identified, implement the simple fix. Don't offer a menu of options when one clear answer exists.

## The Snowball Risk

This was caught early with 61 records. But the pattern of not thinking through dispatch logic could compound:
- Multiple workflows with unclear filtering
- Data sent where it shouldn't be
- Wasted API calls / credits
- Wrong results downstream

Small design oversights compound into systemic issues.
