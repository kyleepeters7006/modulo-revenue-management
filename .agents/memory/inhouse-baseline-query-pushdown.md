---
name: In-house baseline query pushdown
description: Scope rate-baseline view joins by the requested month window and service line in in-house planning queries.
---

Scoped in-house planning reads must push both the requested month range and service line into the `rate_baseline_v` join, while retaining the row's own month correlation. Correlation alone does not constrain the view's aggregate branches, so PostgreSQL can otherwise compute medians across the tenant's full history and every service line.

**Why:** The unscoped historical join made a single three-tier portfolio calculation take roughly two minutes; explicit pushdown reduced the same live grid to roughly 16–22 seconds without changing the gate or solver outputs.

**How to apply:** When adding a planning query that uses `buildRateBaselineJoin`, provide a complete predicate for the view alias's service line and constrain its month column to the query's exact scalar, array, or range window.