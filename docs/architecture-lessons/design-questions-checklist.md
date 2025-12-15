# Design Questions Checklist

Before building any enrichment workflow, feature, or data pipeline, answer these questions.

---

## 1. Data Flow

**Where does the data come from?**
- Source table(s)
- What fields are available?
- What foreign keys link to other tables?

**Where does the data go?**
- Destination table(s)
- What fields need to be stored?
- What context fields must travel with the data?

**What happens in between?**
- External API calls (Clay, LeadMagic, OpenAI)?
- What data do they need?
- What data do they return?

---

## 2. Dispatch Logic

**Should ALL records be dispatched, or a subset?**
- What are the inclusion criteria?
- What are the exclusion criteria?
- Examples: exclude case study company, exclude companies >5k employees, only include US-based

**Do I need a filtered view?**
- If any filtering is needed, create a view
- Point the workflow at the view, not the raw table
- Keep storage and dispatch concerns separate

**What joins are needed for filtering?**
- Can I filter using only the source table?
- Do I need to join to other tables for context?

**Does the data need to be transformed for dispatch?**
- Does the external API expect a different shape than how we store it?
- Do arrays need to be exploded into individual rows? (use `jsonb_array_elements_text()`)
- Are there duplicates that should be deduplicated before dispatch? (use `DISTINCT ON`)
- Example: 10 job titles stored as array → 10 separate API calls

---

## 3. Workflow Dependencies

**What does this workflow depend on?**
- List ALL tables/views this workflow reads from
- What workflow populates each source?
- Is that workflow triggered automatically before this one?
- If not, what happens if the dependency data doesn't exist?

**What depends on this workflow?**
- What downstream workflows need this data?
- Should completion of this workflow auto-trigger the next one?
- If manually triggered, is the user aware of the sequence?

---

## 4. Downstream Data Consumers

**What workflows will consume this data next?**
- List them explicitly
- What fields will they need?
- What filtering will they need?

**Am I storing everything those workflows need?**
- Context fields (hq_target_company_*, person_name, etc.)
- Foreign keys for joins
- Metadata for filtering

**What questions will users ask of this data?**
- Reporting needs
- Filtering needs
- Grouping needs

---

## 5. Scale Implications

**What happens at 10x volume?**
- 100 records → 1,000 records → 10,000 records
- Does the approach still work?
- Are there API limits, rate limits, cost concerns?

**What happens with multiple target companies?**
- Does the data stay properly segmented?
- Can I query by target company?
- Is hq_target_company_id indexed?

---

## 6. Separation of Concerns

**Am I solving the problem at the right layer?**

| Problem Type | Solve At |
|--------------|----------|
| What data to store | Storage worker |
| What records to dispatch | Views / queries |
| How to filter results | Views / queries |
| How to transform data shape | Views (explosion, deduplication) |
| What to send to external API | Workflow config |

**Will this change require modifying multiple layers?**
- If yes, reconsider the approach
- Usually means I'm solving at the wrong layer

---

## 7. Error Cases

**What if the external API fails?**
- Is the error logged?
- Can we retry?
- Is partial data handled gracefully?

**What if data is missing?**
- Null handling
- Default values
- Skip vs. fail

---

## 8. Pre-Build Confirmation

Before writing any code or config, state:

1. **Source**: [table/view name]
2. **Dependencies**: [what workflows must run first for source to have data]
3. **Filtering**: [all records / filtered by X]
4. **Destination**: [table name]
5. **Context fields carried**: [list them]
6. **Downstream consumers**: [list them]
7. **Exclusions**: [list any records that should NOT be processed]
8. **Chain trigger**: [does this workflow auto-trigger the next one? if not, why not?]

If I cannot answer these clearly, I need to ask the user before proceeding.

---

## Summary

The goal is to think through 2nd order implications BEFORE building. Ask questions upfront. Build systems that scale. Keep layers separate.

When in doubt, ask the user. Don't assume.
