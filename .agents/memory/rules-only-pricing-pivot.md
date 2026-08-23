---
name: Rules-only pricing pivot
description: The single served "proposed rate" is the rule-adjusted rate; Modulo and Revenue-Target AI rates were retired as the proposed rate.
---

# Rules-only pricing pivot

The served/proposed rate is now driven solely by adjustment rules
(`rule_adjusted_rate` on `rent_roll_data`). When no rule applies, the proposed
rate is null — it does NOT fall back to the Modulo algorithm rate.

Key consequences:
- reference-data `avg_proposed` uses `AVG(rule_adjusted_rate) FILTER (WHERE
  rule_adjusted_rate > 0)` — no COALESCE to the Modulo rate.
- rate-card summary exposes `averageRuleRate` (from `ruleAdjustedRate`); the old
  `averageAiRate` is kept in the response shape but set to null. `averageModuloRate`
  is still computed for reference/comparison, not as the served rate.
- `POST /api/pricing/generate-ai` (Revenue-Target AI rate) is deprecated — returns
  HTTP 410 and no longer computes or persists `aiSuggestedRate`.
- accept-suggestions supports `suggestionType === 'rule'` → applies `ruleAdjustedRate`.

**Why:** Product decision to make rules the single source of truth for proposed
pricing, removing the confusing multi-rate model (Modulo rate, Revenue-Target AI
rate, Rules rate all competing).

**How to apply:** When surfacing a proposed/served rate anywhere, read the rule
rate and allow null. Do not reintroduce a Modulo fallback for the served rate.
The Modulo algorithm still exists for analysis/comparison, just not as the served
proposed rate.

## Amendment — applied annual in-house increases

"Rules-only" no longer holds for occupied rooms. An applied in-house increase
plan now takes over the Final rate for the residents it covers, so the
precedence is: manual override → applied increase → rule rate → rule preview.

This is a deliberate narrowing, not a reversal: a rule sets the STREET rate a
new move-in pays, while an increase sets the IN-HOUSE rate a sitting resident
pays. They are different quantities and the Modulo fallback is still gone. See
[Annual increase columns in Reference Data](refdata-annual-increase.md) — in
particular, the move-in-based Revenue Impact must keep using the rule rate even
where Final shows the increase.
