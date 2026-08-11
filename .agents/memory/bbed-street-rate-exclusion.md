---
name: B-bed street-rate exclusion
description: Companion (B-bed) rows must be excluded from street-rate aggregations for senior housing SLs; shared predicate lives in shared/bBed.ts.
---

**Rule:** Every street-rate aggregation (averages, mode baselines, comparative gaps) must exclude companion B-bed rows for senior housing SLs (AL, AL/MC, SL, VIL). HC and HC/MC keep every bed row (each bed is a separate billable resident). Use `isBBedRow` from `shared/bBed.ts` in JS; mirror the SQL predicate `NOT (service_line IN ('AL','AL/MC','SL','VIL') AND room_number ~* '/[B-Zb-z]$')` as a FILTER/CASE on the aggregate.

**Critical:** The correct regex is `/\/[B-Zb-z]$/` (JS) / `~* '/[B-Zb-z]$'` (SQL) — only non-A letter suffixes are excluded. The `/A` suffix is the *primary* bed and must be **included**. The old regex `/\/[A-Za-z]+$/` incorrectly excluded `/A` beds too, causing locations like Princeton (where every unit is `401/A`, `402/A`, etc.) to return `AVG = NULL → $0` in the pricing chart.

**Why:** B-bed companion rates are lower and double-count one physical room, dragging averages down. Code review repeatedly rejected partial fixes: comparative metrics (e.g. competitor gap, avgDifference, counts) must apply the exclusion to *both sides and the denominator* so populations match.

**How to apply:** Any new query or JS reduction touching `street_rate` averages must include the predicate; unit-level detail views (Rate Card rows, rent roll tables) are untouched. In-house/care-rate averages are a separate concern (see proposed follow-up work).
