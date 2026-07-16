---
name: HC private-pay-only impact
description: Business rule — HC/HC-MC pricing impact math must count Private Pay only
---
Rule: For HC and HC/MC service lines, any revenue-impact measurement (prospective move-in estimates, historical/realized rule impact, T3 revenue deltas, "sold after rule" attribution) must count Private Pay residents/move-ins only.

**Why:** Medicaid, Medicare, Hospice, Managed Care residents are reimbursed at fixed rates and are unaffected by street-rate pricing rules. For Trilogy, only ~18% of HC rows are Private Pay, so unfiltered math overshoots impact ~5x.

**How to apply:** Payer detection is `payor_type ILIKE '%private%' OR '%pvt%'` (null payor_type = vacant unit — keep vacant units as candidates since future fills may be private). Both the prospective path (ruleImpactService) and historical path (/api/rule-performance) implement this; keep any new impact surfaces consistent.
