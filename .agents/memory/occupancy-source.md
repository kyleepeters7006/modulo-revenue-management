---
name: Occupancy source of truth
description: room_type_occupancy_history is the authoritative occupancy source; rent_roll_data.occupied_yn is a fallback for clients without RTO uploads.
---

## Rule
Always read occupancy from `room_type_occupancy_history` (SUM occ_units / SUM available_units). Fall back to `COUNT(*) FILTER (WHERE occupied_yn)` from `rent_roll_data` only when RTO has no rows for that client.

**Why:** The RTO table stores physically-distinct room counts uploaded from operator census reports. `occupied_yn` in rent_roll_data reflects the raw import which can double-count beds (B-beds, companion rooms split into multiple rows) or lag behind the actual census. For trilogy, RTO shows ~89% while occupied_yn shows ~46% — a massive discrepancy.

**How to apply:**
- Before adding any new endpoint that shows occupancy, check whether it queries RTO first.
- Pattern: query RTO grouped appropriately, set `hasRTO = avail > 0`, use RTO when true.
- For combined service_line strings (e.g. "AL, AL/MC"): split via the shared `splitCombinedSl` helper in `server/services/slSplit.ts` — avail distributed by rent-roll UNIT counts, occ by rent-roll OCCUPIED counts (so fuller lines like AL/MC aren't flattened to the building blend), with occ clamped ≤ avail and excess redistributed. Weights ALWAYS exclude B beds via the shared predicate (`slWeightSqlPredicate` / `isSlWeightUnit`) so all endpoints use identical weights; weights must not depend on the active serviceLine filter.
- Compute displayed percentages BEFORE rounding numerator/denominator (rounded-count division causes 0.1–0.4pt drift between pages).
- RTO uploads can LAG the rent roll (rent roll has July, RTO ends at June). Never fall back to rent-roll counts for a "spot" month RTO lacks — anchor the spot window to the latest month with RTO data instead (same anchoring pattern as inquiry metrics). Falling back mid-source made spot occupancy read ~72% vs the true ~90%.
