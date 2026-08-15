---
name: Scoped filters that resolve to zero locations
description: Why a location/region/division filter matching nothing must emit a false SQL predicate instead of being skipped.
---

Analytics endpoints resolve `locations` / `regions` / `divisions` query params into a set of location
ids before building SQL. The common idiom guards the predicate with a truthiness check on the
resolved set's size:

```
if (scopeIds && scopeIds.size) { ...append AND location_id = ANY(...) }
```

This is wrong when filters *were* requested but matched no locations. The size check fails, the
predicate is skipped, and the query silently returns **portfolio-wide** results for a scope the user
believes is narrow.

The rule: distinguish "no filter requested" (`scopeIds` is null → no predicate) from "filter
requested, matched nothing" (`scopeIds` is empty → `AND FALSE`).

**Why:** it fails in the most dangerous direction. An empty result is obviously empty and gets
reported; a portfolio-wide result looks plausible and gets read as the filtered figure. It is also
easy to miss in review because the guard looks defensive rather than buggy.

**How to apply:** whenever a request mixes a SQL half and an in-memory/engine half, check that both
halves agree on the empty case. The engine side usually handles it correctly on its own — passing
`locationIds: []` naturally yields no units — so a mismatch shows up as a report whose historical
numbers are portfolio-wide while its computed numbers are zero. That inconsistency is the tell.

## The same failure in write paths: accepted-but-ignored scope

The background pricing job accepts `serviceLine`, `regions`, `divisions` and `locations`, but only
ever filtered on one of them, and matched location **ids** while every caller sends location
**names**. Both directions of the bug were live at once:

- a name filter matched nothing, so the job priced **zero** units and still reported `completed`;
- the other three filters were ignored, so a narrowly-scoped run would rewrite the **whole
  portfolio's** rates while reporting success.

Write paths make this far worse than read paths: a wrong scope silently overwrites stored rates
rather than just displaying a wrong number.

**Why:** a job param that is destructured but never used looks identical to one that works. Nothing
fails, and the status is green either way.

**How to apply:** for any scoped background job, assert that every accepted filter is actually
applied, and treat "filters were requested but matched nothing" as a **job failure**, not an empty
success. Verify containment empirically — record a timestamp, run the scoped job, then confirm rows
*outside* the scope have an untouched `*_calculated_at`. A run that reports success proves nothing.

## Related trap: the endpoint names are inverted

`POST /api/pricing/generate-modulo` is **synchronous** (it delegates to `generateModuloOptimized`),
while `POST /api/pricing/generate-modulo-optimized` is the **background job**. The name tells you
nothing about which is which. The synchronous one prices roughly 16 units/sec, so any full-portfolio
run through it exceeds the HTTP timeout and surfaces to the user as a generic generation failure.
Long-running pricing must go through the job path.
