---
name: Care-rate basis trap — our HC rates are daily, competitor care rates are mixed
description: Why HC care adjustments silently came out ~30x wrong, and why a missing HC adjustment is usually a data gap rather than a bug.
---

# Care rates: our HC is per-day, competitor care is mixed-basis

Two bases collide in competitor comparisons:

- **Our** rates: the health-care lines (`HC`, `HC/MC`) are stored and displayed **per day**.
  Every other line is **per month**.
- **Competitor** care-level-2 values are monthly for the senior-housing lines, but the HC
  column **mixes both bases row by row** — one survey month can carry 2, 8, 31, 100, 200,
  1050 and 1196 in the same column.

Differencing the two sides without converting produces a care adjustment roughly 30x too
large, which then flows into the adjusted rate and the variance.

**The rule:** resolve the competitor value into the service line's *native* basis — per-day
for HC lines, per-month otherwise — before any arithmetic. Convert the competitor figure
**down to daily** for HC; never push our daily rate up to monthly.

**Why:** the native basis is what the rest of the app already displays for that line, so
converting the competitor side is the only direction that leaves the street rate, the care
adjustment and the variance in one unit consistent with the UI.

**How to apply:** resolve the care basis **independently of the street-rate basis**. Gating
the care conversion behind a street-rate check lets an HC row with a monthly base skip
conversion entirely — the two columns disagree per row.

## Keep the basis decision in one place

`shared/careRates.ts` owns it, in a native-basis and a monthly flavour.

**Why:** several surfaces each grew their own cutoff and silently disagreed about the same
survey row — one read a value as daily while another multiplied it to monthly, and a third
used both a different threshold and a different days-per-month constant. Any local
`< 500 -> scale up` or `> 200 -> divide` test is this bug coming back.

Values implausible on *either* reading are rejected rather than converted, and callers
degrade that to **no** adjustment. For a benchmark feeding pricing decisions, omitting an
adjustment is far safer than publishing one that is wrong by ~30x. This deliberately drops
a genuine care schedule above roughly $2,400/mo.

## A missing HC adjustment is usually missing data, not broken math

Check the data before debugging the calculation. Competitor HC care rates are **almost
entirely absent** in recent survey months (HC ~98% null-or-zero, HC/MC and SMC ~99%), while
AL is well populated with a credible monthly spread. Our own side is complete, which is
exactly what makes the gap look like a code bug.

Also distrust a month that appears to have *full* HC coverage: at least one historical month
had every HC row set to the identical constant 1196 — a blanket fill, not survey data.
Carrying such a value forward fabricates a portfolio-wide adjustment.

**How to apply:** when a care adjustment is reported missing, first group the survey table by
month and competitor type counting non-null care rates. No code change can conjure an
adjustment the source data does not contain — that fix belongs in the import or the survey.
