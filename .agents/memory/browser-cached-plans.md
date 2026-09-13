---
name: Browser-cached planning results
description: Security and correctness rules for temporarily persisted planning results in the browser.
---

Browser-cached planning results must be scoped by authenticated client and user, and a confirmed logout must purge the cache. Never use a campus/service-line-only browser key for payloads containing resident details.

**Why:** The same browser can be used by multiple tenants or accounts, and a restored result can otherwise disclose another tenant's resident-level data.

Persisted results must retain the exact assumptions used to calculate them. Approval must block when the current editor assumptions differ from the displayed result; otherwise a user may review one recommendation and approve another.

**How to apply:** Any future client-side draft/result cache for pricing or planning should follow the identity-scoped storage and assumption-match gate, or use an authorized server-backed draft instead.

Auth hydration normally transitions from a temporary null identity to the
signed-in identity on every page load. That transition is not a logout and must
never clear persisted plans. Only authenticated identity → null is logout
cleanup; identity-scoped keys keep other transitions isolated.

Save calculated plans at the individual campus + service-line level even when
the user calculated several lines together. Restore a multi-line selection by
composing the latest cached result for each selected line.

**Why:** a cache keyed only to the exact multi-select combination makes an AL
plan calculated under “All service lines” disappear when the user filters to AL,
forcing an unnecessary recalculation. A completed request must still be saved if
the user changes filters while it is running, but it must never render under the
new scope.

**How to apply:** persist both the exact requested selection and each successful
line separately. On filter change, prefer the exact cached selection and fill
missing combinations from the line-level entries. Keep assumption-drift approval
blocking active for every restored line.

Keep the **render-scope key** separate from the **persistence key**. An
unauthenticated demo calculation has no safe identity key and therefore must not
be written to browser storage, but it still has a campus/service-line scope and
must render for the current page session.

**Why:** treating a null persistence key as a null scope makes a successful demo
calculation fail the stale-result guard and disappear without an error.

**How to apply:** gate writes on authenticated identity, but compare every
completed request against a scope key derived directly from the current campus
and service-line selection. Never use “can this be persisted?” to decide “can
this be displayed now?”