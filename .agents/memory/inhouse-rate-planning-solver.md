---
name: In-house rate planning solver
description: Non-obvious traps in the joint street/in-house rate solver — bisection tolerance, guardrail direction, zero-vs-missing weights, and untestable baselines.
---

## Solve against the target exactly; apply the reporting tolerance only afterwards

A bisection that searches for "the smallest increase that clears the target" must
test `margin >= 0`, not `margin >= -epsilon`.

**Why:** the reporting epsilon leaking into the search returns the lowest answer
that passes *with slack*, which then re-projects a hair short of the target and
gets reported as infeasible. The plan and its own verdict disagree.

**How to apply:** any bisection whose result is later re-verified by the same
projection function — solve exact, round/tolerate at the presentation edge.

## An operator's ceiling clamps a derived floor, never the reverse

The street increase has a natural floor (the growth target) and an operator-set
ceiling (`maxStreetIncreasePct`). The floor must be clamped by the ceiling.

**Why:** a floor that ignores a zero ceiling silently overrides the operator's
"do not raise street rates" instruction and then misattributes the resulting
infeasibility to a resident max-increase constraint, pointing the operator at
the wrong knob.

**How to apply:** whenever a derived bound meets a user-specified bound, the
user's wins, and the binding-constraint report must name the user's bound.

## `computed || fallback` erases a legitimate zero

Resident weight is stay-days overlapping the horizon. `stayDays(...) || horizonDays`
gives a resident who moves out *before* the plan starts the FULL horizon weight —
the one case where zero was the correct, informative answer.

**Why:** `||` cannot distinguish "not computed" from "computed to zero", and a
zero-overlap resident is exactly the person who should be dropped.

**How to apply:** branch on whether the *input* is missing (no move-out date on
file → full horizon) rather than on whether the *output* is falsy.

## A quarter with no prior-year rate is not a passing quarter

Feasibility is measured per quarter as year-over-year growth. Quarters lacking a
prior-year baseline must be excluded from the test AND surfaced — and if none of
the horizon quarters are testable, the plan is unverifiable and must refuse to
report "feasible".

**Why:** skipping untestable quarters silently leaves a neutral worst-margin, so
a plan with no measurable baseline at all reads as feasible and can be approved.

**How to apply:** distinguish "passed", "failed", and "could not be evaluated";
never let the third collapse into the first.

## Scope fallback chains must enumerate every tier the writer can produce

Saved assumptions are scoped by (location, service line), either of which can be
NULL. A read chain of location+SL → location → global misses the
(NULL location, non-NULL SL) row the UI writes for "all campuses, one service
line": the save succeeds and the value is never read back.

**How to apply:** enumerate the read tiers from the writer's actual key space,
not from the ones that seemed likely.
