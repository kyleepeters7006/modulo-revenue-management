---
name: Competitive survey data scoping and AL/MC competitor mapping
description: Diagnose empty competitor benchmarks in tenant order (session → user row → predicate), and treat the AL/MC competitor-type mapping as data-dependent rather than fixed.
---

# competitive_survey_data scoping

**Rule:** query the table with a NULL-tolerant tenant predicate:

```sql
WHERE (client_id = $1 OR client_id IS NULL)
```

**Why:** the table was originally imported with no tenant stamped on any row, and
a plain `client_id = $1` filtered out every row — the competitive-position scatter
and the AI commentary both went blank for every explicit tenant, while the
Competitors tab kept working because it reads through a different query path.
The rows carry real tenant values now, so a plain equality predicate happens to
work today; the NULL branch is kept as cheap insurance against a future import
that forgets to stamp the tenant.

**How to apply:** because the data is tenant-scoped now, a missing NULL branch is
no longer the likely cause of an empty result. Check the more common traps first:
an unauthenticated session silently resolving to the demo tenant, or a user row
with a null client_id. Confirm against the data before rewriting a query.

# Empty competitor benchmarks: diagnose in this order

**Rule:** when a competitor benchmark, price position or AI commentary comes back
empty for one tenant but not another, work through the causes in likelihood order
before touching any query:

1. an unauthenticated session silently resolving to the demo tenant;
2. a user row whose client_id is null, routing a real user to demo;
3. survey rows that were imported without a tenant stamped on them.

**Why:** cause 3 is the memorable one — the survey table was originally imported
with no tenant on any row, so a plain equality predicate filtered out everything —
but it is the rarest, and rewriting a query to chase it hides the first two. A
NULL-tolerant predicate (`WHERE client_id = $1 OR client_id IS NULL`) is still
worth keeping as insurance against an import that forgets to stamp the tenant,
since it costs nothing when the data is clean.

**Note (verified 2026-08-16):** `competitive_survey_data` no longer has any NULL
`client_id` — every row carries a real tenant value today. A plain
`WHERE client_id = $1` therefore returns data correctly. Keep the NULL-tolerant
predicate anyway; re-check the actual data before treating a missing NULL branch
as the cause of an empty result — the likelier culprit now is the
unauthenticated-session-resolves-to-demo trap described above.

**How to apply:** confirm which tenant the request actually resolved to before
concluding the data is missing. Note that different surfaces reach this data
through different query paths, so one page working is not evidence that the
predicate is right.

# AL/MC competitor-type mapping

**Rule:** there is no permanently correct value for the AL/MC entry in the
service-line-to-competitor-type map. It depends on whether the client's survey
import actually produced AL/MC rows.

**Why:** mapping AL/MC to itself alone is right where the import populates AL/MC
rows — the main client's import does for most locations (~137 of 148). It is
wrong for any client whose survey contains no AL/MC rows at all — those locations
then get no competitor benchmark and no price position, and they fail silently
rather than erroring. The demo dataset has no AL/MC rows.

**How to apply:** before changing the mapping, check the actual distribution per
client:

```sql
SELECT competitor_type, COUNT(DISTINCT keystats_location)
FROM competitive_survey_data GROUP BY 1
```

Widening the mapping to include AL moves every surface that consumes the
benchmark, not just the one being debugged.
