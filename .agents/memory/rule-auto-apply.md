---
name: Rule changes auto-apply to stored rates
description: Why saving an adjustment rule now schedules a background repricing run, and why that run is scoped to one tenant only.
---

# Rules are applied automatically, not on read

Saving an adjustment rule used to change **nothing** about stored rates — every rule
CRUD endpoint only purged caches, and the rate-card read path just returns the stored
`rule_adjusted_rate`. Rates only moved when a human clicked a "run" button, so the rent
roll routinely showed rates that predated the active rules.

**Rule:** a pricing-relevant rule mutation must schedule a debounced background
repricing run. Cosmetic mutations (notes-only edits) must not.

**Why:** applying rules on read was measured and rejected — the per-location
recalculation runs ~7 queries *and writes* metrics rows, times ~9 distinct locations on
a single 1000-row page. Far too heavy for a GET. Recomputing on write is the only place
the cost is paid once.

**How to apply:** call the rule-change helper (purge + schedule) rather than the plain
cache purge from rule create/import/accept/patch/toggle/reselect/additive/delete. Keep
the plain purge for notes-only edits and for bulk sync loops, where fanning out would
fire several portfolio jobs at once.

## Debounce must re-arm, not race

A run already in flight read the rules as they were when it started, so it cannot pick
up a change made mid-run. Starting a second concurrent run instead races it. The
scheduler therefore defers while a run is active — but that deferral **must be bounded**
(a hung or continually re-triggered run would otherwise defer the queued recalculation
forever, silently). On giving up, log loudly: the rates are stale until the next edit.

## Recalculation is single-tenant on purpose

Do NOT "fix" this by fanning the recalculation out to all tenants.

**Why:** rules are global — `adjustment_rules.client_id` is NULL on every row — so a
rule edited in one tenant genuinely affects the others, and their stored rates do go
stale. Fan-out still loses, because the rule mutation endpoints have **no auth
middleware** and an unauthenticated session resolves to clientId `demo`. Fanning out
would let any anonymous visitor trigger a full portfolio repricing *write* against a
real tenant's data. Staleness is the safer failure mode.

**How to apply:** the durable fix is to scope rules per tenant, or to put the rule
endpoints behind auth. Until one of those lands, keep recalculation scoped to the
requesting client and leave the gap documented at the call site.

## Making a background run visible

A page cannot poll by job id for a run it did not start, and auto-triggered runs are
exactly that. Expose "is a run in flight for this client" instead, poll that, and
invalidate the rate query when it flips back to idle.
