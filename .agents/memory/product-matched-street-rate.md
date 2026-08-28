---
name: Product-matched street comparison
description: Why resident-level rate work must compare against the street rate for the same bed product, and the vacant-companion trap in product medians.
---

# Judge a resident's rate against their own product

A resident's paid rate may only be measured against the asking rate for the
**same product** — second occupant, semi-private/companion, respite, rehab/TCU,
or single occupant — never against the single-occupancy base rate.

**Why:** the base-only plausibility baseline (a location + service-line median
with B-beds excluded) is right for aggregates and wrong for people. A villa
second occupant asks about a sixth of the villa base rate; measured against the
base median their perfectly correct rate looks like corrupt data, fails the
outlier floor, and the resident is then planned with **no ceiling at all** —
silently, since a discarded rate looks identical to a missing one. On one real
portfolio month this hit 277 senior-housing companion residents at once.

**How to apply:** any resident-level surface that gates or caps against a
street rate needs a product classification first, then a product-specific
reference level. Aggregate surfaces can keep using the base-only baseline;
that is what it is for.

# Vacant companion rows carry the whole room's rate

A product median must measure **occupied rows only** for every non-base
product. The base product may keep its vacant rows.

**Why:** a vacant companion bed is not being sold as a second occupant — the
whole room is empty, so the row simply carries the room's own asking rate. Real
data reads roughly six times the occupied companion level, and letting those
rows into the median produces a "companion street rate" close to the base rate,
which quietly undoes the entire point of matching by product. Health-care
semi-private beds do not show the effect (vacant and occupied agree), so a
spot-check on one service line will not reveal it.

# Fallback order, and saying which one was used

Resolution order is: the row's own asking rate → the product median at that
campus → the product median across the service line → the configured
derived-rate formula applied to the base rate. Report which one was used on
every surface (screen, explanation, export) and keep the campus and
service-line medians as **distinct** sources.

**Why:** a ceiling set by other buildings, or by a formula, is weaker evidence
than this unit's own asking rate, and an operator auditing a recommendation
cannot tell the difference from the number alone. Labelling a service-line
median "campus median" is the kind of small dishonesty that destroys trust in
the whole plan when someone checks it.

**Note:** derived rates stay outputs, never inputs — the formula fallback caps
one resident and is never fed back into an average.
