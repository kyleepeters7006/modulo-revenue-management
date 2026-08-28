---
name: AI rule suggestions must honor page filters end to end
description: The campus/region/division scope has to reach the datasets, the displayed impacts, and the rule that Accept persists.
---

# Page scope in the AI rule-suggestion flow

The Suggest-Rules run must be scoped by the page's campus **and** region **and**
division filters (AND semantics, matching the rules-list scope resolver). Three
places have to agree, and it is easy to fix only the first:

1. **Every dataset in the prompt** — occupancy history, rent-roll YTD, T3
   move-ins, elasticity, per-service-line unit sets. A single unscoped source
   makes the AI reason about the portfolio while the header claims one region.
   Elasticity is the sneaky one: it was pinned to whichever campus appeared
   first in the rent roll even on unscoped runs.
2. **The impact numbers shown on each suggestion** — the shared impact engine
   takes a `locationIds` scope; passing only a single `locationId` silently
   yields portfolio-wide units/monthly/annual for any region or multi-campus run.
3. **The rule Accept persists** — a region run has no single location id, so the
   campus scope must be written into the rule's name-based location filter, read
   from the tenant's cached run server-side (never from the request body).
   Without it, a rule reasoned about for one region prices the whole portfolio.

**Why:** each layer looked correct in isolation; only the accept path turns a
display bug into a real pricing-scope breach.

**How to apply:** a filter set that resolves to zero campuses must return an
empty result with a reason, never fall through to an unscoped run. Scope
predicates should accept a location **id or name**, since some sources carry
only names.

Suggestion cards must also pass the final qualified-unit calculation before
they are shown. Aggregate occupancy history can indicate vacancy even when the
only vacant rent-roll rows are non-pricing companion beds, so a plausible draft
can still have no eligible action population.

**Why:** displaying elasticity beside zero affected units makes an unusable
draft look actionable and asks the operator to diagnose internal eligibility
rules.

**How to apply:** reject and attribute zero-qualified-unit drafts after all
triggers, action filters, page scope, room-type mappings, and B-bed exclusions
have run. Do not substitute the action-only elasticity unit count.
