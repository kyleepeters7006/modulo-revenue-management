---
name: revenue_growth_targets tenancy
description: How to tenant-scope revenue_growth_targets safely; there is no client_id column.
---

# revenue_growth_targets tenant scoping

`revenue_growth_targets` has **no `client_id` column** — it is keyed only by `location_id`
(which is client-owned) + `service_line`. There is **no client-global target concept**
anywhere in the app: AI pricing matches strictly by `locationId === locationId`.

**Rule:** to scope targets to a tenant, INNER JOIN to `locations` and filter
`loc.client_id = $clientId`. Never fall back to `location_id IS NULL` "global" rows.

**Why:** the unique index `(location_id, service_line)` allows *multiple* NULL-location
rows in Postgres (NULLs aren't deduped), and those NULL rows can't be attributed to any
client. A `WHERE loc.client_id = $1 OR rgt.location_id IS NULL` fallback therefore both
leaks cross-tenant data and is nondeterministic (Map keeps whichever row loads last).

**How to apply:** when surfacing a per-row growth target (e.g. in /api/reference-data),
look it up only by the row's own `locationId`; emit `null` when absent.
