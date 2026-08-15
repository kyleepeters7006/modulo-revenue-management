---
name: Competitors endpoint result capping
description: /api/competitors returns a capped items[] plus a separate true total, and the map's pin count is a third number — decide which population a count describes before labelling it.
---

`GET /api/competitors` returns `items[]` **capped to the top 3 competitors per location whenever
more than one location is in scope**. A single selected location returns the full list. The
uncapped count comes back separately as `totalCompetitors`.

The competitor map shows a *third*, smaller number again: it collapses competitors sharing an
identical lat/lng into one marker and drops anything beyond a 30-mile radius of the current
property, so its "N competitors found" subtitle legitimately disagrees with both of the above.

**Why:** any UI that counts `items.length` and labels it "competitors tracked" silently
understates coverage the moment a user filters to several locations. Three plausible-looking
counts sitting near each other on one page invites a bug report that isn't a bug.

**How to apply:** decide explicitly which population a number describes before naming it. Use
`items` only with "shown"/displayed wording, use `totalCompetitors` for any coverage claim, and
never assume a page-level count should match the map subtitle. If several derived stats sit
together, derive them all from the same population so they stay internally consistent.
