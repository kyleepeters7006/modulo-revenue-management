---
name: IH-to-street variance metric
description: How the in-house-to-street rate variance condition is computed and where it must stay consistent
---

Rule condition field aliases: `ih_street_variance` (NLP parser output) and `street_to_ih_var` (legacy). Any code branching on this metric must accept both — category inference, impact qualification, and the rate engine.

**Definition** (must stay identical in all three places — recalc endpoint, ruleImpactService group aggregates, adjustmentRulesService campus metric `ih_street_var_pct`): occupied single-occupant units only — SH (AL, AL/MC, SL, VIL) excludes room_type 'Companion' with both rates > 100; HC/HC-MC counts payor ILIKE '%PRIVATE%' with both rates > 0 and daily rates ×~30.4 to monthly. Variance = (avgIH − avgSt)/avgSt × 100.

**Why:** the `ih_street_variance` table is sparse (populated only per-campus on demand) and its in-memory cache is empty after restart, so anything relying solely on it silently evaluates to false → 0 units. Compute from the latest rent-roll snapshot instead; use the table cache only as a preferred override.
