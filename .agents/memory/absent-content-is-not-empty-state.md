---
name: Absent content is not an empty state
description: Why a read failure, a dropped session, or an in-flight request must never render as "nothing has been generated yet" in this app.
---

A panel that caches expensive generated content (AI analyses, solver results,
anything with a "Run it" button) must distinguish **four** reasons its content
slot is empty, and only one of them may show the never-run placeholder:

1. not ready — pre-hydration, or the read is in flight
2. read failed with nothing cached
3. read failed but stale content is cached
4. the read succeeded and genuinely returned nothing

**Why:** the tenant middleware resets the client to the demo tenant whenever a
session cannot be revalidated (revoked, pending MFA, deactivated account), and
it does so on a *200 response*. A real tenant's saved analysis therefore comes
back as a perfectly valid "no analysis exists" for the demo tenant. Collapsing
all four states into one placeholder told the user their work was gone and
offered a fresh paid AI run as the remedy. HTTP status alone cannot detect
this case — the fallback needs an authoritative tenant signal in the response.

**How to apply:**
- Never derive "empty" from the absence of content. Derive it from a read that
  demonstrably succeeded, and treat a stored-but-blank payload as empty too.
- A query disabled pending hydration reports `isLoading === false` in TanStack
  v5, so hydration must be part of the not-ready test.
- A refetch keeps previous data. `isError` with cached data is a staleness
  warning that should still show the content; `isError` with nothing cached is
  the only state that hides it.
- Long async work must carry the scope it was started for. Filters change while
  a run is in flight, and an unscoped pending flag makes the new scope look
  busy while a late failure gets reported against data it never touched.
- An open editor must be abandoned on a scope change: the draft belongs to the
  old scope but Save writes to the current filters, which silently overwrites a
  different scope's saved copy.
