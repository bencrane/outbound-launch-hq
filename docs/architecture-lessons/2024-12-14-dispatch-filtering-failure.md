# Failure Analysis: Dispatch Filtering and Layer Confusion

**Date:** 2024-12-14

---

## Error 1: Not Thinking Through Dispatch Logic

### What I Did Wrong
When building the "Find Contacts at Buyer Past Employer" workflow, I created the workflow config pointing directly at `clay_linkedin_profile_work_history` without asking:

- What records should be dispatched?
- Should any records be excluded?
- Is there filtering logic needed?

I just wired up the table and moved on.

### What Should Have Happened
Before building ANY dispatch workflow, I should ask:

> "What subset of records should be sent? All? Filtered? What are the exclusion criteria?"

In this case, the obvious question was: "Should we find contacts at the same company where the buyer was mentioned in the case study?" The answer is no - that's the target company's customer, not a prospect.

### Why This Matters
Dispatching wrong records means:
- Wasted API calls
- Wasted credits
- Wrong data downstream
- User has to catch it

---

## Error 2: Trying to Fix Dispatch by Modifying Storage

### What I Did Wrong
When the user pointed out we should exclude case study companies, I tried to fix it by:

1. Adding `extracted_buyer_company` column to the work history table
2. Modifying the storage worker to pass through more context fields
3. Offering multiple complex options

This was wrong. The storage worker was working fine. The problem was at the dispatch layer.

### What Should Have Happened
Immediately recognize: "This is a dispatch filtering problem, not a storage problem."

The fix is one SQL statement:

```sql
CREATE OR REPLACE VIEW clay_work_history_for_contact_search AS
SELECT wh.*, ble.extracted_buyer_company
FROM clay_linkedin_profile_work_history wh
JOIN buyer_linkedin_enrichments ble ON wh.source_record_id = ble.id
WHERE wh.company_name IS DISTINCT FROM ble.extracted_buyer_company;
```

Point the workflow at the view. Done. No storage changes.

### Why This Matters
Modifying storage to solve dispatch problems:
- Adds unnecessary complexity
- Means changing storage every time a new workflow has different filter needs
- Violates separation of concerns
- Creates maintenance burden

---

## The Correct Mental Model

```
┌─────────────────────────────────────────────────────────────┐
│                     STORAGE LAYER                           │
│  - Store ALL data consistently                              │
│  - Don't change based on downstream workflow needs          │
│  - One job: persist data reliably                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     DISPATCH LAYER                          │
│  - Views filter what gets sent                              │
│  - Each workflow can have its own view                      │
│  - Filtering logic lives HERE, not in storage               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     EXTERNAL API                            │
│  - Clay, LeadMagic, etc.                                    │
│  - Receives only what dispatch layer sends                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Prevention Checklist

Before building any new enrichment workflow:

- [ ] What is the source table?
- [ ] Should ALL records be dispatched, or a subset?
- [ ] What are the exclusion criteria?
- [ ] Do I need a filtered view?
- [ ] Have I asked the user about filtering requirements?

When a filtering issue is raised:

- [ ] Is this a storage problem or a dispatch problem?
- [ ] Can I solve it with a view instead of modifying code?
- [ ] What is the SIMPLEST fix?

---

## Summary

| Error | What I Did | What I Should Do |
|-------|------------|------------------|
| Original | Built workflow without thinking about filtering | Ask dispatch questions upfront |
| Subsequent | Tried to fix by modifying storage worker | Recognize it's a dispatch problem, use a view |

I can do better. This document exists so I don't repeat these errors.

---

## Principle: Think About 2nd Order Implications

Before implementing anything, ask:
- What happens when this runs at scale?
- What downstream workflows will consume this data?
- What filtering will those workflows need?
- Am I building in a way that's principle-driven and scalable, or just solving the immediate task?

Build systems, not one-offs.
