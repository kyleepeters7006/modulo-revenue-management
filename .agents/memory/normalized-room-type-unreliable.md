---
name: rent_roll_data.room_type is unreliable — use source_room_type + groupings
description: The room-type normalization backfill keyed off occupancy style, so "-Double" source types collapsed into Companion; only room_type_groupings is trustworthy.
---

# `rent_roll_data.room_type` is unreliable

The startup room-type normalization backfill mapped on **occupancy style**, not room type.
Any source type whose name contains "-Double" collapsed into `Companion`, and some private
studios were relabelled as deluxe. Observed at a campus where the real inventory was
Companion / One BR / Studio / Studio Deluxe:

| `source_room_type` | normalized `room_type` | correct (`group_name`) |
|---|---|---|
| One BR Apt-Double | Companion | One BR |
| Studio Deluxe - Double | Companion | Studio Deluxe |
| Studio - Private | Studio Dlx | Studio |

**Why:** `room_type_groupings` (`source_room_type` → `group_name`, keyed by client + location +
service line) is maintained from the client's own inventory and is correct. The normalized
column was a convenience backfill and was never reconciled against it. Reference Data resolves
through the groupings and therefore reports correct unit counts and rates; surfaces that read
`rr.room_type` directly do not.

**How to apply:**
- Treat `source_room_type` joined to `room_type_groupings` as the source of truth for room type.
  Reach for `rr.room_type` only when you have confirmed it is right for that campus.
- A `room_type ILIKE 'studio%'` style filter is doubly unsafe: it can match a mislabelled type
  and miss a genuine one. It may still return plausible-looking rows, so a passing spot check
  on one campus proves nothing.
- Known trap when switching to groupings: `group_name` contains branded values (e.g.
  "Legacy Lane - Studio"), so a naive `ILIKE 'studio%'` on `group_name` fails differently.
  Match on the mapping, not on a name prefix.
