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
- Occupancy is computed on MORE THAN ONE surface. The main dashboard and the Analysis page each derived it independently, and the Analysis page was still rent-roll-based long after the dashboard was fixed. When enforcing this rule, audit every occupancy surface rather than assuming a single code path.
- Decide the source on "does this client have ANY RTO rows", NOT on "did the current filter return rows". A location with no RTO coverage that silently falls back to rent-roll counts looks like a real occupancy collapse rather than missing data.
- **But all-or-nothing is too coarse once the read is scoped.** For a per-service-line reader, decide the fallback per line, not for the whole scope: a campus whose history covers assisted living but not its villas otherwise reports the villas unmeasurable while rent-roll rows for them sit right there. Every line history does cover keeps the better number, and the source is reported per line rather than one label for the table. Real campuses in this state exist — several report SL only in the rent roll.
- **Anchor months must be scope-local.** Taking the client-wide latest month and then applying the campus filter returns nothing for any campus whose upload lags the portfolio, which is indistinguishable from a campus with no data. Put the location predicate inside the anchor CTE/subquery, not only in the outer query. Both the history anchor and the rent-roll anchor need this.
- Derive the rent-roll fallback from the same query that already computes per-line rent-roll weights, rather than adding a second query beside it. Two queries answering "how many units and how many occupied" drift apart the moment one predicate changes, and the fallback is exactly where nobody notices.
- Whatever the endpoint returns must also say WHICH source and WHICH month it used, and the UI must render that. Silently labelling a rent-roll fallback as occupancy-history data is worse than showing no label.
- Never ship a placeholder trend/delta (e.g. `Math.random()`); a fabricated movement indicator is indistinguishable from a real one to the user. Derive it from the prior RTO month or return null.
- RTO uploads can LAG the rent roll (rent roll has July, RTO ends at June). Never fall back to rent-roll counts for a "spot" month RTO lacks — anchor the spot window to the latest month with RTO data instead (same anchoring pattern as inquiry metrics). Falling back mid-source made spot occupancy read ~72% vs the true ~90%.

## Capacity (unit / bed counts) follows the same rule
`available_units` is also the authoritative source for **unit and bed capacity**, not just the occupancy denominator. Counting `rent_roll_data` rows — even with companion/B-bed rows excluded — does not reproduce the client's own census: it under-counts HC and AL and over-counts SL, and the errors partially cancel so the portfolio total looks nearly right while every service line is wrong. Reconciled against a client census report, history availability landed within a unit or two per service line; the rent-roll row count was off by tens per line.

**How to apply:** any surface showing "total units", capacity, or a unit breakdown must read history availability with the same period selection as the tile it drills into — MAX(year), then MAX(month) within that year. Decide the rent-roll fallback on availability **at that exact period**, not on a sum across all history: if the newest upload is incomplete, a whole-history test keeps the drill-down on history while the tile falls back, and the two disagree again.

**Trap:** two surfaces reading different sources is the usual cause of a KPI tile and its drill-through dialog disagreeing by a small amount. Check the source before hunting for an aggregation bug.
