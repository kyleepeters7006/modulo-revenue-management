---
name: room_type_groupings branded names break studio filter
description: room_type_groupings.group_name contains branded names like "Legacy Lane - Studio" that don't match ILIKE 'studio%'. Use rr.room_type directly in the competitive-position endpoint.
---

## Rule
Do NOT use `COALESCE(rtg.group_name, rr.room_type) ILIKE 'studio%'` in the competitive-position endpoint. The `group_name` values in `room_type_groupings` are branded room product names (e.g., "Legacy Lane - Studio") that contain but don't *start with* "studio", so the `ILIKE 'studio%'` filter silently returns no rows.

**Why:** `rr.room_type` is already backfill-normalized to standard names ("Studio", "Studio Dlx", "Companion", etc.). The `room_type_groupings` join is appropriate for the rate-card where groupings map branded → standard for pricing purposes, but in the competitive-position endpoint the normalized `rr.room_type` is sufficient and more reliable.

**How to apply:** In the competitive-position `ourRates` query, filter by `rr.room_type ILIKE 'studio%'` directly — no `room_type_groupings` LEFT JOIN needed. The `our_rate` becomes NULL (chart point disappears) if the join is included because `group_name` overrides the fallback.

**Affected query:** `GET /api/pricing-controls/competitive-position` → ourRates CTE in `server/routes.ts`.
