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

## rent_roll_data.location_id is frequently NULL — join locations by name

Many `rent_roll_data` rows have NULL `location_id` (e.g. trilogy Avon-5166: 2680
of 3112 rows unlinked). Joining `locations` on `loc.id = rr.location_id` drops
division for those rows and splits one campus into two rows (blank-division dup).

**Fix/convention:** Join `locations loc ON loc.client_id = rr.client_id AND
loc.name = rr.location` and treat `loc.id` as the canonical location identity.
Safe because location names are unique per client (no DB constraint enforces this
yet — verify before relying on it). A few campuses have genuinely NULL
`locations.division`, so some blanks are unavoidable source-data gaps.

**Also:** reference-data drops rows with totalUnits===0 (no units in trailing 3
months) to hide stale/all-blank combos.
