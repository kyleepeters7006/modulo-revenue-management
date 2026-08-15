---
name: Rule-adjusted rate persistence
description: Why rule_adjusted_rate silently ends up NULL across the whole rent roll — two independent causes that must both stay fixed.
---

# Rule-adjusted rate persistence

## 1. The bulk rate writer must preserve columns it wasn't given

The bulk Modulo rate writer builds a CASE-per-row UPDATE. Its `ELSE` branch only protects
rows *outside* the batch, so a `WHEN id = X THEN NULL` arm actively clears the column for
every row the batch touches.

The distinction that matters:
- `undefined` = "this caller does not compute rule rates" -> preserve the existing value.
- `null` = "rules ran and none matched this unit" -> clear it.

Coercing `undefined` to `null` means any Modulo-only caller wipes the rule rates a
rules-aware caller just wrote.

**Why:** two pricing paths write through the same bulk function but only one evaluates
rules, so the writer must tolerate partial payloads.

**How to apply:** any new column on this writer needs the same preserve-on-undefined
treatment, or existing callers will silently null it. Only stamp a "calculated at"
timestamp when the batch actually carried that kind of data.

## 2. There are two rival pricing-generation paths and the names mislead

The plainly-named "generate modulo" endpoint is the **rules-aware** one. The endpoint
named "...-optimized" is the newer background-job path and originally evaluated **no**
adjustment rules at all. The main Rate Card button calls the background job, so in
practice the rule-wiping path won.

**Why:** the background job was added later for large-dataset performance and the rules
step was never ported across.

**How to apply:** when changing rule evaluation, update *both* paths, and check which one
the UI actually calls before concluding a rule "doesn't work". When merging rule results
back onto units, match **by unit id, not array index** — a failed batch returns an empty
array and silently shifts every subsequent index.
