---
name: Census report tie-out
description: How the client's census report relates to our occupancy-history capacity, and why it is a reference only.
---

# Census report tie-out

The client's finance system produces a daily census report whose capacity numbers
are close to, but not identical with, the capacity we derive from occupancy
history. Occupancy history remains the single source of truth for both capacity
and occupancy; the census is imported **only** as a tie-out reference and must
never feed pricing, Total Units, or any served number.

**Why:** the two systems are maintained independently and reorganize their
division groupings on different schedules, so they will always drift slightly.
Making the census authoritative would mean re-deriving every downstream figure
from a source we don't control and can't recompute.

**How to apply:** when a stakeholder challenges a unit count, show the drift
rather than "correcting" our numbers to match. Never silently edit client
capacity data to close a gap you inferred.

## Reading the report

- The export contains several **unlabelled** roll-up sections (full company,
  ex-Kingston, Kingston-only, and other cuts) followed by one section broken out
  by division. Only the division section is unambiguously scoped, and it sums to
  the full-company roll-up — read that block and ignore the rest.
- Each measure appears several times across a row with a numeric suffix
  (`AvailableBeds20/21/22`): per-payer detail, a subtotal, and the company grand
  total restated on every row. Identify them from the data — the grand-total pair
  is constant on every row, and the detail pair is the one that sums to it —
  rather than from column position, which moves between exports.
- Health-care departments report capacity in AvailableBeds, senior-housing
  departments in AvailableUnits; the other column is zero, so both must be summed.
- Capacity appears only on the PRIVATE PAY and UNOCCUPIED payer rows; 2ND
  OCCUPANT rows are zero, so companion beds are already excluded — consistent
  with our own B-bed handling.
- Numbers use comma thousands separators and parenthesised negatives.

## Division names don't line up

The census carries "… With Kingston" variants (North Ohio With Kingston,
Southeast Ohio With Kingston, …) that our data does not, and it splits/merges
some Indiana divisions differently. Only about two thirds of division names match
exactly.

**Why:** equating "North Ohio With Kingston" with our "North Ohio" would compare
different campus sets and report drift that isn't real.

**How to apply:** compare only exact name matches and list the unmatched
divisions on each side. Do not build a fuzzy mapping without the client
confirming which groupings correspond.

## What the drift actually is

Within name-matched divisions the residual is small; most of the gap sits in the
divisions that were reorganized between the two systems. A month-over-month
comparison of our own data showed no dropped rows, so the difference is a genuine
source disagreement, not an import gap. Resist the temptation to close it by
editing a campus whose count happens to match the residual.
