---
name: Reference Data aggregation keying
description: Why campus rollups in /api/reference-data must key on location_id, not campus name
---

# Reference Data campus identity

In `GET /api/reference-data` (server/routes.ts), aggregate/rollup maps
(`comboMap`, `campusOcc`, `slOcc`) must key on a stable
`campusKey = ${location_id}||${division}||${campus}`, NOT the campus name alone.

**Why:** Same-named campuses exist across divisions/imports. Keying on name
alone silently merges distinct campuses into one row (caught in architect review).

**How to apply:** Any new rollup dimension derived from rent_roll_data should
build the same campusKey. Exception: `inquiry_metrics` only stores location
*name* (no location_id), so inquiry/tour lookups are still name-keyed and can
theoretically collide — accept this limitation unless inquiry_metrics gains a
location_id column.
