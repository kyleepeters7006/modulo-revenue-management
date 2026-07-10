---
name: Reference-data and active-rules performance
description: Both endpoints had N-query anti-patterns that made them slow; this records the fixes.
---

## Active Rules (`/api/adjustment-rules`)

**Problem:** `computeRuleImpact()` was called per rule, each firing 2 DB queries (one `MAX(upload_month)`, one aggregate). With 10 rules = 20 serial DB round trips.

**Fix:** 2 queries total + in-memory computation:
1. `SELECT MAX(upload_month)` once
2. `SELECT location_id, service_line, room_type, street_rate, care_rate, occupied_yn, days_vacant FROM rent_roll_data WHERE client_id=$1 AND upload_month=$2 [AND scope]` once
3. Per-rule impact computed in-memory with JS array filters + `Set` for campusCount
4. Response cached with `getCachedAnalytics` (2-min TTL), keyed by `adj-rules:{clientId}:{locationId}:{serviceLine}:{includeHistorical}`

**Why:** Filter logic (roomType, serviceLine, occupancyStatus, vacancyDuration) is fully expressible in JS — no need for N DB round trips.

## Reference Data (`/api/reference-data`)

**Problem 1:** Three heavy queries (aggRes, inqRes, moveRes) ran sequentially despite being fully independent of each other.

**Fix 1:** Moved all param-building synchronously before queries, then `[aggRes, inqRes, moveRes] = await Promise.all([...])`. Cut wall-clock time by ~3× on first load.

**Problem 2:** `ruleRatesMap` for the per-rule rate columns was built by firing one DB query per active rule (N queries, even if parallel). 

**Fix 2:** Replaced with in-memory computation iterating `aggRes.rows` (spot month only). `avg_street` from aggRes (`mode()` of street_rate) is equivalent to per-unit query since street_rate is uniform per room type. The trigger condition evaluation still works — same `refSlOcc`/`refCampusOcc` maps.

**Note on occupancy filters in ruleRatesMap:** `vacancyDuration` filter cannot be applied from aggregated data (omitted for display rate column only — impact numbers on the Active Rules panel still use the correct in-memory per-unit filter).

## Cache already in place
- `refDataCache` (10-min TTL, keyed by `{clientId, serviceLine, regions, divisions, locations}`) covers reference-data — cached on first compute per filter combo.
- Startup warm pre-fetches the default (unfiltered) view 8s after boot.
