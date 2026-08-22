---
name: campus_metrics service-line granularity
description: Which campus_metrics rows carry a service line, which are campus-wide only, and why a service-line filter silently kills a metric.
---

# campus_metrics granularity

Rows in `campus_metrics` are NOT uniformly broken out by service line.

- Per service line **and** campus-wide (NULL): `private_pay_pct`, `total_units`,
  `vacant_units`, `avg_days_vacant`, `days_vacant_group_avg`, `ih_street_var_pct`,
  the occupancy trailing metrics, `medicaid_pct`, `medicare_pct`.
- Campus-wide **only** (every row has `service_line IS NULL`): `inquiry_count`,
  `tour_count`. These come from the CRM, which has no service-line breakdown.
- Service-line specific only: `street_to_comp_var_pct`, `competitor_variance_pct`.

**Rule:** any query loading these metrics must NOT filter `service_line IS NOT NULL`
as a blanket condition. Doing so silently drops the CRM metrics entirely.

Resolve a value most-specific-first: service-line row, then the campus-wide row.
`campusMetricValue()` in the rule impact service is the shared accessor; the AI
suggestion prompt uses an equivalent lookup so the number shown to the model is
the number the engine scores.

**Why:** "inquiry volume" was advertised to the model as a legal trigger metric,
displayed as "unknown" on every campus, and scored as false by the impact
evaluator — three surfaces disagreeing because one WHERE clause excluded the only
rows that exist for it.

**Do not** exempt `street_to_comp_var_pct` into the campus-wide fallback: a
variance blended across AL and HC is not a substitute for either.

## Zero vs absent

`Number(null)` is `0`, and `0` is a legal value for every one of these metrics,
so a SQL NULL that reaches `Number()` becomes an indistinguishable measured zero.
Drop null/undefined before the numeric conversion, never after.

## Unpopulated feeds

A metric can be fully populated and still be meaningless: Trilogy has an
`inquiry_count` row for all 146 campuses and **every value is 0** (the demo client
has real values, which is how this hides). Treat an all-zero feed as unpopulated —
suppress it from the prompt's advertised metric list and say "NOT AVAILABLE …
missing data, NOT an absence of demand", the same convention the move-in pace line
already uses. Printing `0` invites the model to argue for discounting.
