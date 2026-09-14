---
name: Annual in-house report snapshots
description: Durable data and ownership rules for the Annual In-House Increase Plan report.
---

Annual reports are presentation snapshots of an already calculated in-house plan. They must never become a second solver or recalculate results while loading, printing, or exporting.

**Why:** Executive totals, occupancy-tier scenarios, charts, and PDF output must reconcile exactly to the decision the operator reviewed. Saving full resident records would also duplicate sensitive operational data unnecessarily.

**How to apply:** Upsert one latest report per tenant and calculation scope with a server timestamp. Preserve all tier cells, but use each line's measured tier for totals. Persist only anonymous increase percentages for distribution bands, authenticate every read/write/export, and keep daily health-care rates distinct from monthly senior-housing rates.