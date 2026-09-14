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

Portfolio-wide plans can contain enough resident detail for IndexedDB's
structured clone to terminate mobile Safari during restore. Browser persistence
must store compact totals/projections, not resident rows; a storage-shape change
must use a new database/key version so old oversized values are never opened.

**Why:** an authenticated iPhone repeatedly reloaded and died before normal API
loading because startup tried to clone a previously saved portfolio result.

**How to apply:** keep full resident detail only in current-session memory or an
authorized server store. Label compact restores. Any summary click-through that
needs resident rows must automatically recalculate the same scope, then apply
the requested filter and navigate only after detail is loaded; never show an
empty table as though the summary count were zero.

Browser persistence is best-effort post-processing and must never keep the
calculation mutation pending after the server result arrives.

**Why:** IndexedDB can be slow or blocked in embedded/mobile browsers, leaving
Calculate spinning forever even though fresh results are already available.

**How to apply:** commit returned results and finish the mutation first, then
write compact browser storage in a detached promise and report failures
separately.

iOS WebKit must use compact localStorage plan snapshots directly, even when
IndexedDB exists. Do not probe or open the calculated-plan IndexedDB on iPhone or
iPad; its structured-clone path can terminate the page before an error is raised.

**Why:** compacting and versioning the payload alone did not stop repeat iPhone
process crashes during authenticated plan restoration.

**How to apply:** route both reads and writes at the storage boundary by user
agent, retaining identity/filter keys and explicit success reporting on both
backends. Before localStorage writes, remove obsolete version keys and bound the
number of retained filter scopes. On quota failure, retry with the newest
calculation alone so stale drafts cannot block the result the user just ran.
When saving a multi-line calculation plus single-line fallbacks, write the
complete selected scope last; quota recovery protects the final write, so a
single-line write must never be allowed to replace the complete result.
Optional single-line fallback failures must not mark the calculation unsaved
when that protected complete-scope write succeeds.

When both IndexedDB and localStorage are blocked, retain identity-scoped compact
plans in module memory and treat the write as successful for the current SPA
session.

**Why:** embedded mobile Safari can deny every persistent storage backend even
though calculation and client-side navigation still work. Reporting the plan as
unsaved is misleading and blocks a usable current-session workflow.

**How to apply:** write the in-memory copy before attempting persistent storage,
read it first, and clear it on confirmed logout with the persistent caches. Do
not claim that this fallback survives a browser reload.