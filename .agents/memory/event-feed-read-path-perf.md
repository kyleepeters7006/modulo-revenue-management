---
name: Read-time dedup of the event feed was rejected
description: Why duplicate move-in/out imports are resolved by a persisted flag behind a view rather than deduplicated in every read query, and the query shape that made the alternative unusable.
---

# Don't deduplicate the event feed at read time

Duplicate move-in/out imports are resolved by stamping each row with its import
format and a `superseded` flag, then reading through a view. An earlier attempt
did the same work in a shared CTE injected into every read instead. It was
correct and it was abandoned. Do not revive it.

## Why the persisted flag wins

Deciding the winner per campus-month is an aggregate over the whole feed. Done
at read time, every single query — including ones that only want one campus and
one month — pays for a pass over the client's entire history. Done once at
import and stored, a read is an indexed filter on a boolean.

**Why:** the dedup rule is a property of the data, not of any one question
asked about it. Recomputing it per query means the cost scales with the number
of readers, and it puts a subtle correctness rule in the hands of every future
caller who might forget to include the CTE. A view cannot be forgotten.

**How to apply:** if a future correction needs the same "one source wins per
bucket" shape, add a column and a backfill, not a CTE.

## The query trap, if you ever do need this shape

Aggregate-then-join is the natural formulation: group the feed per bucket, pick
the winner, join it back to the rows. It is a trap. The planner cannot estimate
cardinality out of a grouped CTE, guesses one row, and drives an index scan once
per bucket — measured at ~1.2 M heap fetches and 45 s for a single count over
~420 k rows, from a plan whose *estimated* cost looked trivial.

Ranking in place fixes it: one window computes each candidate's tallies over the
bucket-plus-source partition, then `DENSE_RANK()` over the bucket alone orders
the sources by those tallies, so every row of the winning source ties at rank 1.
One scan, two sorts, no join to misplan — the same count drops to ~5 s.

**How to apply:** any time you are about to join a grouped CTE back to its own
base table, rank in place instead.

## Reading a slow query on this table

- Check `pg_stat_activity` first. If nothing is active and a plain `count(*)`
  returns quickly, the database is idle and the query is at fault, not
  contention. Several hours went into "contention" that was a nested loop.
- Conversely, DDL that appears to hang is usually waiting on a backend left
  `idle in transaction` by a killed ad-hoc script. An index build that looked
  like it needed eight minutes finished in five seconds once the stale holders
  were terminated. `DROP INDEX CONCURRENTLY` waits the same way.
- Read *Heap Fetches* and loop counts in `EXPLAIN (ANALYZE, BUFFERS)`, not the
  estimated cost.
- Bulk importers leave this table with no autovacuum history at all
  (`n_live_tup` reading 0 against tens of thousands of dead tuples), so
  estimates are meaningless until `VACUUM (ANALYZE)` has run. It does not
  rescue the join shape above, which is misplanned even with fresh statistics.
- A wide covering index is not the fix. One sized to cover the CTE approached
  the size of the heap, went to zero scans once the join was removed, and was
  dropped.
