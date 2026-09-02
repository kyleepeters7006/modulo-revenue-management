---
name: Rule-adjusted rate base, and why client-side replays fail
description: Street Rate is the rule engine base; explains why no UI may re-derive a saved multi-rule result in the browser.
---

## Street Rate is the rule base

Street-rate adjustment rules start from the unit's published Street Rate. The retired
Modulo suggestion is analysis-only and must never feed a rule calculation. The engine
rounds at every stacked step and finally clamps the result against guardrails measured
against the same Street Rate.

A unit with Street Rate 2,819 and one +1% rule therefore produces 2,847 before
guardrails. It must not inherit a lower legacy Modulo suggestion.

**Why:** users define rules as Street Rate changes. Using the legacy Modulo suggestion
made positive rules appear as net decreases and contradicted the rule designer's impact
calculation.

**How to apply:** every live rule-execution path must pass Street Rate as the initial
rate. Modulo remains available for analysis/comparison only.

## Never replay the rule chain client-side

There is **no persisted per-unit rule chain**. All that survives a pricing run is
`rule_adjusted_rate`, `applied_rule_name` (contributing rule names joined with `" + "`, in
application order) and `rule_rate_calculated_at`. `adjustment_rule_log` is aggregate, not
per-unit.

A browser replay therefore cannot reproduce specificity-tier suppression, latest-cycle
superseding, exclusive-vs-additive stacking, per-step rounding or the guardrail clamp.

**Why:** a dialog once replayed the chain from the street rate and warned "Rules have
changed since this rate was calculated" whenever its own result disagreed with the saved
rate. It disagreed on ~100% of units — 400/400 in one sample, in *both* directions — so the
warning was pure noise that users read as a real error.

**How to apply:** report saved values; do not recompute. If a per-rule breakdown with
intermediate dollar amounts is ever genuinely required, persist the chain server-side
during the pricing run rather than reconstructing it in the client.

## Staleness signals that actually work

- `adjustment_rules.updated_at` is **useless** as an "a human edited this rule" signal —
  impact-stat writes churn it. Comparing it against `rule_rate_calculated_at` flagged 642
  of 653 units as stale.
- The engine records applied rules by **name, not id**, and names are unique per scope
  rather than globally. Matching a name back to a live rule is best-effort: a name can
  match zero rules (deleted/renamed) or several (ambiguous).
- What can be stated with confidence: an applied rule that no longer exists, or that is now
  `isActive === false`. Evaluate these only after the rules query has genuinely succeeded —
  treating a failed fetch as an empty list turns any API/auth blip into a confident
  "all your rules were deleted" warning.
