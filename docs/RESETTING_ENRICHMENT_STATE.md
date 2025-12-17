# Resetting Enrichment State for a Company

When you need to make it look like a company never went through a specific enrichment step (e.g., to re-test), delete records from these tables.

---

## Tables to Delete From

| Table | Database | Purpose |
|-------|----------|---------|
| `enrichment_results_log` | HQ | Individual enrichment result records |
| `company_play_step_completions` | HQ | Tracks which steps are complete |
| Destination table (varies) | Workspace | The actual enriched data |

---

## Step-by-Step Process

### 1. Identify the company_id

```bash
API_KEY="your-hq-anon-key"

# Find company by domain
curl -s "https://wvjhddcwpedmkofmhfcp.supabase.co/rest/v1/companies?company_domain=eq.nostra.ai&select=id,company_name,company_domain" \
  -H "apikey: $API_KEY" \
  -H "Authorization: Bearer $API_KEY"
```

### 2. Delete from enrichment_results_log

```bash
# Delete all records for this company + step
curl -s -X DELETE "https://wvjhddcwpedmkofmhfcp.supabase.co/rest/v1/enrichment_results_log?company_id=eq.{COMPANY_ID}&step_number=eq.{STEP}" \
  -H "apikey: $API_KEY" \
  -H "Authorization: Bearer $API_KEY"
```

### 3. Delete from company_play_step_completions

```bash
# Delete completion record for this company + step
curl -s -X DELETE "https://wvjhddcwpedmkofmhfcp.supabase.co/rest/v1/company_play_step_completions?company_id=eq.{COMPANY_ID}&step_number=eq.{STEP}" \
  -H "apikey: $API_KEY" \
  -H "Authorization: Bearer $API_KEY"
```

### 4. Delete from destination table (Workspace DB)

The destination table depends on the step:

| Step | Destination Table |
|------|-------------------|
| 1. Scrape Homepage | `company_homepage_scrapes` |
| 2. Find Case Studies Page | `company_case_studies_page` |
| 3+ | Check workflow config in `destination_config.destinations[].table` |

```bash
GTM_KEY="your-workspace-anon-key"

# Example: Delete from company_homepage_scrapes
curl -s -X DELETE "https://kwxdezafluqhcmovnwbn.supabase.co/rest/v1/company_homepage_scrapes?company_domain=eq.{DOMAIN}" \
  -H "apikey: $GTM_KEY" \
  -H "Authorization: Bearer $GTM_KEY"
```

### 5. Verify deletion

```bash
# Check enrichment_results_log
curl -s "https://wvjhddcwpedmkofmhfcp.supabase.co/rest/v1/enrichment_results_log?company_id=eq.{COMPANY_ID}&step_number=eq.{STEP}&select=id" \
  -H "apikey: $API_KEY" \
  -H "Authorization: Bearer $API_KEY"
# Should return: []

# Check company_play_step_completions
curl -s "https://wvjhddcwpedmkofmhfcp.supabase.co/rest/v1/company_play_step_completions?company_id=eq.{COMPANY_ID}&select=step_number" \
  -H "apikey: $API_KEY" \
  -H "Authorization: Bearer $API_KEY"
# Should NOT include the deleted step
```

---

## Quick Reference: Full Reset Example

Reset **nostra.ai** from Step 2 back to Step 1:

```bash
API_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2amhkZGN3cGVkbWtvZm1oZmNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4NTg1MDMsImV4cCI6MjA4MDQzNDUwM30.BeuAvIAd8a92LcT4O8USdt3cu9VZHHrbFTnDwC1auFE"
GTM_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3eGRlemFmbHVxaGNtb3Zud2JuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MjE2MTksImV4cCI6MjA4MDM5NzYxOX0.I_TVuQSvlky7Pm31zbWVlB1eXWqcMp_GDpvYSvAEa4c"
COMPANY_ID="dc6a4d20-6352-49ed-9f17-3bf5baf57b36"

# 1. Delete from HQ tables
curl -s -X DELETE "https://wvjhddcwpedmkofmhfcp.supabase.co/rest/v1/enrichment_results_log?company_id=eq.$COMPANY_ID&step_number=eq.2" \
  -H "apikey: $API_KEY" -H "Authorization: Bearer $API_KEY"

curl -s -X DELETE "https://wvjhddcwpedmkofmhfcp.supabase.co/rest/v1/company_play_step_completions?company_id=eq.$COMPANY_ID&step_number=eq.2" \
  -H "apikey: $API_KEY" -H "Authorization: Bearer $API_KEY"

# 2. Delete from Workspace table (example: Step 1 destination)
curl -s -X DELETE "https://kwxdezafluqhcmovnwbn.supabase.co/rest/v1/company_homepage_scrapes?company_domain=eq.nostra.ai" \
  -H "apikey: $GTM_KEY" -H "Authorization: Bearer $GTM_KEY"
```

---

## Notes

- Deleting from `company_play_step_completions` makes the company appear in the queue for that step again
- Deleting from `enrichment_results_log` removes the audit trail
- Deleting from the destination table removes the actual data
- You may also need to delete from `enrichment_batches` if cleaning up batch records
