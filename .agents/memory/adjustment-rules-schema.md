---
name: Adjustment rules schema notes
description: Columns adjustment_rules does and does not have, casing traps, and why execution_count must not be read as "this rule affects nothing".
---

# adjustment_rules schema notes

- There are **no** `affected_units` or `affected_campuses` columns. Coverage has to be computed,
  not selected.
- Impact columns are `monthly_impact`, `annual_impact` and `volume_adjusted_annual_impact`.
- Rows read through `pool.query` come back **snake_case**; the same rows read through the ORM /
  storage layer are camelCase. Mapping between the two is a recurring source of silently
  undefined fields — `computeQualifiedRuleImpact` and friends expect the camelCase shape.
- `trigger` is a conditions array (see the days-vacant and preview-parity notes for how its two
  shapes differ); `action.filters` is what the engine enforces per unit.

## execution_count is not a usage signal

`execution_count` and the impact columns are frequently `0` on rules that are demonstrably
applied to live units. Do **not** treat `execution_count = 0` as "this rule is dormant and safe
to delete".

**Why:** a rule showing `execution_count = 0, monthly_impact = 0` turned out to own the
`rule_adjusted_rate` on dozens of rent-roll rows. Deleting it on that basis stranded those rows
with a dangling `applied_rule_name` and a served rate from a rule that no longer existed.

**How to apply:** check `rent_roll_data.applied_rule_name` (matched by rule **name**, not id)
for real usage before deleting or disabling. See
[rule-description-filter-mismatch.md](rule-description-filter-mismatch.md) for the full
deletion checklist, including the reprice that a direct SQL delete skips.
