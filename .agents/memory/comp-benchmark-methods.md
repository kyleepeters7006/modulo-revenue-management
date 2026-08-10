---
name: Competitor benchmark methods
description: Which street-vs-comp comparison to trust; raw competitor_final_rate averages overstate premiums
---

# Competitor benchmark methods

Rule: never present a street-vs-comp premium computed as a raw average of
`rent_roll_data.competitor_final_rate` — it is a blended, room-mix-distorted
number (showed AL at a false 34.7% premium when the care-adjusted market
benchmark put AL at parity).

**Why:** `competitor_final_rate` is a per-unit stored value from the matching
job with room-type fallbacks and care/med adjustments baked in; averaging it
across a service line mixes incomparable room types and biases the denominator
low.

**How to apply:** The defensible benchmark is the Competitive Position scatter
method: survey `monthly_rate_avg` averaged per location + competitor type
(HC/HC-MC/SMC normalized daily), plus care adjustment
`(their care L2 − our care L2) + their med mgmt`, with the care-L2 differential
gated to HC, HC/MC, AL, AL/MC only (never SL/VIL). SL→IL_IL, VIL→IL_Villa,
HC/MC→[HC/MC, SMC]. For multi-location scopes, unit-weight per location and
fall back per-location (not globally) to competitor_final_rate averages where
survey coverage is missing. This methodology now lives in a shared service
(`compBenchmark` in server/services) used by both the Competitive Position
scatter and the AI rule-suggest endpoint — always reuse it for new premium
displays instead of re-implementing. The strategy overview's top-comp max
method and legacy /api/compare style raw averages are separate, older methods.
