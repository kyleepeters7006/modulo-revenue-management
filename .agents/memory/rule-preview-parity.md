---
name: Rule preview / engine trigger parity
description: Keeping applyAdjustmentRulesToUnit (live) and ruleImpactService (preview) in agreement on trigger evaluation.
---

# Rule preview / engine trigger parity

Triggers are a `conditions[]` array (AND/OR) or a singular `condition`; both evaluators must handle both shapes and use the same metric scales (occupancy thresholds stored as fractions 0.90 must be ×100 to match 0–100 campus metrics — every occupancy branch, current-spot AND trailing).

**Metric sources must match too, not just scales.** The live engine reads `campus_metrics` (recomputed at run time by `recalculateAndPreloadCampusMetrics`); the preview computes from the rent-roll snapshot in `buildRuleImpactContext.lookupMetric`. Divergences found & fixed (Aug 2026):
- `street_to_comp_var` at RT level: live computed RT street avg vs the SL-level survey benchmark; preview uses `benchmarkForRT` with SL fallback. Live now uses RT benchmark first.
- When no survey benchmark exists (e.g. demo client), preview falls back to paired rent-roll `competitor_final_rate`; live had no fallback → gate read null → rule silently matched nothing. Live now mirrors the pairs fallback.
- `ih_street_variance`: live consulted the SL-level table cache first; preview is RT-first from fresh metrics. Live now prefers the fresh RT-first campus metric, table cache is fallback only.

**Count-comparison gotchas** when reconciling live vs preview per-rule unit counts:
- Preview `affectedUnits` excludes B-bed companion rows (`isBBedRow`) by design; live prices them. Compare on B-bed-excluded basis.
- Live stacks same-specificity rules on one unit (`appliedRuleName` joined with " + "); preview claims each unit for one rule.
- Live applies latest-cycle-wins superseding across effective-date months; preview counts each rule in isolation (UI crosses out superseded ones).

**How to apply:** any change to a trigger field's evaluation must be made in BOTH `server/services/adjustmentRulesService.ts` (evaluateSingleCondition + recalculateAndPreloadCampusMetrics) and `server/services/ruleImpactService.ts` (evalGroupCondition + lookupMetric). `scripts/verify-rule-parity.ts` runs a gross per-rule live-vs-preview count comparison for all active rules across clients.

**Effective-date gate:** `storage.getActiveAdjustmentRules` excludes rules with a future `effective_date`; a repricing run before that date correctly leaves rule columns NULL no matter what the preview shows. Scheduled rules take effect only via a repricing run on/after their effective date.
