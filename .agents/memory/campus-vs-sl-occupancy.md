---
name: Campus-level vs per-service-line occupancy
description: When occupancy history rows need combined-service-line splitting and when they don't.
---

Occupancy history rows (`room_type_occupancy_history`) sometimes carry a *combined*
service-line string such as `"AL, AL/MC, HC"` rather than a single line. Consumers
generally have to distribute those rows across the individual lines with the shared
`splitCombinedSl` helper, using identical rent-roll weights, or pages disagree with
each other.

**Rule: that splitting is only required when you attribute a row to an individual
service line. A campus-level (whole-location) occupancy figure does not need it —
just sum `occ_units` and `available_units` across every history row for the location
and divide once at the end.**

**Why:** each history row contributes its own occupied and available counts to the
campus exactly once, whatever its service-line label says. Splitting only re-partitions
those same totals between lines; it never changes their sum. So the campus ratio is
identical either way, and re-implementing the distribution logic for a campus number
adds a large amount of code whose only possible effect is to introduce drift from the
canonical implementation.

**How to apply:** when you need one occupancy number for a whole campus (a popup, a
header stat, a roll-up), aggregate the raw history rows directly. Reach for
`splitCombinedSl` only when the output is keyed by service line. Either way, always
compute the percentage from summed counts rather than averaging per-row percentages.

Keep the rent-roll fallback: when a location has no history coverage at all, fall back
to the rent-roll occupied/total counts and label which source was used, so a campus
that silently has no history is visibly different from one that is genuinely empty.
