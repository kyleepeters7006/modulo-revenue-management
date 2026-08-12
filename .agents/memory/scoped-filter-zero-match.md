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
