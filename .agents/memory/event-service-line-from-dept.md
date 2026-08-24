---
name: Event service line comes from the department, not the service-line column
description: Why memory-care neighbourhoods vanish into their parent building in the move-in/out event feed, and how to tell the two apart.
---

## Rule
In the move-in/out event feed, the **department** is the only field that distinguishes a
sub-neighbourhood from the building it sits in. The workbook's "Service Line" column names the
building, so deriving the service line from it collapses memory care into its parent.

**Why:** Occupancy history and the rent roll both carry memory-care lines of their own. When the
event feed cannot emit them, the line ends up with a denominator and no numerator and every
event-derived metric for it reads exactly zero — measured turnover, T3 move-ins, rule impact.
Zero is not obviously wrong, so it survives review and gets silently replaced by a hand-typed
assumption.

**How to apply:**
- Look up the department FIRST, before any "is this already a code?" shortcut and before the
  service-line text fallback. Match it case- and whitespace-insensitively.
- Prove the mapping instead of guessing it: join the event's room/bed to the rent roll's
  `room_number` at the same campus and check which service line the rent roll gives that room.
  Memory-care and parent-line rooms are near-perfectly disjoint, so the answer is unambiguous —
  and a room that both lines have carried over time is a reassignment, not a contradiction.
- Do not trust a department's NAME over its rooms. `24-A/I` reads like an Alzheimer's unit and was
  mapped to memory care on that reading; the room join says every one of its move-outs is in a
  senior-living room and none in a memory-care one. It is the legacy feed's name for `SL`. The
  mis-mapping gave AL/MC a numerator drawn wholly from another service line — 14% annual turnover,
  a seven-year memory-care stay, and low enough to look like a modelling quirk rather than a bug.
- Corroborate a suspected synonym three ways before acting: the room join, month-by-month count
  parity against the department you think it duplicates, and the campus sets (a true synonym is
  filed at a subset of the campuses that file its twin, never at campuses the twin never reaches).
- Beware the inverse error too: "leave it alone, it might double-count" is only sound if the line
  really does receive events elsewhere. Here it did not, so the caution preserved the bug.

## Event workbooks are historical, so a mapping fix needs a backfill
Nobody re-uploads two years of admissions because a mapping changed. Any correction to the
department map must be paired with an idempotent re-derivation of stored rows (`UPDATE ... WHERE
service_line IS DISTINCT FROM <mapped>`), or it only ever applies to the next import. Pin the
resulting invariant in a test — every stored row agrees with the current map — so the next import
format cannot quietly revert it.

## This client's feed contains two overlapping imports
Discharges arrive under two department vocabularies at once: a legacy numeric one (`01-HCC`,
`02-AL`, `03-VIL`, `24-A/I`) and a newer "Export" text one (`HC`, `AL`, `VIL`, `SL`, `IL`, plus the
`* Legacy` memory-care neighbourhoods). Their monthly counts line up almost exactly
(`01-HCC` ≈ `HC` + `HC Legacy`, `02-AL` ≈ `AL` + `AL Legacy`, `24-A/I` ≈ `SL`), i.e. the same
discharge is stored twice under different synthetic keys. Any count that spans both formats is
inflated — counting both put measured AL turnover at 153% a year.

**Precedence: the Export feed wins.** It reaches every month the legacy feed does and starts a year
earlier, and it is the ONLY vocabulary that separates the memory-care neighbourhoods — the legacy
`02-AL` has memory care embedded in it. Deferring to the legacy feed would fold AL/MC back into AL
for every overlapping month.

**Decide precedence per campus-month, not globally.** A small tail of campus-months (~58 of ~4,200)
is reported by the legacy feed alone; dropping that feed wholesale silently loses them. Coverage
means "this feed filed for that campus-month at all", so ignore the `counted` flag when building
the coverage set — a month of nothing but hospital leaves is still a month the feed covered, and
the legacy copy of it is still a duplicate.

**Verify de-duplication as a property, not a number.** Two assertions catch both directions: no
campus-month contributes rows from both feeds, and the surviving legacy-only rows are still
non-zero.
