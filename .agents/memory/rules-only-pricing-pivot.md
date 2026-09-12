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

## Amendment — LLM prompts are their own surface

Retiring a pricing model means auditing what is put in front of a model, not
just what is served. The AI insights and AI chat prompt builders kept feeding
the Modulo and Revenue-Target AI rates long after both were retired, and the
prompts explicitly asked the model to pick between them — so the product kept
recommending "raise street rates to Modulo" as a headline action even though
nothing downstream could act on it. Prompt context does not show up in any
serving path, type error, or rate query, so it survives a pivot silently.

Two rules for any rate figure placed in a prompt:

- State the pricing model in the prompt and name the retired ones as forbidden,
  in the system prompt AND in the formatting instruction of the second model
  when a two-model chain is used. The returned text comes from the last model.
- Measure uplift on paired populations. Averaging the proposed rate over only
  the covered units and comparing it to the whole-scope street average
  manufactures lift whenever coverage is selective. Compare the covered units'
  proposed average to those same units' street average, and report coverage
  (`n/eligible`) as a separate number. The same applies per room type.

Companion-bed exclusion and the manual-override-first precedence apply to
prompt aggregates exactly as they do to query aggregates; a prompt that skips
them describes a population no other surface reports. Keep the prompt's own
wording in step with this: a heading or preamble claiming rates come from rules
"and nothing else" contradicts its own data the moment overrides are included,
and the model resolves the contradiction however it likes.

A third rule, because a prompt has no schema to catch it:

- Never hand a model a dollar figure without its unit of measure, and never
  blend bases. `HC`/`HC/MC` are per-day and everything else is per-month, so a
  scope spanning both has no meaningful average. Suppress the blended figure —
  own rates, competitor rates and per-unit upside alike — and supply
  per-service-line figures each suffixed `/day` or `/mo` instead. State plainly
  that the average is withheld and why; a silently missing number reads to the
  model as a missing market, which it will then recommend into.

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
