---
name: Adjustment rules tenant scoping
description: The adjustment_rules table is not tenant-scoped; rules are global across all client environments.
---

# Adjustment rules are NOT tenant-scoped

The `adjustment_rules` table has no `client_id` column. Both the read paths
(`getAdjustmentRules` / `getActiveAdjustmentRules`, `GET /api/adjustment-rules`)
and the create path (`POST /api/adjustment-rules`) operate on the full table with
no client filter. A rule created under one client environment (demo / trilogy /
glm / ssmg) is visible and applied for all of them.

**Why:** This is a pre-existing design characteristic of the table, predating the
rules-only pricing pivot. The AI rule-suggestion accept endpoint
(`POST /api/adjustment-rules/suggestions/accept`) was deliberately built to be
indistinguishable from manual rule creation, so it inherits the same behavior
rather than introducing per-tenant scoping unilaterally.

**How to apply:** Do not assume tenant isolation for adjustment rules. If a task
asks for per-client rules, it requires a schema migration (add `client_id` to
`adjustment_rules`), backfill, and filtering across ALL read/exec/create paths —
not just the AI accept endpoint. Treat that as its own task; changing only one
endpoint creates an inconsistent system.
