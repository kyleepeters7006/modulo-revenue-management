---
name: Rule-adjusted rate base, and why client-side replays fail
description: What the pricing engine actually does between the street rate and the served rule-adjusted rate, and why no UI may re-derive it in the browser.
---

## The rule-adjusted rate is NOT street rate × rule adjustment

The engine applies adjustment rules to `moduloSuggestedRate ?? streetRate` — the retired
signal/modulo calculation is still alive as the **base** the rules multiply, even though it
was retired as the served proposed rate. It then rounds at *every* step and finally clamps
the result against guardrails (defaults: min −5%, max +15%) measured against the street rate.

So a unit with a single "+5%" rule routinely does not show +5% off its street rate:
street 314 → modulo base 333 → ×1.05 → **350** (+11.5% vs street), and it can even land
*below* the street rate when the modulo base is lower.

**Why:** three separate transformations sit between the two numbers (different base,
per-step rounding, guardrail clamp), and only the endpoints are persisted.

**How to apply:** any surface that explains a served rate must display the engine's own
saved numbers. If it needs to show arithmetic that reconciles, it must show the base rate
the rules actually applied to — the street rate will not add up.

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
