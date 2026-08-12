---
name: days_vacant trigger semantics
description: days_vacant in rule triggers has two distinct evaluation modes depending on trigger format; wrong mode causes unit count to be 4 instead of 7.
---

## The rule

`days_vacant` in a trigger condition means different things depending on whether the trigger uses the singular `condition` object (legacy) or the `conditions` array (new format):

- **`conditions` array format** → `days_vacant` is a **group-level gate** evaluated as the average across all units in the `locId|sl|rt` group. When the average exceeds the threshold, **all** units in the group are affected.
- **`condition` singular format** → `days_vacant` is a **per-unit filter** applied in `unitPasses()` to keep only individually-vacant units.

**Why:** The description "average days vacant > 30 days" is group intent — fire on all units when the group average exceeds 30. The old code always deferred `days_vacant` to per-unit evaluation, cutting a 7-unit result to 4 (only the individually-vacant ones).

**How to apply:**

In `evalGroupCondition` (ruleImpactService.ts), `days_vacant` now computes `dvSum/dvN` from the RT-level GroupAgg and evaluates the group average. `dvSum`/`dvN` are accumulated in `bump()` for every unit (including B-beds).

In `unitPasses`, per-unit days_vacant filtering is **skipped** when `Array.isArray(trigger.conditions)` is true (the new format). Only the legacy singular `condition` format still filters per unit.

When authoring or updating triggers: use the `conditions` array format whenever the intent is "apply to all units in group when average exceeds threshold." Use singular `condition` when the intent is "only target individually-vacant units."
