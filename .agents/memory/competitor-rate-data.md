---
name: Competitor rate data locations
description: Where competitor rates, care-level costs, and med-mgmt fees actually live, and how analytics caching hides DB changes
---

# Competitor / care-cost data locations

- The `competitors` table is **empty** in practice — it is NOT the source of competitor rates. The real source is `competitive_survey_data` (imported survey rows, keyed by `survey_month`, `keystats_location`, `competitor_type`, `room_type`).
- Trilogy-side level-of-care cost lives in `care_level_rates.level2_rate` (per location + service line).
- Competitor numbers used by pricing are snapshotted onto `rent_roll_data` as derived columns: `competitor_rate`, `competitor_base_rate`, `competitor_final_rate`, `competitor_avg_care_rate`, `competitor_care_level2_adjustment`, `competitor_med_management_adjustment`. Relationship: `final = base + careLevel2Adj + medMgmtAdj` (see `server/services/competitorAdjustments.ts`). A uniform multiplier on base + both adjustments keeps `final` consistent.
- `competitive_survey_data.medication_management_fee` contains large outliers (six-figure bad imports); the analytics endpoint guards/drops them, so don't assume the averages are clean.

**Why:** A bulk "+X% annual increase" on competitor data must touch `competitive_survey_data` + `care_level_rates` + the `rent_roll_data` snapshot columns together, or the displayed/pricing numbers and the survey source drift apart.

**How to apply:** After mutating these tables directly via SQL, **restart the `Start application` workflow** — `/api/analytics/campus-metrics` caches results in-memory (logs "Serving cached result for campus-metrics:...") and will keep serving pre-change values until the process restarts.
