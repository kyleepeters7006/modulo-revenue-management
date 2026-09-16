---
name: Adjustment rules tenant scoping
description: adjustment_rules now HAS a client_id column, but active rules remain global; only historical location-less strategy records are client-scoped.
---

# Adjustment rules tenant scoping (partial)

The `adjustment_rules` table now has a `client_id` column (added by an idempotent
startup migration). Scoping is intentionally partial:

- **Active rules remain global** (client_id NULL) — read/exec/create paths
  (`getAdjustmentRules`, `GET/POST /api/adjustment-rules`) still operate with no
  client filter. A rule created under one client environment applies to all.
- **Historical location-less strategy records ARE client-scoped** — portfolio-wide
  imported strategies (no location link) carry client_id (backfilled 'trilogy' for
  legacy rows) so Pricing History endpoints can prevent cross-tenant visibility.

**Why:** Full tenant isolation of active rules would require filtering across ALL
read/exec/create paths at once; only the history-visibility problem has been fixed.

**How to apply:** Do not assume active-rule tenant isolation. If a task needs
per-client active rules, add filtering to every read/exec/create path in one task —
changing a single endpoint creates an inconsistent system.

## Mutation ownership for legacy global rules

Mutation endpoints must treat both of these as visible global rules:

- `client_id IS NULL AND location_id IS NULL`
- `client_id IS NULL` with a location owned by the current client

The ownership predicate must explicitly allow `location_id IS NULL`; otherwise a
legacy portfolio-wide rule can appear in Rule Administration but return “Rule not
found” when an admin tries to edit, toggle, implement, stack, or delete it.

**Why:** Active rules are intentionally global today, so mutation authorization
cannot use a narrower location-only legacy predicate than the list and execution
paths.

**How to apply:** Keep the global-rule exception aligned across every
`adjustment_rules` mutation route while active rules remain globally scoped.
