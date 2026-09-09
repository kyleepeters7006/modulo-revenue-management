---
name: In-house rate planning solver
description: Non-obvious traps in the joint street/in-house rate solver — bisection tolerance, guardrail direction, zero-vs-missing weights, and untestable baselines.
---

## Use only base-rate rows and standardize prior periods to today's unit mix

In-house planning uses single-occupant, standard-stay base-rate rows only. Each
historical month's realized rate must be mix-standardized: measure historical
versus current rates on the same location+room keys, then apply that relationship
to today's full base-rate planning average before quarters are rolled up.

**Why:** blending companion, semi-private, respite, rehab, or TCU products creates
a rate no product actually sells. Even after excluding them, comparing a changing
historical occupancy mix against today's full population can manufacture YoY
growth or shortfall unrelated to pricing.

**How to apply:** use the shared base-rate predicate for current residents,
current Street Rate, and historical realized rates. Match historical rows to the
current base cohort and normalize each month to today's mix before calculating
quarterly YoY growth.

## The configured increase is a range ceiling, not a flat increase

Resident increases vary within the configured minimum-to-maximum range based on
each resident's variance to Street Rate. The maximum (for example, 9%) is an
individual ceiling, not a percentage applied uniformly to every resident.
Street Rate shapes the allocation curve but is never a resident-rate ceiling;
an in-house rate may legitimately finish above Street Rate.

**Why:** the product owner explicitly rejected applying the maximum to every
in-house resident. Residents farther below Street Rate should receive larger
increases, but contracted in-house rates and new-move-in Street Rates are distinct
products, so one must not cap the other.

**How to apply:** preserve the equalization curve and per-resident Street Rate
variance, while applying only the configured individual maximum as the upper
bound. Ignore legacy saved values that attempted to disable above-street rates,
and keep app, diagnostics, exports, and tests on the same policy.

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

## January-to-January street ceiling includes increases already taken

The annual-plan solver has two distinct Street Rate limits: the maximum increase
from today's rate, and the maximum proposed January rate versus January of the
prior year. The tighter remaining allowance wins. If today's rate has already
reached the Jan-to-Jan ceiling, the solver must not push it further.

**Why:** treating today's Street Rate as a fresh baseline ignores increases
already taken during the year and can produce an excessive year-over-year move.

**How to apply:** use January of the year before the Street Rate effective date
as the baseline, translate its absolute ceiling into remaining headroom from
today's rate, then clamp the search by both limits. Refuse to calculate when
that January baseline is unavailable; never substitute another month or flatten
resident-specific increases.

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

When the UI requests several service lines together, an unavailable line must not
discard valid plans for the other lines. Calculate each line independently, show
successful results, and report skipped lines; a request for one unavailable line
should still fail clearly.

**Why:** campuses commonly do not offer every portfolio service line, so
`Promise.all` turned one legitimate "no occupied rows" response into a misleading
whole-page calculation failure.

**How to apply:** use settled per-line requests for the multi-line calculate action,
while retaining the server's precise `PlanningDataError` for the skipped-line message.

## Annual street and in-house decisions are one proposal

An annual plan's street recommendation and resident-specific in-house increases
must move through review and publication as one linked pair. Editing either half
means recalculating and resubmitting the whole plan; never flatten the resident
allocations into one percentage or let a generic street-rule edit detach them.

**Why:** each resident increase was solved against the proposed Street Rate and
their individual headroom. Publishing only one half, or changing Street Rate
without recalculation, invalidates the resident-level result.

**How to apply:** keep submitted plans inert until both linked proposals are
implemented and both effective dates are due. Replace any prior unpublished pair
for the same scope on resubmission, clear its derived rule rates if it had been
implemented, and publish/apply/archive the complete pair atomically.
