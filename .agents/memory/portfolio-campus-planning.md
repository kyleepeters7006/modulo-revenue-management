---
name: Portfolio-to-campus planning
description: Input precedence and calculation semantics when a portfolio plan generates campus reports.
---

A portfolio planning run must create an individualized calculation and annual report for every campus. Each campus uses its own residents, rates, occupancy, tier, and projections, but starts from the exact portfolio assumptions and tier policy used by the portfolio run.

**Why:** The user rejected both client-side campus slices and unrelated independently configured campus runs. Campus reports must be internally correct while remaining governed by the applied portfolio planning policy.

**How to apply:** Pass the portfolio input snapshot explicitly into the campus fan-out instead of resolving existing campus overrides. Restore those inputs into the campus editor with the generated report. Because report snapshots intentionally omit resident rows, selecting a restored campus must refresh that exact calculation once inputs and tier policies hydrate; never present the empty snapshot array as 0 residents. A later explicit campus save/rerun creates a more-specific override for that campus only. Never let an older fan-out overwrite a newer report.