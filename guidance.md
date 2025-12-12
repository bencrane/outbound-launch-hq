# Outbound Launch HQ - Project Guidance

## What This Is
A command center for my outbound sales workflow. This is a solo operator tool - not a SaaS product. No users, no auth. Just me.

## The Workflow
1. I have datasets: companies, people, enriched versions of both
2. Enrichment happens through external pipelines (n8n, Pipedream) - not in this app
3. This app is the UI to view, filter, select, and manage that data
4. End goal: Identify target companies → find their public customers (case studies) → find buyers at those companies → pre-build a demo dashboard to show prospects before the sales call

## Tech Preferences
- Next.js, TypeScript, Tailwind
- Clean, maintainable code - this will grow to have many tables and views
- Modular structure - easy to add new tables, new views, new features
- Type safety matters - we'll have a lot of data models
- Keep components reusable where it makes sense
- No over-abstraction, but no sloppy shortcuts either

## How We Work
- Small chunks, test, adjust
- I'll iterate with you frequently
- Ask clarifying questions before making assumptions
- When adding new tables/features, consider how they relate to existing ones

## Database Structure
Supabase project with:
- `pdl_companies` - 23M reference records (id, name, website, linkedin_url, industry, country, region, locality, size, founded)
- `companies` - core working table (id uuid, company_name, company_domain, company_linkedin_url, created_at, updated_at)
- `people` - core working table (id uuid, first_name, last_name, full_name, company_name, company_domain, company_linkedin_url, person_linkedin_url, created_at, updated_at)

More tables will be added for enrichment outputs. People and companies are loosely coupled (matched by domain when needed, no foreign keys).