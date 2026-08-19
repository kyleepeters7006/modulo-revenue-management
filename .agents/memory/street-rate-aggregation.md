---
name: Street-rate aggregation — average everywhere
description: Street rate is the AVERAGE on every surface, with junk rows removed by the shared relative outlier gate. Replaced the old mode()-vs-AVG split.
---

# Street-rate aggregation: average everywhere

**Current rule:** every surface reports the street rate as `AVG(street_rate)`
with junk rows removed by the shared relative outlier gate (see
[rate-outlier-gate.md](rate-outlier-gate.md)). This replaced an older split in
which Reference Data used `mode() WITHIN GROUP` while other surfaces averaged.

**Why the change:** mode() suppressed outliers only as a side effect of throwing
away all rate dispersion — it reports the most common rate, not the rate level —
so two surfaces on different bases disagreed on a large minority of groups. The
user's decision was average everywhere, with outliers handled explicitly.

## The trap mode() was hiding

mode() **masks weighting-basis differences that AVG exposes.** A per-room-type
value that is unit-weighted up to an all-rooms figure can be weighted either by
count of contributing rows or by count of distinct physical rooms. Under mode()
these give the same answer, because a junk row still votes and still counts.
Under AVG they diverge the moment a row is excluded from the rate but not from
the count. Two surfaces looked identical for as long as both used mode() and
disagreed immediately on switching to AVG.

**How to apply:**
- When two surfaces disagree on "our rate" for the same units, check the
  *weighting basis* before suspecting the room-type filter or the B-bed
  predicate. Rows-vs-rooms is the likelier culprit.
- Do not invent a separate outlier threshold for a new surface. Inconsistent
  thresholds are how these surfaces drifted apart originally.
- B-bed exclusion incidentally hides some junk rows (bad values often land on
  the companion bed), so a surface that excludes B beds can look correct while
  the underlying data is still dirty. Do not read that as evidence the aggregate
  is safe.
- Some surfaces still carry the retired fixed dollar floor and/or mode(). Treat
  any such site as unconverted, not as a second opinion.
