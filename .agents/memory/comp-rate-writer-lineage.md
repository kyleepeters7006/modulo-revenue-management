---
name: Competitor comp granularity decision & stale-data fingerprint
description: RT-specific comp everywhere except the Competitive Position chart; how to spot and repair stale fallback-derived care adjustments.
---

# Competitor comp granularity & stale-data repair

## Granularity decision (recorded)
Room-type-specific comp everywhere the surface is room-type-specific (Reference Data, stored per-unit columns, `benchmarkForRT`). The Competitive Position scatter is the one deliberate exception: it plots one point per campus/SL against our studio-family rate, so its benchmark blends the top competitor's Studio + Studio Dlx rows. Do not "fix" that blend without also changing the chart's own-rate basis.

**Why:** blending room types of different price points distorts Δ$/Δ% for RT-specific rows; but the chart's y-axis is itself a studio-family aggregate, so a matching blend is the consistent comparison.

## Durable lessons
- Care adjustments ending in .2/.8 uniformly across a client are the fingerprint of stale data written with the $55/day care fallback (55 × 30.44 = $1,674.20/mo) before real care rates existed; the repair is re-deriving the stored columns, not editing them.
- The daily-vs-monthly survey basis must be decided by the MATCHED record's competitor type (HC/MC units can match legacy daily SMC rows).
- Every writer of the stored competitor columns must share ONE matching policy and write/clear the FULL stored contract (including legacy `competitor_rate` and the explanation); a writer that touches only some columns leaves stale values behind on no-match.
- Survey lookups must be tenant-scoped and pinned to the client's latest survey month; any memo of that month must be invalidated on survey import, because recalculation is scheduled immediately after import.
