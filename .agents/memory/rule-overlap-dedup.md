---
name: Rule overlap dedup policy
description: How overlapping adjustment rules are prevented from double-counting units in impact totals
---

**Rule:** When multiple active adjustment rules qualify the same unit, the unit is attributed to exactly one rule — the newest by effectiveDate, then createdAt, then id. Older rules only count unclaimed units (`overlapExcludedUnits` reports what was skipped).

**Why:** Per-rule impacts used to be computed independently, so overlapping rules each summed the same units and the Net Annual Impact dialog over-stated totals (only a "may overlap" warning was shown). A frontend "identical impact number" heuristic was rejected in review as false-positive-prone; unit-level backend attribution is exact.

**How to apply:** Dedup lives in the rules list endpoint via an `excludeUnitIds` claimed-set threaded through the qualified-impact computation. Any new surface that sums per-rule impacts should consume these deduped numbers, not recompute per-rule impacts independently. Frontend must not re-exclude rules from totals — backend numbers are already net of overlap.
