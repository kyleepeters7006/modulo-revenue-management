---
name: Reference Data vs other surfaces — which differences are real
description: Audit outcome. Census totals agree across surfaces; the real divergences are rate basis, payer scope, and daily/monthly normalization. Lists which gaps are deliberate rules vs accidental drift.
---

# Reference Data vs other surfaces

Audited whether Reference Data pulls "unopinionatedly" and whether other surfaces
(Pricing Analytics, Overview, tiles, Analysis) match it.

## What already agrees — do not go hunting here

**Census is consistent.** Total units, occupied units, and occupancy % agree
*exactly* across Reference Data, Pricing Analytics campus metrics, and Overview.
The unit-counting pipeline is not the problem; assume it is right unless a specific
number contradicts it.

## Deliberate domain rules — not bugs

These look like inconsistencies but are intentional. Do not "fix" them without asking:

- **Companion/B-bed exclusion for senior housing, retained for HC.** Companion rows
  are a large share of the census (roughly half of some senior lines), so whether
  they are excluded dramatically moves denominators. HC deliberately keeps every bed.
- **HC private-pay-only** treatment for pricing-impact math.
- The `/B` vs `/[B-Z]` regex variants look divergent but match identically in
  practice — no row uses a `/C`..`/Z` suffix. Theoretical, not material.

## Real divergences worth attention

- **Daily vs monthly blending.** HC/HC-MC rates are stored per *day*, senior housing
  per *month*. Any surface that averages them without normalizing produces a
  meaningless blended number. This is the single most damaging class of bug because
  the output still looks like a plausible dollar figure.
- **No single days-per-month constant.** Multiple different values coexist across the
  codebase, plus separate annualization factors. Same metric, different surface,
  different answer. Prefer the shared constant in `shared/careRates.ts`.
- **Payer scope for revenue.** Some revenue surfaces exclude government/managed payers
  and some do not, and this splits a *large* fraction of occupied census — enough to
  make two "current revenue" figures differ substantially. Also, some payer values fall
  into neither the "excluded" nor the "counts as private" bucket, so they are treated
  inconsistently between current and potential revenue.
- **Minimum-rate floor.** Reference Data drops non-HC rows below a fixed dollar floor;
  other surfaces do not. Small overall, but concentrated in the lower-rate lines.
- **Mode vs mean street rate.** Reference Data uses the modal rate; most other surfaces
  average. At the true grouping level the portfolio roll-up differs by only a couple of
  percent, but a large minority of individual groups still disagree — so *row-level*
  Reference Data numbers won't tie to Analytics even when the totals do.

## The judgment call

"Unopinionated" is not achievable for several of these — the code must pick something.
The defensible goal is **one canonical definition per metric, shared**, not the absence
of a definition. The bug is that different surfaces silently pick differently.
