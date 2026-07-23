---
name: Rule preview / engine trigger parity
description: Reference Data rule-rate preview must evaluate the same trigger shapes and metric scales as the rule engine.
---
Rule triggers are stored as a `conditions` array with `conditionOperator` (AND/OR); the legacy single `condition` object also exists. Any preview/display code that re-implements trigger evaluation must handle both shapes.

**Why:** The Reference Data preview once evaluated only the legacy single-condition shape, so multi-condition rules (occupancy > 0.9 AND ih_street_variance < 0) skipped their trigger check entirely and rule rates displayed on every row.

**How to apply:** When adding rule-rate previews or new trigger fields, mirror the engine's methodology (adjustmentRulesService): occupancy is a fraction (0-1) in triggers, ih_street_variance is a percent computed occupied-weighted per campus+service line excluding Companion units. Missing metric data fails the condition (matches engine); metrics not computable from aggregated data pass rather than blocking display.
