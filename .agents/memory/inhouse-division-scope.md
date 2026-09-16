---
name: In-house division scope
description: Division selection is a validated campus allowlist that must remain distinct in calculations, persistence, and rule application.
---

Division scope is resolved against the caller's client and reused as an exact campus-name allowlist. A selected campus inside a division narrows to that campus; “all campuses” within a division uses the full allowlist. Division assumptions persist separately from portfolio assumptions and fall back to the matching portfolio tier. Division plan history also inherits each portfolio service-line plan until an active division-specific plan exists. Division-wide rate-plan rows use an internal storage marker because the legacy plan schema has no division column; applied rules carry the explicit campus allowlist.

**Why:** Treating division as only a UI filter caused portfolio-wide calculations, stale restores, and potentially global rule application.

**How to apply:** Thread division through every planning request, cache/storage key, history/report lookup, and apply path. Preserve the old key and NULL-assumption behavior when no division is selected.