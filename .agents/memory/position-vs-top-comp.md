---
name: Position vs Top Competitor — one shared comparison rule
description: Every surface reporting price position must use the shared studio/all-room rule and the weight-selected care-adjusted benchmark; comparing blended in-house rates against a max competitor rate inflates the number badly
---

## The rule
Any surface that answers "how do we sit against the top competitor" must:

1. Pick the top competitor by **highest survey weight** (ties broken by nearest distance), never by
   taking `MAX(competitor_final_rate)` across units. The max is usually a distant outlier.
2. Care-adjust that competitor rate (care L2 + med-mgmt) so it is on our all-in basis. Skipped for
   SL/VIL, which are not care-bearing.
3. Compare it against `pickComparisonRate(serviceLine, studioRate, allRoomRate)` in
   `server/services/compBenchmark.ts` — Studio-only, except VIL and any location/service line where
   we have no Studio units at all, which use an all-room-type average.
4. Compute per **location + service line**. Rate basis (daily vs monthly) then takes care of itself,
   because HC/HC-MC are daily on both sides and senior housing is monthly on both sides.

**Why:** The analytics KPI and the Competitive Position chart independently answered the same
business question and disagreed by an order of magnitude — the KPI reported AL at roughly +139%
against a market the chart put at about +20%. Two causes compounded: an outlier competitor on one
side, and a blended in-house average spanning Companion through 2BR on the other, so room mix alone
moved the headline. The Studio-vs-Studio comparison is the like-for-like one because Studio is the
product nearly every competitor publishes.

**How to apply:**
- Reuse `loadStudioCompBenchmark` / `benchmarkFor(location, serviceLine)` rather than writing fresh
  comparison logic. Two surfaces with their own math will drift again.
- Never surface a campus's blended average rate next to a top-comp rate as if the two explain the
  position — they do not reconcile. Return the rate the position was actually computed from.
- Resolve the survey key through `location_id` first; survey rows are keyed by the canonical
  KeyStats location name and rent-roll rows can carry alternate spellings.
- Verify by asserting point-level parity between the KPI and the chart for the same location and
  service line, across every service line — VIL and SL exercise the no-Studio fallback.

## Known coverage gap (affects both surfaces equally)
A location/service line with no survey rows of the mapped competitor type yields no position at all.
This is most visible on AL/MC — see `comp-benchmark-client-id.md`.
