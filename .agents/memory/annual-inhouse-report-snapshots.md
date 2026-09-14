---
name: Annual in-house report snapshots
description: Durable data and ownership rules for the Annual In-House Increase Plan report.
---

Annual reports are presentation snapshots of an already calculated in-house plan. They must never become a second solver or recalculate results while loading, printing, or exporting.

**Why:** Executive totals, occupancy-tier scenarios, charts, and PDF output must reconcile exactly to the decision the operator reviewed. Saving full resident records would also duplicate sensitive operational data unnecessarily.

**How to apply:** After each successful calculation, automatically upsert one latest report per tenant and exact calculation scope with a server timestamp; also save a full run already open in memory after UI reloads. Build the request from an explicit report-field allowlist (never spread the solver result), preserve tier cells, use measured tiers for totals, and persist six distribution counts—not resident or room arrays. Keep each service-line plan only once; tier-grid rows should refer back to the report plans when restored rather than embedding duplicate plan objects. Quarter snapshots retain conclusions used by the UI, not solver narratives or bridge rows. Enforce a client payload budget below the default parser limit, authenticate every operation, and keep daily health-care rates distinct from monthly senior-housing rates.