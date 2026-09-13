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

### Standardization is a direct two-point quarter comparison

The current engine compares exactly two quarters — a prior-year quarter and the
latest complete one — with no chain-linking, no compounding, and no 12-month
survival requirement. A room is matched only if it has a valid rate in all three
months of *both* quarters; a quarter's rate is the simple average of its three
monthly rates. Ratios are computed inside strata (unit type x care level x price
band) and only then aggregated on fixed weights, renormalized so every stratum
carries full weight however few of its rooms matched. The ending quarter is the
latest quarter with all three months present, which rules out both the
in-progress quarter and any quarter with a missing upload.

Chain-linking, the Fisher composite, and the separate backcast view were deleted.
Dropping the survival requirement roughly doubled matched coverage on the worst
service line.

**Why:** requiring a room to survive a long window makes coverage collapse on
exactly the service lines with the most turnover, and chaining compounds every
intermediate period's error into the endpoints. Two points need only two points.

**How to apply:** adjudicate eligibility ONCE at the ending quarter and take base
rates exactly as recorded — never re-gate or impute the historical side, or the
churn the standardization exists to remove comes back in through the divisor.

### Which weights go on which side is the easiest thing to get wrong

Three distinct weightings coexist and are not interchangeable:

- **Within a stratum**, both sides of the ratio use the ENDING weight, so the
  stratum ratio is a pure price comparison and no occupancy change leaks into it.
- **The primary aggregation** combines stratum ratios on ending-quarter weights.
- **The secondary aggregation** must combine them on the BASE quarter's own
  weights — base weight times base rate. Reusing the ending weight here (easy to
  do, since the matched loop already has it in hand) makes the secondary figure
  and therefore the reported composition spread quietly wrong whenever occupancy
  moved between the quarters.

The spread between primary and secondary IS the composition effect, so an error
in the secondary basis is invisible in the headline and shows up only as a
mis-attributed mix number.

### A matching query has stricter row hygiene than an aggregate query

Two rules that other rent-roll queries can ignore:

- **A row with no room number must be dropped outright.** Elsewhere those rows
  can fall into a per-location bucket harmlessly. Here they collapse into one
  synthetic room that matches *itself* across the two quarters, inventing a price
  observation from two unrelated residents.
- **A room-month is worth one room-month on the monthly basis**, however many
  rows the import produced for it. Summing row weights lets a duplicated row
  count its room twice, in both the ratio and the stratum weight. On the daily
  basis the extra rows are genuine companion residents, so there they do sum.

### "Never recorded" must be read from the raw upload, not the filtered series

Whether a quarter was recorded and whether it can be measured are different
questions. A quarter that was uploaded but whose rows all failed the eligibility
gate deserves a withheld number and a reason; a quarter that was never uploaded
deserves a projection. Deciding between them from the already-filtered monthly
series conflates the two and silently extrapolates over real data.

Scope that presence query to the months actually being asked about — an unbounded
`DISTINCT upload_month` over a client's whole rent roll is a seq scan on every
plan build.

### A fallback that ignores the gates must say so

When a scope is small enough that every stratum fails its gate, the engine falls
back to the ungated stratified ratio rather than refusing to plan. That result
must carry its own basis label end to end. Reusing the "actual" label because the
number came from real rows produces a plan that reads as measured to every
downstream surface while its own diagnostics say otherwise.

### Thresholds were set by measurement, not judgement

The coverage floor was swept across all six service lines: the YoY answer holds
flat from floor 0 through 60, then breaks at 70 where one line jumps by 1.3
points while discarding 43% of its rooms. 60 is the last stable value, not a
round number someone liked. Apply the count gate BEFORE the percentage gate — a
percentage over a handful of rooms measures portfolio size, not data quality.

**How to apply:** if you change a threshold, re-run the sweep. The defensible
value is the last one where the answer is still stable, and that fact belongs in
a comment next to the constant.

### Historical note: why the cohort approach was replaced

Dividing each historical month by the current rate of the rooms that qualified
*in that month* is composition-sensitive, because which rooms qualify changes
every month. Requiring a room to qualify in every month of a long window fixed
that but cost too much coverage — which is what the two-point design replaces.

**Why:** payer scope, the base-rate exclusions and the relative outlier gate move
rooms in and out while occupancy is flat. A few hundred low-current-rate rooms
leaving lifted the divisor about 2%, which pushed the standardized series down
and fabricated a quarter-over-quarter rate *decline* out of raw monthly rates
that were flat to the dollar. Because that series is the YoY denominator, it also
flattered the following year's reported growth by roughly a point. Averaging
per-room ratios instead of taking a ratio of sums does not fix it — the churning
rooms still enter and leave.

**How to apply:** the guarantee to test is on the divisor, not on any rate: with
the cohort fixed it must be flat across the window. Check the unrestricted
divisor in the same test, or the guard passes no matter what the code does. Fall
back to the per-month set only when no room survives the whole window, and say so
in a warning; the standardized level is still anchored to the full planning
average, so a partial cohort supplies only the price relationship.

The retired cohort/balanced-panel method must not run as a parallel diagnostic
inside an interactive calculation.

**Why:** across six portfolio service lines, those unused cohort queries were
the dominant source of latency and did not change the active solver result.

**How to apply:** keep the old reader available for dedicated validation, but
exclude it from the user-facing request path.

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
The default medium curve closes one common proportion of each resident's
product-matched Street gap, then calibrates one scalar so those resident
increases reconcile exactly to the service-line revenue-weighted target. Low is
flat; high favors the deepest discounts more aggressively.

### Every calculation endpoint is a read-only POST

The single-plan, batch-plan, single-tier, and batch-tier endpoints are all
read-only calculations. Authentication middleware must classify every one of
them consistently rather than treating the newer POST routes as mutations.

**Why:** allowing only the original calculator through made the tier grid fail in
demo mode even though it writes nothing, while saving assumptions and approving
plans correctly remained protected operations.

**How to apply:** when adding a calculation route, update the explicit read-only
POST allowlist at the same time. Never broaden the exemption to the whole
in-house-planning route family because that also contains writes.

### The measured occupancy tier must produce the primary plan

The occupancy-tier grid and the resident recommendation cannot be separate
solver paths. Load a service line once, solve its three tier what-ifs, and use
the plan from the tier selected by measured occupancy as the primary result.
The same effective tier guardrails must be used when exporting or submitting.

**Why:** when the grid alone received tier inputs, it could show a 5% resident
maximum while the separately calculated primary plan still used the old 9%
general maximum. Running both paths also doubled the expensive data preparation.

**How to apply:** every resident explanation must name the measured occupancy,
selected tier and tier range. Assert that every tier-varying input reaches the
primary plan and that no resident exceeds the selected tier's maximum. If
occupancy is unavailable, retain the service-line assumptions and warn rather
than guessing a tier.

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

## An operator's ceiling clamps a derived Street floor, never the reverse

The Street increase has derived floors from the configured minimum and
competitive position, plus an operator-set ceiling. Every derived floor must be
clamped by the ceiling.

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

## Jointly fit the quarterly target before preferring either lever

Street and in-house increases are candidate combinations, not two sequential
targets. For each bounded Street candidate, solve the resident allocation
against the full quarterly projection, including effective dates, turnover, and
replacement Street Rates. Rank feasible candidates by maximum quarterly excess
first, then cumulative excess; use a small material-equivalence tolerance before
using market positioning and dependable in-house revenue as tie-breakers.

Configured minimums, resident maximums, the January-to-January ceiling, and
data-validity gates remain hard constraints. Competitive position and the
portfolio-level 1% Street premium are soft preferences: they may select among
similar target fits but must not manufacture avoidable growth. Location-level
plans do not inherit the portfolio premium.

**Why:** solving only the hardest quarter can leave later quarters several
points above target when replacement residents enter at a rising Street Rate.
The rejected zero-turnover overlay had the same double-counting problem. A
joint quarterly comparison preserves dependable in-house revenue without
turning Street Rate or modeled turnover into automatic excess.

**How to apply:** search the valid Street interval, re-run the in-house
allocation for every candidate, and keep the best complete projection. Keep
the selected binding quarter and a plain-language note when excess is caused by
the modeled Street/turnover path or a binding guardrail. Do not introduce
days-vacant or time-to-sell as solver inputs until their grain, provenance,
coverage, scale, and missing-data behavior are validated.

The daily projection is affine in the pre-increase in-house rate, post-increase
in-house rate, current Street Rate, and proposed Street Rate. Cache those
coefficients once per Street candidate; never run a full daily simulation
inside the in-house bisection.

**Why:** a bounded Street search with a daily simulation inside every
bisection step turned portfolio planning into a request-timeout risk.

**How to apply:** keep the coefficient model numerically equivalent to the
daily cohort simulation, and guard the candidate/model counts in regression
tests so future changes do not reintroduce nested full projections.

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

Partial prior-year quarters are a fourth state for summary reporting: they have
a finite ratio and must display that numeric YoY beside a `Partial (n/3)`
qualifier, but they are not complete
quarter-over-quarter measurements. Exclude them from quarterly averages, goal
deltas, and measured-quarter counts; use the same eligibility rule for combined
service-line roll-ups.

**Why:** two months of a quarter can produce a plausible ratio that is not
comparable with a full three-month quarter. Including it makes the summary look
more measured than the underlying baseline.

**How to apply:** separate displayability from summary eligibility. A finite
partial value belongs in the quarter breakdown, while summary values require a
complete measured quarter rather than merely finite growth or a positive prior
rate.

## Missing-quarter projections continue the latest observed trajectory

When a future prior-year quarter is missing, anchor its projection on the latest
observed quarter, including a partial quarter, and continue the growth between
the latest two observed quarters.

**Why:** ignoring a partial Q3 and extrapolating an old whole-history trend from
Q2 treats Q4 as two missing quarters and can create a large jump despite the
current July/August run rate being nearly flat.

**How to apply:** use actual and partial quarters as observed trend points, keep
the extrapolated result labelled projected, and never present the partial anchor
or projected result as a complete actual quarter. A needed partial prior-year
quarter must remain in the baseline map with its original quarter label, weighted
rate, available-month count, and `partial` basis; do not drop it and then create
a null or wrong-year projected placeholder for that same horizon row. Normalize
the partial quarter to today's planning mix before rolling it up; using its raw
occupied-resident average mixes composition into price and compounds the false
jump into the next projected quarter.

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
