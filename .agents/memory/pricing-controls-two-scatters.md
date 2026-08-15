---
name: Two different scatter charts on Pricing Controls
description: "Scattergram" and "Competitive Position" are two unrelated scatter plots on the same page — disambiguate before acting on a request that names either.
---

The Pricing Controls page carries two scatter plots that are easy to confuse, and a user saying
"the scattergram" may mean either:

- **"Scattergram"** — a view mode of the rule-performance analysis. Plots occupancy before the
  change (x) against the change in move-ins per month, T3 after minus T3 before (y). This is
  rule-impact analysis; it has nothing to do with competitors.
- **"Competitive Position"** — plots occupancy (x) against our Studio rate as a percentage of the
  top competitor's care-adjusted rate (y), with a reference line at 100 = at market. VIL uses the
  overall rate rather than Studio.

**Why:** the names sound interchangeable and both are scatter plots on the same screen, so a
request naming one frequently describes the other. Acting on the wrong one means building the
right feature in the wrong place.

**How to apply:** when a request names a scatter chart on this page, decide from the *axes* the
user describes, not the word they use. "Competitive"/"market"/"versus competitors" means the
competitive-position chart; "move-ins"/"rule performance"/"impact" means the rule-performance
scattergram. When genuinely ambiguous, state which one you built against and invite redirection.
