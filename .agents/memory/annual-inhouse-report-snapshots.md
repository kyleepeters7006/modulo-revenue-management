---
name: Annual in-house report snapshots
description: Durable data and ownership rules for the Annual In-House Increase Plan report.
---

Annual reports are presentation snapshots of an already calculated in-house plan. They must never become a second solver or recalculate results while loading, printing, or exporting.

**Why:** Executive totals, occupancy-tier scenarios, charts, and PDF output must reconcile exactly to the decision the operator reviewed. Saving full resident records would also duplicate sensitive operational data unnecessarily.

**How to apply:** Save only an explicit operator-approved report and keep resident audit data in its separate authenticated snapshot. Compact report payloads should retain the conclusions needed to render, export, and audit offline, while restored plans must show unavailable when a required saved input is absent. The executive bridge uses the saved matched-room historical rate effect, independent of the new plan; portfolio totals use prior-year average rate weighted by modeled residents, and any missing service-line effect makes the aggregate unavailable. Keep web, PDF, and Excel on that same basis.

Division rollups must recompute that historical effect across every included campus; they must not inherit the first campus’s diagnostic, and a missing campus effect makes the division value unavailable.

The report banner and combined total row must sum the same per-service-line annualized YoY revenue values; do not mix stored plan annual increases with the growth-bridge basis.
