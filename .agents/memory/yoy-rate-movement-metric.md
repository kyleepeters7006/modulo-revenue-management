---
name: YoY rate movement vs. proposed lift
description: How the strategy report's "Rate Movement" numbers are defined, and why proposed and blended percentages differ.
---

The Pricing Strategy Report contrasts *realized* rate movement with *proposed* movement. Three
distinct percentages are involved and they must not be conflated:

- **YoY change** — actual movement in average street rate over the trailing 12 months, per service
  line. Computed from rent roll street rates, current upload month vs. the same month a year prior.
- **Proposed %** — the unit-weighted average adjustment the active rules apply *to the units those
  rules actually claim*. This is the number that answers "how big is the increase we're proposing?"
- **Blended / net effect %** — the same lift spread across *every* unit in the service line
  (`proposed × coverage`). This answers "what does this do to the line as a whole?"

A +5% rule touching 30% of units is a +5% proposal and a +1.5% blended effect. Showing only one of
the two misleads in opposite directions, so the report shows both plus the coverage that connects them.

**Why:** stakeholders read a single headline percentage as portfolio-wide. Quoting the proposed %
alone overstates portfolio impact ~3-20x depending on coverage; quoting the blended % alone makes
individual rules look trivially small and invites over-aggressive rule writing.

**How to apply:**
- The portfolio roll-up must weight the proposed % by *affected* units and the blended % by *total*
  units. Using the same denominator for both collapses the distinction.
- Compute roll-ups from unrounded per-line values; round once at presentation.
- A service line with no prior-year data has a **null** YoY, not 0. Exclude it from the weighted
  roll-up entirely and surface how many lines were excluded — treating null as 0 while keeping the
  line's unit weight silently drags the portfolio number toward zero.
- The proposed half must reuse the same specificity-ordered dedup as the combined-stats endpoint
  (shared `claimed` unit set) so a unit matched by several rules is counted once. Iterating service
  lines inside the rule loop is safe because a unit belongs to exactly one service line.
- HC and HC/MC are daily rates; every other senior-housing line is monthly. Never sum or average
  across that boundary.
