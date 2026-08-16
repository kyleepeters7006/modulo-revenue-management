---
name: Same-store cohort must be derived, not read from the flag
description: locations.same_store (and rent_roll_data.same_store) are true for every row, so trusting them makes "same store" equal the whole portfolio.
---

## Rule
Derive the same-store (comparable-store) cohort from the data: campuses reporting in **both** the current period and the same month one year earlier. Do not read `locations.same_store` or `rent_roll_data.same_store`.

**Why:** despite the schema documenting `same_store` as "location existed in prior year", every location row and every rent-roll row carries `same_store = true`. Anything filtering on it gets the entire portfolio back, so the same-store figure sits within a rounding error of the total and hides exactly what the comparison exists to show — how much of the change came from newly-added campuses. In one real portfolio the flag produced 15,260 of 15,281 units; the derived cohort was 13,953 across 136 of 152 campuses, because a batch of campuses was onboarded mid-year.

**How to apply:**
- Intersect the prior-period campus set with the current-period set — a campus that has since closed is not comparable either.
- Derive the cohort from the **same table the tile aggregates**, or the names will not match.
- Fall back to the flag *only* when there is no year-ago period at all (a client with under a year of history). An empty intersection against a real year-ago period is a legitimately empty cohort; widening it back to the all-true flag silently restores the bug.
- Compute the cohort **once** per request and reuse it. Occupancy had a separate later code path that re-derived membership from `BOOL_OR(l.same_store)` in its own SQL, so fixing the shared derivation alone left occupancy on the old basis. Grep for every same-store membership test before declaring the fix done.
