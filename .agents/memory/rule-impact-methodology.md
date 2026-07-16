---
name: Rule impact methodology
description: How adjustment-rule affected units and $ impact must be computed (trigger-qualified, move-ins-based)
---

## Rule

Rule "affected units" must qualify units by the rule's **trigger conditions** (evaluated per campus/service-line/room-type group against latest-month metrics), not just `action.filters`. Impact = **trailing-3-month avg move-ins/month for qualified units × Δ monthly rate** (HC & HC/MC daily rates × 30.4), annualized ×12.

**Why:** Counting all filter-matched units × rate × pct overstated impact by ~600× ($56.5M vs realistic <$1M) and showed thousands of units for rules whose triggers almost nothing met. New residents come in at the adjusted rate, so impact accrues at move-in pace.

**How to apply:** All rule-impact surfaces (rules list enrichment, combined-stats, coverage drill-down, PATCH persist) must go through the shared rule-impact service so numbers agree. Context is cached per client (`ruleImpactCtx:{clientId}`) and purged with other rule caches.

## Gotchas
- Trigger occupancy values are stored as fractions (0.93) but metrics are 0–100 scale — normalize values ≤1 by ×100 before comparing.
- T3 move-ins map keys by location NAME, groups by location id; unknown trigger metric fields (e.g. inquiry-based) fail the group, matching engine behavior with missing data.
- Demo client has few recent move-ins, so demo impacts are legitimately tiny — not a bug.
