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
- A department the map has no opinion about must be left exactly as imported. Folding one in
  "for symmetry" can double-count a line that already receives its own events from a different
  department.

## Event workbooks are historical, so a mapping fix needs a backfill
Nobody re-uploads two years of admissions because a mapping changed. Any correction to the
department map must be paired with an idempotent re-derivation of stored rows (`UPDATE ... WHERE
service_line IS DISTINCT FROM <mapped>`), or it only ever applies to the next import. Pin the
resulting invariant in a test — every stored row agrees with the current map — so the next import
format cannot quietly revert it.

## This client's feed contains two overlapping imports
Discharges arrive under two department vocabularies at once: a legacy numeric one (`01-HCC`,
`02-AL`, `03-VIL`, `24-A/I`) and a newer text one (`HC`, `AL`, `VIL`, `SL`, `IL`, plus the
`* Legacy` memory-care neighbourhoods). Their monthly counts line up almost exactly
(legacy `01-HCC` ≈ text `HC` + `HC Legacy`), i.e. the same discharge is stored twice under
different synthetic keys. Any count that spans both formats is inflated. Check which departments
a window actually covers before trusting an absolute event count.
