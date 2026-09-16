---
name: Annual report resident scatter
description: Resident-level annual-report charts must use the immutable saved detail snapshot without expanding the compact report payload.
---

The resident increase scattergram is a read-time projection of the report's separately saved resident detail snapshot. It uses saved service-line occupancy from the compact report and must not rerun planning or embed resident rows in the compact report JSON.

**Why:** Annual reports are historical snapshots; recalculating or reading the replaceable live planning snapshot can make a reopened report disagree with the PDF and with the operator's saved decision.

**How to apply:** Keep browser and PDF projections tenant-scoped and report-scoped. Deep links from points should carry campus, service line, room type when available, and an explicit return URL with the chart anchor.