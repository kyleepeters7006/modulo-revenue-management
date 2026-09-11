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
and keep app, diagnostics, exports, and tests on the same policy. Never give an
at/above-street resident a literal zero allocation weight: use a positive floor
so the curve can still reach that resident's allowed maximum when required.

**Why:** a zero shape permanently held those residents at the minimum while the
feasibility search still counted their configured maximum as achievable. That
made a plan report infeasible even when its displayed required average was below
the displayed achievable average, and prevented the Street Rate search from
behaving consistently.

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

The prior January comparison must use the January immediately before the plan
year, even when the Street Rate takes effect in the preceding fall, and must be
standardized to today's eligible room mix.

**Why:** treating today's Street Rate as a fresh baseline ignores increases
already taken during the year. Conversely, using the Street effective-date year
minus one can select January two years before the plan, while independently
weighted January/current averages turn payer and product-mix changes into fake
price movement.

**How to apply:** match today's eligible private-pay base rooms back to the same
physical rooms in the January immediately before the plan year, translate the
absolute ceiling into remaining headroom from today's rate, then clamp the
search by both limits.

Three rules make that room match trustworthy:

- **Deduplicate rooms before joining.** The rent roll has no uniqueness
  constraint on (client, month, location, service line, room); a raw row-to-row
  join fans out and over-weights duplicated rooms. Collapse each side to one
  row per room key first.
- **Average both months over the matched set only, and use the RATIO.** An
  inner join drops rooms with no January match, so a matched January average
  compared against an all-rooms current average silently reintroduces the mix
  effect it was meant to remove. Apply the matched ratio to today's full street
  average instead, and warn when match coverage is low.
- **Do not payer-filter the historical side.** A room moving from Medicare to
  private pay is precisely the artifact being removed. Hold the historical side
  to the same base-product and plausibility rules, but not the same payer.

## Favor in-house growth; portfolio service lines keep a 1% Street premium

Growth is taken from in-house resident increases wherever the guardrails allow.
The quarterly growth target is NOT a Street Rate floor. Street only moves for
one of three reasons: the operator's configured minimum, a positive gap to the
desired position versus the Top Competitor, or in-house being exhausted while
quarters still fail. Competitive pressure is capped at the growth objective.

For a whole-portfolio service-line plan only, the resident-weighted recommended
Street Rate must finish at least 1% above that service line's resident-weighted
planned in-house average. This is not a location-level rule.

**Why:** using the growth objective as a street floor raised the asking rate by
the full target on every scope, even when resident increases alone cleared every
quarter. Letting competitive pressure exceed the objective pushed Street Rate
too hard despite weaker sales certainty. Conversely, enforcing the 1% premium
at every location needlessly raised local asking rates; the product owner
explicitly confirmed that the relationship is by service line at portfolio level.

**How to apply:** anchor the planned average in-house increase at the growth
objective within resident guardrails. Keep the Street floor at the maximum of
the configured minimum and the positive competitive gap capped at the objective;
let feasibility pull Street higher only as a last resort. Apply the 1% premium
only when location scope is absent, and keep both Street ceilings authoritative.
Warn if a ceiling prevents the service-line portfolio premium. Individual
locations and residents may legitimately finish above Street Rate.

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

The quarter record itself does not carry that third state: an untestable quarter
is stored with zero growth and a passing verdict. Any surface reading those
fields — a table cell, an average, a resident-weighted roll-up — must gate on
whether the prior-year quarter has a realized rate, not on the growth number
being finite, or it renders a fabricated passing 0% and weights it into totals.

## Missing-quarter projections continue the latest observed trajectory

When a future prior-year quarter is missing, anchor its projection on the latest
observed quarter, including a partial quarter, and continue the growth between
the latest two observed quarters.

**Why:** ignoring a partial Q3 and extrapolating an old whole-history trend from
Q2 treats Q4 as two missing quarters and can create a large jump despite the
current July/August run rate being nearly flat.

**How to apply:** use actual and partial quarters as observed trend points, keep
the extrapolated result labelled projected, and never present the partial anchor
or projected result as a complete actual quarter.

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

## Top Competitor position is a directional floor, not a ceiling

Calculate Plan jointly solves Street Rate and resident increases. Its desired
variance to Top Competitor converts the matched benchmark into a target rate and
can push an underpriced scope higher; it must never cap Street Rate or resident
increases. A configured minimum Street Rate increase is also a floor.

**Why:** the competitive assumption expresses where the operator wants the rate
to move toward, while the current-rate maximum and January-to-January maximum
are the explicit safety limits. Treating the competitor target as a ceiling
silently blocks valid growth above the market benchmark.

**How to apply:** combine the configured minimum and the positive gap to the
desired competitor position as candidate floors, then clamp the result only by
the two Street Rate guardrails. The growth objective is deliberately not among
them — see "Street Rate is the last lever". Missing competitor data removes only
the competitive signal; ordinary calculation continues.

## Rate weighting follows the billing basis

Senior-housing service lines use resident-month weighting for both historical
quarter baselines and forward quarter projections. HC and HC/MC use
resident-day weighting. Daily turnover simulation may remain for timing
precision, but each senior-housing calendar month's daily slices must sum to
one month so February does not receive less weight than a 31-day month.

**Why:** senior-housing rates are monthly while health-care rates are daily.
Using one resident-day basis for both creates artificial quarter differences
from calendar length rather than pricing.

**How to apply:** keep historical calculations, solver projections, room-level
reconciliations, and exports on the same service-line basis. Room audits must
label future occupants as modeled replacement shares—their identities are not
known—and their weighted total must reconcile to the quarter headline.
