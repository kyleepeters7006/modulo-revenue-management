---
name: Care-rate basis trap — our HC rates are daily, competitor care rates are monthly
description: The unit mismatch that silently inflated HC care adjustments ~30x, and the rule for normalizing it.
---

# Care rates: our HC is per-day, competitor care is per-month

Two different bases collide in competitor comparisons:

- **Our** rates: health-care lines (`HC`, `HC/MC`) are stored and displayed **per day**.
  Everything else (`AL`, `AL/MC`, `SL`, `VIL`) is **per month**.
- **Competitor** `care_level_2_rate` from the survey table is **per month for every line**,
  including the HC lines.

Subtracting one from the other without converting produces a care adjustment roughly 30x
too large on HC lines, which then flows into the adjusted rate and the variance.

**The rule:** pick the service line's *native* basis — per-day for HC lines, per-month for
everything else — and convert the competitor value into it before any arithmetic. Convert
competitor monthly care **down to daily** for HC lines; never push our daily rate up to
monthly.

**Why:** the native basis is what the rest of the app already displays for that line, so
converting the competitor value is the only direction that keeps the street rate, the care
adjustment and the variance in one consistent unit that matches the rest of the UI.

**How to apply:** use `normalizeCompetitorCareRate` in `shared/careRates.ts`. It only
converts when the value looks monthly (a large threshold), because a few rows already
arrive daily — an unconditional divide would corrupt those. Watch out for older code that
*multiplied* small care values by the days-per-month constant to force everything monthly;
that is the wrong direction against a daily base. Other competitor-adjustment consumers
(`competitorAdjustments`, `competitorRateMatching`, `competitorRateJobService`,
`competitorLookup`) still contain the un-normalized math and remain suspect.
