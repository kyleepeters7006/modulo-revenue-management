---
name: Overview loading concurrency
description: Rules for keeping the Overview dashboard and its rate charts responsive.
---

Independent Overview datasets must start concurrently. In particular, a chart
request must not be mounted behind a larger KPI component's loading return.
Overview should fetch only data used on that page; do not globally prefetch
Pricing Controls, rules, analytics, guardrails, or location datasets there.

**Why:** the cold Overview KPI and Rate Growth requests each take roughly seven
seconds on production-sized data. Running them sequentially made the chart wait
about fourteen seconds, while concurrent loading makes the chart ready when the
KPI payload finishes. Unrelated prefetches also competed for database and network
capacity without improving the current page.

**How to apply:** start independent Overview queries at route mount and let the
query cache share their in-flight requests with components that render later.
Only prefetch a detail endpoint after clear user intent, not incidental hover.