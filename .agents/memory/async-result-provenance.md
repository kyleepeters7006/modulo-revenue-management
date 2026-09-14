---
name: Long-running results and loaded-policy provenance
description: Rules for client state around slow (~30s) computations and per-scope settings loaded from the server — what must be snapshotted, and why "populated" is not "loaded".
---

## A slow result must carry the scope AND the inputs it was built from

Anything that takes tens of seconds to compute is long enough for the operator to
change scope or edit an input while it runs. Snapshot both, inside the mutation
function, before the first `await`, and return them alongside the result:

- **Scope** (campus, selection) — on completion, compare against a ref updated
  every render and discard outright if it moved. Repainting a finished result
  under a scope it does not describe labels one campus's numbers with another's.
- **Every input actually posted**, not just the ones that feel related. A key
  built from only part of the payload leaves the result looking current after
  the rest was edited.

Use the snapshot for the requests too, not the live value — otherwise the
identity you recorded and the request you sent can disagree.

Advisory defaults loaded by a separate slow query must stop auto-applying once a
calculated or restored result is visible.

**Why:** measured turnover arrived after a tier calculation and silently changed
the editor input. The operator touched nothing, but the result was immediately
labelled stale.

**How to apply:** auto-adopt measured or inferred defaults only while the editor
has no displayed result. Once a result exists, show the late evidence without
mutating the inputs underneath it.

**Why:** the observed failure was a ~30s grid: changing campus mid-run
repopulated under the new campus, and editing an input left a stale grid on
screen with no indication.

## Per-scope settings loaded from the server: three separate traps

For settings that are per (scope, key) and edited in place — loaded once, edited,
saved back:

### 1. Load each key independently; never clone one key's stored value across the others

Sharing one fetch across several keys hides the others' saved values on screen
and then overwrites them on the next save. This is the difference between a
setting the operator edits once and applies to everything (safe to share) and one
that is genuinely per key (not).

### 2. Put the scope inside the state, not in a reset effect

A seed effect and a campus-reset effect race, and effect order is not a contract:
returning to a previously visited scope makes cached data available on the first
render, so seed-then-reset ends at empty. Hold `{ scopeKey, values, ... }` and
read through a scope check, so a value from another scope is unrepresentable
rather than merely unlikely. Do the reset inside the seeding updater so seed and
reset are one transition.

Key that state on the scope alone, not scope-plus-selection, or adding an item to
the selection discards edits to the items already there.

### 3. "Populated" is not "loaded" — track provenance separately

Readiness computed as `values[key] != null` is satisfied by an edit that built on
a default. Keep a `loaded` map set *only* by the server-response handler, gate
readiness on that, and disable the inputs until the key loads — an edit accepted
before the real value arrives silently discards every field the operator did not
touch. Guard in the reducer as well as the handler, so no path can get around it.

**How to apply:** block the save action while any selected key is unloaded or
errored, and say why. A save built on defaults overwrites real stored settings.

## Invalidation is not eviction

`invalidateQueries` marks data stale; it leaves it readable. Until the refetch
lands — or forever, if it is aborted by a scope change or fails — consumers still
see the pre-save value, can treat it as loaded, and can save it back over what
was just written.

**How to apply:** on a successful save, write the acknowledged payload into the
cache with `setQueriesData` *before* invalidating, so the only thing left to read
is already correct. Match every entry for that scope, not just the current
selection's, when entries are also keyed by the selection.

**Trap:** TanStack matches array-key *prefixes*, not substrings. A key like
`["/api/x#sub-thing", ...]` looks related to `["/api/x"]` and is invalidated by
nothing. Use `["/api/x", "sub-thing", ...]` so the existing invalidation reaches
it, and leave a comment saying why, or it gets "tidied" back.
