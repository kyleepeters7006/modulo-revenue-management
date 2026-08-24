---
name: The move-in/out feed is two overlapping imports
description: Why absolute event counts read double, how one import format is chosen per campus-month, and the rule every consumer must follow.
---

## The trap
The move-in/out event table can hold **two workbook formats describing the same
admissions and discharges**: a legacy Admissions/Discharges workbook (numeric
departments) and a newer single-sheet "Export" workbook (text departments).
Each mints its own synthetic census id, so the upsert's `ON CONFLICT` on
`(client_id, event_type, census_id)` never recognises the pair and both copies
survive. Every absolute count over the overlap reads roughly double.

**Why it survived so long:** nothing errors. Both copies are real, well-formed
rows. A doubled turnover (~541% on the Health Center) and a doubled move-ins
per month are still plausible-looking numbers, and move-ins/month scales every
adjustment rule's projected revenue impact.

## The resolution
One format owns a **campus + event type + month**; the other's rows are flagged
and hidden behind a view. Reads must go through the deduped view, never the
base table.

**Why a whole format wins a campus-month, not row-by-row matching:** matched on
campus + date + room number the two formats agree on ~98.7% of rows, but the
legacy side stores the room without the bed letter, so two residents leaving
one companion room on one day collapse to a single key. A residual few percent
of unmatched duplicates is the worst outcome — still double, no longer visibly
double. Both formats are complete census feeds for a campus in a month, so
choosing one keeps every event exactly once.

**Why the newer export format wins:** it resolves strictly more of the
portfolio (skilled nursing and independent living are their own lines, and the
memory-care neighbourhood inside the health center is only identifiable there).
The legacy format folds all of those into its two big departments. Where the
two disagree on volume they disagree by ~2%.

**Why the preference is per campus-month and not global:** ~80 campus-months in
the overlap exist only in the legacy feed. A global "export wins" rule deletes
them silently.

## How to apply
- Any new count, rate, or average over event rows reads the deduped view.
  Adding `AND NOT superseded` to a new query by hand is the thing that will be
  forgotten — that is why it is a view.
- The resolution runs after every import AND on boot. Event workbooks are
  historical: a client's two years of stored rows predate the fix entirely, so
  an import-time-only resolution never reaches them.
- Keep it idempotent (write the full truth, skip rows that already agree) since
  it runs on every boot over the whole table.
- Before trusting any absolute event count, check which department vocabularies
  the window actually covers.

## Departments do not translate one-for-one between the formats
Matching legacy rows to export rows on campus + date + room number is the way
to prove what a legacy department really was — do not read the department name.
Measured this way, the legacy `24-A/I` department (mapped in code to AL memory
care) lands on export rows whose department is **skilled nursing**, not memory
care, for 318 of its 328 counted discharges, and every one of its campuses is
also a skilled-nursing campus in the export feed. Assume the code's legacy
department map encodes guesses until each entry has been checked this way.
