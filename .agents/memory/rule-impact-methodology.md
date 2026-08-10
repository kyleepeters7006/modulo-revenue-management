---
name: Rule impact methodology
description: How adjustment-rule affected units and $ impact must be computed (trigger-qualified, move-ins-based)
---

## Rule

Rule "affected units" must qualify units by the rule's **trigger conditions** (evaluated per campus/service-line/room-type group against latest-month metrics), not just `action.filters`. Move-ins/mo = **qualified units × per-service-line move-in rate** (trailing-3-month move-in events ÷ 3 ÷ active units in the SL). Impact = move-ins/mo × Δ monthly rate (HC & HC/MC daily rates × 30.4), annualized as FIRST-YEAR CUMULATIVE ×78 (stacked move-in cohorts: 12+11+…+1 delta-months); steadyStateAnnualImpact = ×144 (fully-ramped run-rate). In-house repricing rules are fully ramped immediately: both = ×12. User chose ×78 as the headline 'annual impact' (Aug 2026) after flagging ×12 as far too low; UI labels say 'First-Year Impact' with a 'fully ramped' secondary figure.

**Why:** Counting all filter-matched units × rate × pct overstated impact by ~600× ($56.5M vs realistic <$1M) and showed thousands of units for rules whose triggers almost nothing met. New residents come in at the adjusted rate, so impact accrues at move-in pace.

**How to apply:** All rule-impact surfaces (rules list enrichment, combined-stats, coverage drill-down, PATCH persist) must go through the shared rule-impact service so numbers agree. Context is cached per client (`ruleImpactCtx:{clientId}`) and purged with other rule caches.

## Gotchas
- Trigger occupancy values are stored as fractions (0.93) but metrics are 0–100 scale — normalize values ≤1 by ×100 before comparing.
- Do NOT use raw per-group (campus/SL/RT) move-in event counts for impact — room-type strings vary between monthly snapshots so DISTINCT ON over-counts (~2.4× for AL/MC). Use the SL-level rate instead; user confirmed this method.
- Unknown trigger metric fields (e.g. inquiry-based) fail the group, matching engine behavior with missing data.
- Demo client has few recent move-ins, so demo impacts are legitimately tiny — not a bug.
