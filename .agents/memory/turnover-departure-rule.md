---
name: What counts as a departure, and lines that outrun the model
description: The decision on which discharge categories are turnover for pricing (deaths included, leaves excluded), and how a service line measuring above 100%/yr is handled.
---

# Departure semantics for measured turnover

## Deaths count, and both workbooks hide them

A death vacates the unit exactly as a discharge does — it re-lets at the street
rate — so for pricing it is turnover. Both workbook shapes record it by leaving
the discharge category BLANK and naming the event somewhere else, so any rule
keyed on the category string alone drops every one of them. That was 29% of
Assisted Living departures, and it understated every measured figure.

The two sheets disagree about what a blank means, so the predicate cannot decide
alone: the legacy sheet omits the discharge type on a death, while the export
sheet names it in the event column and a blank there is genuinely unknown. Only
the legacy caller may treat a blank as a death.

**Why:** the export importer used to discard the event column when it wrote a
blank category, so for stored rows the value survives only inside the synthetic
census id. Any repair has to recover it from there before applying the rule.

**How to apply:** a rule change here must reach STORED rows via a backfill. The
feed is years of historical uploads; fixing only the importer leaves the
measurement wrong.

## What does and does not count

- **Counts:** permanent discharge, death.
- **Counts:** an internal transfer between service lines — the unit is genuinely
  vacated and re-lets at street rate, which is exactly the event being modelled.
- **Does not count:** hospital and therapeutic leave, return-expected discharge.
  The resident keeps the unit and the rate, so nothing re-prices.
- **Not netted out:** readmissions. A returning resident occupies a unit that
  was re-let in between.

## A line can legitimately outrun the model

Short-stay rehab really does turn over several times a year, so the Health
Center measures well past 300%. Rejecting that as implausible sent the page back
to a typed guess for the largest line in the portfolio, which is worse than
planning at the ceiling.

The rule: a line saturates when it measures above the model's maximum AND its
plausibility band reaches that maximum. A saturating line is trusted — no
warning, no rejection — but plans at the ceiling. Lines whose band stops short
(assisted living, the villas) get no reprieve; for them an over-ceiling figure
really is out of band.

**Why:** the bands answer "is this measurement believable for this care level".
Saturation answers a different question — "what do we plan with when a
believable measurement exceeds what the model can express". Conflating the two
either rejects real data or plans with a rate the solver silently clamps.

**How to apply:** keep the measured figure and the planned figure as separate
values everywhere, including in the UI. Report the measurement, plan with the
cap, and say the cap bound.
