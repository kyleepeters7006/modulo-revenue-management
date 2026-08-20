---
name: Derived rate formulas
description: Non-base rates are computed from the base rate via user-editable formulas; why they are outputs only, and the whole-set/transaction invariants the persistence layer must keep.
---

# Derived rate formulas

Six non-base products — second occupant, semi-private/companion, respite, rehab/TCU,
bed hold, couple — are **derived** from the base rate rather than measured independently.
The user edits `percent of base` and/or a `dollar offset` per type in a Data Management
panel; scope is portfolio-wide, with a nullable service-line column so per-SL overrides
can be added later without a migration.

## Derived rates are outputs, never inputs

They must never be read back into Reference Data or the rule designer as if they were
observed data. Doing so feeds the base rate its own result and compounds every change.
This is the same reason the base-rate predicate excludes these products from rate
averages in the first place — the two halves are one design.

## Round once, at the end

`base × pct + offset`, rounded once. Rounding the percentage and then applying the offset
produces off-by-a-dollar drift that surfaces as penny mismatches in exports.

Return **null**, not a plausible number, when a formula is disabled, the base is missing
or non-positive, or the result would be ≤ 0. A placeholder that looks like a rate is how
a wrong number gets billed.

## Persistence invariants worth keeping

**A save is the whole policy, not a patch.** Accepting a subset leaves the omitted types
on their previous values while the caller believes it wrote the complete set — the
portfolio ends up priced by a mixture of old and new policy with nothing recording which
was which. Validate that every type is present before writing.

**Pin the transaction to one connection.** Issuing `BEGIN`, the upserts, and `COMMIT`
through a *pool's* `query` spreads them across arbitrary backends: the BEGIN opens a
transaction that is never committed, the upserts autocommit individually, and a mid-way
failure leaves half the policy saved with nothing to roll back. Check out one client.

**Mutations cannot fall back to the demo tenant.** Read paths in this app answer
unauthenticated and default to `demo`; a mutation that inherits that default lets anyone
who can reach the server rewrite demo's pricing policy. Take the tenant from the session,
and 401 when there isn't one.

## Current state

The panel stores policy but **nothing consumes it yet** — the MatrixCare exports still
emit each bed's own recorded rate. The UI says so explicitly. Wiring the formulas into the
exports and rate calculation is separate work; if you do it, add an end-to-end test
proving a saved formula changes an emitted derived rate.
