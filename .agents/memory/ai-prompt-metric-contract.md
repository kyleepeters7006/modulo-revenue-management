---
name: AI suggestion prompt / parser / engine metric contract
description: Why the prompt's advertised trigger metrics are generated from a catalog, and the three-way contract any new metric must satisfy.
---

# The three-way metric contract

A trigger metric offered to the AI rule suggester must satisfy **three**
independent things, and nothing raises when one is missing:

1. The prompt advertises the phrase.
2. `METRIC_TO_FIELD` in the natural-language parser maps that phrase to a field.
3. **Both** scorers handle the field: `evalGroupCondition` (impact preview) and
   the live pricing engine.

Break any link and the rule still parses, is still proposed, is still accepted,
and then affects zero units with no error on any surface. `total_units` was the
worst case — it parses cleanly and is scored by *neither* engine.

**How to apply:** the advertised list is generated from a metric catalog module,
not hand-written in the prompt string, and a parity test walks every catalog
entry — parsing its sample phrase inside a full rule sentence, asserting the
declared field, and asserting that field is in the scoreable set. Add a metric to
the catalog and the test tells you which of the three links you forgot.

## Traps that cost real time

- **An alias containing " and " / " or " is unreachable.** The compound-trigger
  splitter breaks the sentence on the conjunction before the alias table is
  consulted. `inquiry and tour volume` was advertised for a long time and could
  never once have matched. The parity test asserts no sample phrase contains one.
- **Advertising a phrase you have not probed is the failure mode, not a shortcut.**
  Several long-advertised phrases (`vacant units`, `total units`, `inquiry volume`)
  did not parse at all.
- **Do not advertise a campus-scoped rule.** The parser's location-filter regex
  uses `[\w\s]+?`, which cannot match the hyphens and digits in real campus names
  (`Albany - 215`, `Ashland KOA-0554`), so `at <name>` captures a fragment or
  nothing and the scope silently vanishes. Conditions are evaluated per campus
  anyway, so the *threshold* is how a campus gets selected — steer the model that
  way instead.
- Keep an alias in `METRIC_TO_FIELD` even when you stop advertising a metric, or
  pre-existing rules that use it stop parsing.

## Prompt figures must share one basis

Every occupancy number in the prompt has to come from the same source. Room-type
spot occupancy was read from the rent roll while the trailing figures beside it
came from occupancy history; the two disagree materially, so a line read
"75.5% occupied (T3 92.8%)" — a fabricated double-digit collapse. Occupancy
history is authoritative; the rent roll is a fallback only.

Verified empirically: summing occupied/available components over one global month
list matches the engine's per-group trailing map exactly (435 groups, 0
divergences), because this client's service lines are atomic (`AL/MC` is one
token, not a comma-combined string). If comma-combined rows ever appear, the
engine assigns the *full* row to every token while other surfaces split by
weight — re-check parity then.
