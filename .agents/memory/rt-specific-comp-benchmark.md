---
name: Room-type-specific competitor benchmark
description: benchmarkForRT added to CompBenchmark; use it instead of benchmarkFor for street_to_comp_var when a room type is known.
---

# Room-type-specific competitor benchmark

## The rule

Always call `compBenchmark.benchmarkForRT(location, sl, roomType)` when evaluating `street_to_comp_var` for a specific room type. Fall back to `benchmarkFor(location, sl)` only when RT-specific data is absent.

**Why:** The SL-level blended benchmark mixes room types of very different price points. For Princeton-117 AL, blending Companion + Studio Dlx + One Bedroom + Two Bedroom gave $5,280 vs the Studio Dlx-specific $4,386. The blended variance was 30.5%; the correct RT-specific variance was 57.1%. Rules targeting Studio Dlx conditions were evaluated against the wrong benchmark, causing incorrect trigger evaluation and wrong Reference Data display.

**How to apply:**
- `CompBenchmark` class (server/services/compBenchmark.ts) now has:
  - `benchmarkForRT(location, sl, roomType)` — tries RT-specific key first, falls back to SL-level
  - `aggregateSurveyRowsByRT(rows)` — builds map keyed `location|||compType|||roomType`
  - `loadCompBenchmark` now SELECTs `room_type` from `competitive_survey_data` and passes the RT map
- `ruleImpactService.ts` `lookupMetric` for `street_to_comp_var_pct` now calls `benchmarkForRT`
- `routes.ts` `compVarMap` is now built from the survey benchmark (not stale `campus_metrics`), keyed by `campus||sl||rt` with SL-level weighted-average fallback at `campus||sl`
- `evalCond` in `buildGroupRulePreviewRates` looks up `campus||sl||rt` key first, then `campus||sl` fallback
