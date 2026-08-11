---
name: Reference Data grouping & rule scope
description: Lessons from adding grouping levels and Create-Rule-from-View to the Reference Data table
---

- **Rule scope from aggregated views**: rows at aggregated grouping levels show "All" for collapsed dimensions. Any feature deriving rule filters from visible rows must map group keys back to the underlying detail rows, or empty scope silently creates portfolio-wide rules.
- **Why:** first implementation collected scope from displayed rows and produced a 1,771-unit portfolio rule for what was a single-campus view.
- **How to apply:** derive scope by matching detail rows via the same group-key function used for aggregation (include locationId in campus keys to avoid same-name collisions).
- **computeRuleImpact filters**: it historically ignored `filters.location` (only roomType/serviceLine applied) — now fixed; any new filter added to rule actions must be wired into BOTH computeRuleImpact SQL and computeRuleElasticityImpact's in-memory filter.
- **Ratio aggregation**: never unit-weight-average derived percentages (e.g. YTD growth) across groups; sum the numerator/denominator components (backend exposes ytdRevSpot/ytdRevBase for this).
- **Room-type name three-way mismatch**: display group_name, groupings source_room_type, and rent_roll_data.room_type can all differ (e.g. group "Studio", source "Studio - Private", rent-roll "Studio Dlx"). Rule filters match unit.room_type, so group expansion MUST include the rent-roll spellings or rules affect 0 units.
- **How to apply:** use the shared expandRoomTypeGroups helper (from-filters + Excel import) — expands group names to sources AND latest-month rent-roll spellings, scoped by the rule's locations/service lines, excluding spellings that also map to other groups within that scope (a flat list can't express per-campus group membership).
