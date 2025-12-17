# Post-Mortem: Company ID Mismatch During Testing

**Date:** 2025-12-17
**Severity:** HIGH
**Impact:** Data integrity violation - SpotDraft marked as Step 6 complete with SecurityPal's case study URLs stored under wrong company_id

---

## Summary

During manual testing of Step 6 (Extract Case Study URLs), the AI assistant constructed test payloads with a `company_id` that did not match the `company_domain`. This resulted in:

1. SpotDraft's company_id being used with SecurityPal's domain
2. SecurityPal's case study URLs being stored with SpotDraft's company_id
3. SpotDraft incorrectly appearing as "Step 6 complete" in the UI
4. Complete corruption of the relationship between company identity and enrichment data

**This is a critical data integrity violation.** Mixing data between companies is unacceptable and could lead to:
- Wrong data being sent to sales teams
- Incorrect enrichment being applied to wrong companies
- Loss of trust in the entire pipeline

---

## Timeline

1. AI assistant needed to test Step 6 edge function
2. AI constructed manual curl payload with:
   - `company_id`: `ead83e3c-20c8-4984-abc2-9c50f6521852`
   - `company_domain`: `securitypalhq.com`
   - `company_name`: `SecurityPal`
3. AI **did not verify** that the company_id matched the domain
4. The ID actually belonged to **SpotDraft** (spotdraft.com), not SecurityPal
5. Storage worker stored data with mismatched IDs
6. Logger created completion record for SpotDraft's ID
7. UI showed SpotDraft as "Step 6 complete"
8. User noticed SpotDraft in Step 7 queue when it shouldn't be there
9. Investigation revealed the data corruption

---

## Root Cause

**Primary:** The AI assistant pulled a company_id from conversation context and assumed it belonged to SecurityPal without verification.

**Contributing factors:**
1. No validation in storage_worker_v2 to verify company_id matches company_domain
2. Manual test payloads bypass the UI's built-in ID/domain consistency
3. AI did not query the companies table before constructing test payloads

---

## The Actual Data

**What AI used:**
```json
{
  "company_id": "ead83e3c-20c8-4984-abc2-9c50f6521852",
  "company_domain": "securitypalhq.com"
}
```

**What that ID actually maps to:**
```json
{
  "id": "ead83e3c-20c8-4984-abc2-9c50f6521852",
  "company_name": "SpotDraft",
  "company_domain": "spotdraft.com"
}
```

**SecurityPal's actual ID:**
```json
{
  "id": "3d77a176-1208-4340-8dd0-fd5ee45cf2b0",
  "company_name": "SecurityPal AI",
  "company_domain": "securitypalhq.com"
}
```

---

## Remediation

### Immediate (Required)

Run on **HQ DB**:
```sql
-- Delete corrupted Step 6 completions
DELETE FROM company_play_step_completions WHERE step_number = 6;

-- Delete corrupted Step 6 logs
DELETE FROM enrichment_results_log WHERE step_number = 6;
```

Run on **Workspace DB**:
```sql
-- Delete corrupted case study URLs
DELETE FROM company_specific_case_study_urls;
```

### Preventive Measures

#### 1. Add Validation to storage_worker_v2 (REQUIRED)

Before storing any data, verify that `company_id` and `company_domain` match in the companies table:

```typescript
// Verify company_id matches company_domain
const { data: company, error: companyError } = await hqClient
  .from("companies")
  .select("id, company_domain")
  .eq("id", company_id)
  .eq("company_domain", company_domain)
  .single();

if (companyError || !company) {
  return new Response(
    JSON.stringify({
      error: "Company ID does not match domain",
      company_id,
      company_domain,
    }),
    { status: 400, ... }
  );
}
```

#### 2. AI Testing Protocol (MANDATORY)

When AI needs to test with specific companies:

1. **ALWAYS** query the database first:
   ```bash
   curl "...companies?company_domain=eq.{DOMAIN}&select=id,company_name,company_domain"
   ```

2. **NEVER** use IDs from conversation context without verification

3. **PREFER** using the UI to trigger tests (UI has correct ID/domain pairs)

4. **IF** manual testing is required, construct payload from query results:
   ```bash
   # First get the company
   COMPANY=$(curl -s "...companies?company_domain=eq.securitypalhq.com&select=id,company_name,company_domain")
   # Then use values from that response
   ```

#### 3. Update AI_ONBOARDING.md

Add to the must-read section:

```markdown
## CRITICAL: Company ID/Domain Matching

When testing or debugging with company data:

1. NEVER assume a company_id belongs to a specific domain
2. ALWAYS query: `companies?company_domain=eq.{domain}&select=id`
3. VERIFY the ID matches before using it in any payload
4. Mixing company IDs with wrong domains is a DATA INTEGRITY VIOLATION
```

---

## Lessons Learned

1. **Trust nothing from context** - Always verify IDs against the database
2. **Data integrity is paramount** - Mixing company data is a critical failure
3. **The UI exists for a reason** - It maintains correct ID/domain relationships
4. **Validation should be defensive** - storage_worker should reject mismatched data
5. **Manual testing is dangerous** - Prefer automated flows that maintain consistency

---

## Action Items

| Priority | Item | Status |
|----------|------|--------|
| P0 | Clean up corrupted data | Pending |
| P0 | Add company_id/domain validation to storage_worker_v2 | Pending |
| P1 | Update AI_ONBOARDING.md with testing protocol | Pending |
| P1 | Document testing best practices | This document |

---

## References

- `docs/RESETTING_ENRICHMENT_STATE.md` - How to properly reset enrichment data
- `docs/AI_ONBOARDING.md` - AI assistant guidelines
- `docs/POST_MORTEMS.md` - Index of all post-mortems
