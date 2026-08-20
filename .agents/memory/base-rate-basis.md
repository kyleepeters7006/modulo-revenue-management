---
name: Base-rate basis (single occupant, standard stay)
description: What "the rate" means in Reference Data and rule design, why HC/HC-MC needed a second exclusion arm beyond B-beds, and the two traps in keeping the JS and SQL predicates identical.
---

# Base-rate basis

**The rule:** every rate shown in Reference Data or used as a rule-design baseline is the
*base rate* — one resident, one room, standard stay. Everything else (second occupant,
semi-private/companion, respite, rehab/TCU, bed hold, couple) is a separately-priced
product and must not be averaged into it.

**Why:** blending them makes the headline rate a function of bed mix rather than pricing.
HC was ~46% companion rows, so its street rate sat well below the actual single-occupant
asking rate and moved whenever the census mix moved.

## Two service-line families, two mechanisms

Senior housing (AL, AL/MC, SL, VIL) marks companions with a **letter-suffixed room
number** (`101/B`). Health care (HC, HC/MC) marks them with a **room type** — companion,
semi-private, ward, double, shared — plus short-stay products (respite, rehab, TCU,
"almost home", a brand name). The long-standing B-bed rule only ever matched the first
family, which is why HC silently kept every bed in its averages for so long.

**How to apply:** use the base-rate predicate for anything that *averages a rate*. Keep
the plain B-bed predicate for surfaces that must emit a row per physical bed — the
MatrixCare exporters need a rate for companion beds too.

## Payer scope is deliberately NOT part of the base-rate predicate

Street rate is an **asking** rate and is present on vacant units, where payer is NULL.
Filtering the base predicate by payer would drop every vacant unit. Payer scope belongs
only on the **in-house** (billed) rate, and only for HC/HC-MC, where Medicaid/Medicare
rates are set by programme and move independently of anything we price. Senior housing is
effectively all private pay and must stay unfiltered so its signed-off numbers do not move.

## Trap 1: word boundaries, because room types are campus-branded

Source room types look like `Legacy Lane - Private`. A substring match on `ward` deletes
a campus named Woodward from every average, with no error. Use `\b` in JS and `\y` in
Postgres. Note `ward`, `double`, `shared` and `tcu` are end-anchored too (so "Wardell"
survives), while `rehab` is intentionally start-only so "Rehabilitation" matches.

## Trap 2: a JS/SQL twin diverges on NULLs unless every column is COALESCEd

This is the subtle one. `service_line IN (...)` against a NULL yields NULL, so
`NOT (NULL AND TRUE)` is NULL, and a `WHERE`/`FILTER` clause **drops** the row because
NULL is not TRUE. The JS twin asks `SET.has(serviceLine || '')`, which is plainly false,
and **keeps** it. Rows from an incomplete import therefore vanish from grouped SQL
surfaces while remaining in the in-memory ones — two screens quietly disagreeing, no error
anywhere. COALESCE every column referenced in the predicate to `''`.

**How to apply:** any time you write a SQL predicate that has a JS counterpart, check the
nullable columns explicitly. Passing tests on non-null fixtures prove nothing here.

## Expected magnitude

Correcting the basis raises HC street rate roughly 6.8% (blended $387 → base $413) and
HC/MC similarly ($391 → $422). Senior housing must come out byte-identical — that is the
regression check, not a nice-to-have.
