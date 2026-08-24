---
name: Measuring resident turnover from history
description: Why measured turnover must be carefully scoped by line, and the many traps between the event table and occupancy history.
---

## Rule
Turnover measurement has **two distinct scoping regimes** — HC/HC-MC vs every other line — and
one payer-neutral exclusion that applies to all lines.

### HC and HC/MC: full private-pay scope on both sides
Numerator = private-pay move-outs; denominator = occ_units × private-pay share from rent roll.
Without this, tens of thousands of Medicare/Managed Care short-stay rehab discharges push HC past
4,500%/yr all-payer. Even private-pay-only HC lands ~540%, above the model limit.

### All other lines (AL, AL/MC, SL, VIL): unit-turnover basis
Numerator = all move-outs **except bedholds and companion (2nd-occupant) events**.
Denominator = raw `occ_units` from occupancy history (no payer-share scaling).

**Why the different regime:**
- AL, AL/MC, SL, VIL have negligible external-payer volume, so the payer filter adds noise
  without removing much signal.
- The payer-share approximation understates denominator precision for those lines anyway.
- "BEDHOLD" events (payer ILIKE '%BEDHOLD%') are temporary absences where the bed is held and the
  resident returns — no new street-rate resident moved in, so they must not count as turnover.
  In one trailing-year window, AL had 688 bedholds out of ~5,400 events — a 13% inflation.
- "2ND OCCUPANT" companion events (payer ILIKE '%2ND OCCUPANT%') are B-bed companion departures,
  not primary-unit turnovers; the room stays occupied by the other resident.

**Why:** All-payer HC reads ~943%/yr; raw AL reads ~153%. Both numbers are real in the data but
wrong as planning inputs because neither represents the replacement-at-street-rate event the
solver models.

**AL's 153% had two independent causes, and fixing one hides the other.** Bedholds were ~13% of
it; the rest was the same discharge stored twice by two overlapping imports (see Feed traps).
De-duplication alone takes AL to ~57%, bedhold exclusion on top takes it to ~40%. When a number is
this far out, do not stop at the first sufficient explanation — a plausible result after one fix
is not evidence the other cause is absent.

### Current portfolio readings (post-dedup, post-bedhold, private-pay HC basis)
AL 40%, AL/MC 39%, SL 31%, VIL 23%, HC/MC 82%, HC 281%. Only HC remains out of band, and its
residue is private-pay short-stay rehab rather than a counting defect.

### LOS is the sanity-check lever
`losMonths = 1200 / turnoverPct` (12 months × 100 / pct). Show it beside every turnover figure
so operators can spot-check against their intuition. AL at 153% implies ≈ 7.8 mo avg stay, which
any operator will immediately flag as implausible. The LOS is also shown in the out-of-band
commentary so the band explanation is grounded in concrete stay-length language.

## Denominator construction
`occ_units` from `room_type_occupancy_history` is the authoritative occupancy level.
`rent_roll_data.occupied_yn` over-counts (B beds, companion rows) and must NEVER be used as the
occupancy level — only for deriving the private-pay share for HC/HC-MC.
Pair numerator and denominator month-by-month before averaging; a campus with lagging history
would otherwise divide a full year of events by a partial-year average and report it as 12-month.

## Feed traps
- **Partial trailing month.** Feed lands days into the new month with a fraction of its events.
  Treat any feed that stops before the 28th as not having finished its month.
- **Two service-line vocabularies.** Event feed emits `IL`; occupancy uses `VIL`. Fold at read.
- **HC/MC has occupancy but the event feed never emits it.** Its discharges arrive under `HC`
  unless the department column is used to re-route them. Zero move-outs against real occupancy is
  the quiet failure: nothing errors, the page silently falls back to a saved assumption.
- **Two overlapping imports store the same discharge twice.** An older numeric-department feed
  (`01-HCC`, `02-AL`, `03-VIL`, `24-A/I`) sits under a newer "Export" text feed (`HC`, `AL`, `SL`,
  `IL`, plus the `* Legacy` memory-care neighbourhoods). The Export feed wins: it reaches every
  month the older one does, starts a year earlier, and is the only vocabulary that separates
  memory care from its parent building. Decide precedence **per campus-month** — a small tail of
  campus-months is reported by the older feed alone and would vanish if it were dropped wholesale.
  Build the coverage set ignoring the `counted` flag: a month of nothing but hospital leaves is
  still a month that feed covered. Full detail in
  [Event service line comes from the department](event-service-line-from-dept.md).
- **AL/MC once read ~14% portfolio-wide but ~62% at the campuses that filed it.** Root cause was
  the Export feed's memory-care department not being mapped, so those discharges counted as AL.
  Resolved. The generalisable signal remains: when a parent line reads high and its sub-line reads
  low, suspect one anomaly, not two.

## Plausibility bands
Per-service-line, not a single portfolio-wide ceiling. A single 100% ceiling accepted AL/MC at
14% (7-year memory-care stay) while flagging HC readings that are normal for that line.
Bands live in `shared/turnoverBounds.ts` — read them there rather than from this note, which has
already drifted once. They were set with bedholds EXCLUDED and the feeds DE-DUPLICATED; do not
re-calibrate against a raw number that still contains either.

## Verify provenance, not just magnitude
A band check only catches a figure that looks wrong. The worse failure is a line reporting a
believable number built from **someone else's discharges** — AL/MC's 14% was a different service
line's move-outs over AL/MC's occupancy, and it sat comfortably under every ceiling. Every event
carries the room it happened in and the rent roll says which line owns that room, so assert that a
line's discharges occurred in rooms it actually carries (a strong majority, not unanimity — rooms
get reassigned between lines over time). That check is independent of the department vocabulary
that produced the row, so it survives import-format changes a mapping assertion would not.

Pair it with the reverse shape: a line reporting **0 move-outs against real occupancy**. Nothing
errors, the denominator is right, and the page quietly falls back to a saved assumption while
implying it measured something. Assert both against every line, not just the one being fixed.
