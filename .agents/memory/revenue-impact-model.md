---
name: Reference Data revenue impact model
description: Formula for the Revenue Impact Monthly/Annual columns on the Reference Data view
---

Revenue Impact (Monthly) = (effective proposed rate − current **street** rate) × T3 move-ins per month. Annual = monthly × 12. Null when any input is missing.

**Why:** User directive (July 2026): only new move-ins are affected by street-rate changes; existing residents keep their rates. Replaced the old model of (proposed − in-house rate) × total units.

**How to apply:** Both the grouped reference-data endpoint and the Room Detail (units) endpoint must use this model. Room Detail distributes each group's T3 move-ins evenly across its units (group T3 ÷ unit count) so unit rows sum to the group figure. Effective proposed = manual override → stored rule-adjusted rate → rule-preview fallback (Room Detail replicates a lightweight version of the grouped rule preview, including RTO-history occupancy for trigger evaluation; small residual diffs vs grouped view are expected because per-unit street rates vary around the group average). Keep the frontend tooltip in the reference-data table in sync with this formula.
