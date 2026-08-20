---
name: Rate outlier gate lives in a database view
description: Why the street/IH rate outlier baselines are a VIEW rather than per-query SQL, and the rules callers must follow.
---

The two-level rate outlier gate is defined **once**, as the database view
`rate_baseline_v`, created idempotently at boot. Every surface that averages
street or in-house rates joins that view and applies the shared gate
predicates. There is exactly one JS twin, which reads its baselines from the
same view rather than recomputing them.

**Why:** when each query built its own baseline CTE, the level-2 (portfolio)
population silently inherited that query's filters. Filtering a page to one
campus collapsed the portfolio yardstick onto that same campus and disabled
level 2 — precisely when a user drilled in. That identical bug was found and
fixed independently in three separately written copies before the view existed,
which is the signal that per-query construction was the wrong shape. A view
cannot have the bug: baselines are defined over the whole table and no caller
can narrow them.

**How to apply:**
- Call sites choose which rows to *report*, never which rows define "normal".
- Never recompute a median baseline inline. If JS needs one, read it from the
  view; a hand-written twin will drift.
- Always join with an explicit client **and** month qual so the predicates push
  down into the view's aggregation. Correlating only on the row's own
  `upload_month` does not push down and makes Postgres compute medians for
  every month of that client.
- The join is LEFT and both gates are permissive when the baseline is NULL:
  suppress only rates provably implausible, never rates that cannot be judged.
- A plain view is fast enough at this data size; materialization is not needed.
- A group whose every row is gated out is reported as ABSENT, not as a number.
  Blank beats plausible-but-false. Those blanks are surfaced to admins in the
  street-rate quality report so the source data gets fixed.
