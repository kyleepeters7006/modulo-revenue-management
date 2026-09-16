---
name: Annual report audit export
description: How annual report exports preserve totals while exposing resident and room calculation detail.
---

Annual report presentation snapshots stay compact and should not retain resident identity. When an operator saves a report, preserve a report-specific copy of the full calculation-detail snapshot separately; the audit workbook can then tie service-line totals, resident rates, quarter-room projections, and prior-period explanations back to the exact saved report.

**Why:** Recalculating from current rent-roll data during export can silently change the numbers the operator approved, while putting all resident rows into the presentation snapshot makes normal report saves unnecessarily large.

**How to apply:** Use the report-specific detail copy first for Excel/PDF/web audit views, fall back to the latest exact scope detail only for legacy reports, and clearly explain the fallback or unavailable-detail state to the operator. For portfolio/division exports, join each resident row to the campus snapshot from the same report generation before writing planned Street or annual prior-year bridge values; if asynchronous campus generation finished after the report save, use the newest exact-scope campus snapshot rather than repeating a portfolio average. Keep hidden helper cells aligned with the visible row values.