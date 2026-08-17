---
name: Competitor-rate reprocessing operations
description: How to actually make a competitor-matching or room-type fix reach stored data, and why a correct re-run legitimately lowers coverage.
---

# Competitor-rate reprocessing operations

## A normalizer/policy fix does NOT mean the stored data changed

`room_type` is a stored column, and the room-type backfill is fired ~5s after
server boot as an unawaited, fire-and-forget call. Nothing logs a summary and
nothing fails loudly, so a `normalizeRoomType` fix can ship, look correct in
code, and never touch a single row. A whole class of "we already fixed this"
bug reports comes from exactly this.

**Why:** stored `room_type` feeds competitor matching, so a stale column
produces wrong competitor benchmarks even when the survey data *and* the
matching policy are both correct. The scrambled state looked like
`Studio - Private` stored as `Studio Dlx` and `Studio Deluxe - Double` stored
as `Companion`.

**How to apply:** after changing room-type normalization or the matching
policy, run the backfill explicitly and then re-run matching. Verify against
the database, not the code. The backfill is global across all tenants (no
client argument) and idempotent — a second run reports every type as already
normalized.

## Re-running matching legitimately REDUCES coverage — that is not a regression

The shared matching policy has no "any room type at this location" fallback,
and Companion in the AL lines never falls back to a private-room rate. Older
stored values were produced under a permissive mapping, so a correct re-run
turns some of them into NULL.

Before calling those losses a bug, check the three benign causes:

1. **No survey row of that room type exists** for the location's survey type.
   Villa units at a location whose only villa row is a Two Bedroom, or AL
   Companion units at a location with only Studio/One Bedroom rows, correctly
   get nothing.
2. **The implausibility guard cleared it** — the old value was absurd
   (six/seven-figure monthly rates exist in the survey data).
3. **The survey-type chain does not reach the type you expect.** `AL/MC` is
   `['AL/MC','AL']` and deliberately excludes `SMC`, because SMC is a
   daily-basis type and mixing it into a monthly line inflates rates ~30x.

**How to apply:** snapshot the competitor columns into a scratch table before a
re-run and diff lost/gained/changed afterwards, grouped by service line and
room type. Confirm `old_rt = new_rt` in the loss groups — if the room type did
not change, the backfill is not the cause.

## The guard only rejects rates that are too HIGH

Plausibility is a max-only check, so daily rates mis-entered under a monthly
survey type (AL/AL-MC rows in the $75–$285 range) sail through and surface as
a "monthly" competitor rate. Suspect this whenever a monthly comp rate is
implausibly small rather than implausibly large.

## Long re-runs must be resumable, not backgrounded

Background processes are reaped when the shell call that spawned them ends —
both `nohup` and `setsid` get killed partway with no OOM and no error in the
log. Prefer the batch job that loads survey data into memory once and persists
a cursor, so an interrupted run resumes instead of restarting; the per-unit
path that issues a query and a serial UPDATE per unit is also roughly an order
of magnitude slower.

**Why:** two workers can now reach the same job (the CLI runner resumes any job
left `running`, and the server resumes interrupted jobs on boot), so the job
takes a session-scoped Postgres advisory lock and a duplicate run is a no-op.
