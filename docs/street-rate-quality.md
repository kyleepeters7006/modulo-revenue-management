# Street-rate data quality: findings and rules

Investigation of the sub-plausible street rates in the 2026-07 rent roll (task
context: campuses looking artificially cheap in street-rate averages).

## Three populations, only one defect

### 1. Goshen SL - 2184 — daily rates loaded for 2026-06 and 2026-07 (defect, corrected)
All 103 senior-housing rows (92 AL + 11 AL/MC) for those two months were exactly
1/30th of the same room's 2026-05 rate (verified per-room: 102 of 103 rooms with a
May counterpart had a precise 30.00 ratio). The export carried **daily** instead of
monthly rates. HC rows at the same campus were unaffected (HC street rates are
natively daily).

**Correction applied:** original upload files are not persisted anywhere (both
import paths parse in-memory buffers only), so a re-import was impossible. The
affected rows (AL/AL-MC, street_rate 0–500, those two months) were multiplied ×30
in place, restoring each room's June/July repricing on a monthly basis. Verified
against the 2026-05 baseline: AL avg $3,893 (May) → $3,941 (Jun) → $4,017 (Jul).

### 2. Chronic scattered low rows — prorated move-ins (NOT corrupt)
Every 2026-07 row whose street rate collapsed ≥8× vs its own June rate (57 rows,
after excluding Goshen, second-occupant rows, and HC lines) has a **move-in date
inside July** and `street_rate == in_house_rate`. The source export overwrites the
street rate with the resident's prorated first-month charge in the move-in month.
The affected units churn month to month because move-ins do.

**Decision:** these are legitimate resident events, classified in the data-quality
report as `prorated_move_in` (shown for context, badged as expected, not counted
as suspect). No backfill of prior months. Avon - 5166 room 21/A (a July move-in
prorated to $159) was individually corrected to its own prior-month rate ($4,029)
for 2026-07 only, per task requirement, using a single-month update.

### 3. `2ND OCCUPANT` rows — companion surcharges (NOT a defect)
The tag lives in `payor_type` (`2ND OCCUPANT` and `LEGACY - 2ND OCCUPANT`; 308 rows
in 2026-07). They sit on B beds and the existing B-bed exclusion already removes
them from street-rate aggregates. They are excluded from every suspect rule and
every median in the quality tooling.

## Rules implemented (`server/services/streetRateQualityService.ts`)

- **Suspect row:** street rate moved ≥8× in either direction vs the same
  room+service-line's prior month. Relative-only on purpose: HC / HC/MC street
  rates are daily ($300–900 is normal), so any absolute monthly floor would
  generate mass false positives.
- **Report:** `GET /api/street-rate-quality?month=YYYY-MM` and the
  `/street-rate-quality` page — grouped by campus, with prior-month rate and
  room-type sibling median for context, prorated move-ins classified separately.
- **Import guard (warn-only):** both import paths (legacy
  `POST /api/upload/rent-roll` and the data-imports subsystem) compare each
  incoming campus's median street rate against the previous month in the DB and
  warn on a ≥8× shift — the signature of a daily/monthly unit change. Imports are
  never blocked; a genuine repricing stays importable.
- **Single-month correction:** `PATCH /api/rent-roll/:id/street-rate` accepts
  `scope: 'single_month' | 'all_months'` (default `all_months`, the historical
  propagate-across-months behavior). The Room Attributes confirmation dialog
  exposes this as an "apply to this month only" checkbox.
- **Tenant safety:** `storage.uploadRentRollData` now scopes its delete-and-replace
  to the uploading client when a clientId is passed (the legacy path passes it),
  so re-importing a month can no longer delete another tenant's rows.
