---
name: Planning signal validation
description: Provenance and coverage rules for vacancy and sales-cycle signals used by in-house rate planning
---

Vacancy evidence must retain whether the source actually supplied a value; a storage default cannot stand in for missing input. Time to sell stays unavailable until vacancy-to-occupancy transition history is available; occupied-row vacancy fields are not a valid proxy.

**Why:** Sparse feeds, legacy labels, malformed values, and storage defaults can make an apparently complete signal misleading. Letting partial data change a recommendation would be silent and difficult to audit.

**How to apply:** Count every in-scope source row in coverage, count only source-present and plausible values as valid, and treat missing data as unavailable while sparse or implausible data is neutral. Do not infer sales-cycle values from occupied rows. Until a pricing effect is explicitly defined, validated values must remain neutral to the solver and appear as provenance in the plan explanation.