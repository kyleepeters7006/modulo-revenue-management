---
name: Analytics endpoint test harness
description: Lifecycle requirements when mounting the full Express route graph inside a standalone endpoint test.
---

Standalone endpoint tests that mount the full route graph must await the `registerRoutes` readiness callback before sending requests. Route registration also starts background schedulers, so the test must close its ephemeral HTTP server and terminate explicitly after cleanup rather than ending the shared database pool underneath those schedulers.

**Why:** The route graph binds its listener before schema and security initialization finish, and its startup jobs outlive the test's request assertions.

**How to apply:** Capture `onReady`, await the returned promise before the first request, use an ephemeral listener, clean fixture rows, restore monkeypatches, close the listener, and exit without calling `pool.end()`.