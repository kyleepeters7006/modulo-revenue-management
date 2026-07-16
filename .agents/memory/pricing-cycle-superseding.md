---
name: Pricing cycle superseding
description: How Apr/Jul (and future) pricing cycles are prevented from stacking on the same service line
---

## Rule

When rules from multiple effectiveDate months qualify for the same service line, only the **latest cycle's rules** fire. Rules with no effectiveDate always apply.

**Why:** Apr-26 rules were still active alongside Jul-26 rules, causing the same SL units to receive both +5% (Apr) and +2.5% (Jul), which double-counted the impact and over-adjusted rates.

## How to apply

### Rate engine (`adjustmentRulesService.ts` → `applyAdjustmentRulesToUnit`)
Three-pass approach:
1. Pass 1: collect qualifying rules (scope + trigger + action filter checks)
2. Pass 2: among dated (effectiveDate != null) qualifying rules, find the latest month; discard rules from earlier months
3. Pass 3: apply the final filtered rules

Rules with `effectiveDate = null` (ongoing) survive all passes.

### UI (`pricing-controls.tsx` → `PricingCommentaryCard`)
`supersededIds` set is computed from `activeRules`:
- group by `serviceLine` (or `*` for null), find max effectiveDate month per SL
- any rule whose month < max is superseded
`effectiveRules = activeRules.filter(r => !supersededIds.has(r.id))` drives totalAnnualImpact/positiveImpact/negativeImpact.
Superseded rules are shown in Active Rules section (pill: opacity-40 + line-through) and impact dialog (row: opacity-50, label "superseded", strikethrough amount).

### Coverage endpoint
`GET /api/adjustment-rules/:id/coverage` — per-campus qualified impact for a single rule via the shared rule-impact service (trigger conditions + action filters, move-ins-based).

## Notes
- Retiring a cycle = set is_historical=true AND is_active=false; the adj-rules endpoint has a ~2-min cache, so restart the app to see changes.
