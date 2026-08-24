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

**Why:** All-payer HC reads ~943%/yr; bedholds-included AL reads ~153%. Both numbers are real in
the data but wrong as planning inputs because neither represents the replacement-at-street-rate
event the solver models.

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
- **AL/MC reads ~14% portfolio-wide but ~62% among the 13 campuses that file it.** The gap is
  discharges filed under AL by campuses that do not use the AL/MC service-line code. Warn in the
  UI when AL reads high and AL/MC reads low — the two anomalies are the same root cause.

## Plausibility bands
Per-service-line, not a single portfolio-wide ceiling. A single 100% ceiling accepted AL/MC at
14% (7-year memory-care stay) while flagging HC readings that are normal for that line.
Bands: VIL 10-50, SL 15-65, AL 30-85, AL/MC 35-95, HC 60-100, HC/MC 40-100.
These were set with bedholds EXCLUDED from the measurement; do not re-calibrate against
bedhold-included numbers.
