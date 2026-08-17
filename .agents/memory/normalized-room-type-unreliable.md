---
name: rent_roll_data.room_type — fixed normalizer, occupancy-style trap
description: room_type is now re-derived from source_room_type at startup with room-type keywords winning over occupancy style; history of the "-Double"→Companion scramble and the branded group_name trap.
---

# `rent_roll_data.room_type` normalization

Historically the normalizer keyed on **occupancy style**, so any source type containing
"-Double" collapsed into `Companion` and "Studio - Private" became `Studio Dlx`. That is fixed:

- `normalizeRoomType` (shared/roomTypes.ts) now checks explicit room-type keywords
  (companion-explicit → studio deluxe → 2BR → 1BR → studio) BEFORE occupancy-style words;
  bare "double"/"shared" fall through to Companion only when no room-type keyword matches.
- The startup backfill (server/backfillRoomTypes.ts) re-derives `room_type` from
  `source_room_type` in one set-based JSONB-mapping UPDATE (a per-type UPDATE loop took
  tens of minutes on ~600k rows; drizzle cannot bind JS arrays as `text[]` params — ship
  the mapping as a single JSONB parameter instead).

**How to apply:**
- `rr.room_type` is now safe for standard-category filters (e.g. `ILIKE 'studio%'` matches
  Studio + Studio Dlx). `room_type_groupings` remains the source of truth for client-branded
  category names shown in Reference Data.
- Known trap unchanged: `group_name` contains branded values (e.g. "Legacy Lane - Studio"),
  so never prefix-match `ILIKE 'studio%'` on `group_name` — match on the mapping.
- If a new import path writes rent roll rows, it MUST populate `source_room_type`; the
  backfill can only re-derive categories where the raw string was kept.
