---
name: Annual increase columns in Reference Data
description: How applied in-house increase plans surface in the Reference Data grid, why room number is not a resident identity, and why the increase must not touch move-in revenue impact.
---

# Annual increase columns in Reference Data

Applied in-house rate plans surface as their own column group beside the rule
columns, and take over the **Final** rate for the occupied rooms they cover.
Precedence for Final is: manual override → applied increase → stored rule rate
→ rule preview.

## A room number is NOT a resident identity

The same room number appears under **several different room types** at one
campus (observed across three room-type groups at a single campus). Keying a
resident on `location + serviceLine + roomNumber` therefore does two bad things
at once: distinct residents collapse onto one map entry, and the entry then
matches rent-roll rows in the *wrong* room-type group.

The identity that works is `location + serviceLine + roomNumber + RAW room type
+ move-in date`. The room type must be the raw `rent_roll_data.room_type`, not
the branded `room_type_groupings.group_name` the grid displays. The planner
itself keys residents on room number + move-in date for the same reason.

**Why:** without the room type in the key, coverage exceeded the number of
occupied rooms in a group (16 residents reported in a group with 14 occupied
rooms) because several rent-roll rows all matched one plan entry.

**How to apply:** when joining stored plan residents back to the rent roll,
drive the loop from the **plan's residents**, not from rent-roll rows. Walking
the rent roll counts a resident once per matching row, so double counting is
possible; driving from the plan makes each resident contribute exactly once by
construction.

## Two bases coexist in this column group — never mix them

A stored resident carries both `*Monthly` and `*Display` values. `*Display` is
daily for HC/HC-MC and monthly for senior housing — exactly what
`rent_roll_data.in_house_rate` holds. Both bases are needed at once:

- **Rate and Δ$ columns → display basis**, so they are comparable to the
  in-house rate column beside them. Using the monthly value puts an HC figure
  ~30x above its neighbour. Sanity check: demo HC in-house rates average ~333
  (daily) against AL ~6100 (monthly).
- **Any revenue/impact column → monthly basis, always.** Summing the display
  delta and labelling it "monthly impact" understates HC by ~30x. This is easy
  to miss because it is exactly right for senior housing and silently wrong for
  daily-billed lines.

A ratio (Δ%) is basis-independent, but only if numerator and denominator come
from the *same* basis — deriving it from a monthly impact over a display rate
reintroduces the 30x error.

**How to apply:** carry the display delta and the monthly delta as separate
fields all the way through the accumulators and the client-side roll-up, and
have a test assert `monthlyImpact / (Δ$ × residents)` equals DAYS_PER_MONTH on a
daily line and 1 on a monthly one. A single test scope cannot catch this.

## Averages are over covered residents, never over units

A plan only touches occupied rooms, so a group's average increase must divide
by residents covered, not by the group's unit count — otherwise vacancy dilutes
the rate toward zero. Publish the coverage count alongside the rate so it is
visible rather than implied. Roll-ups re-derive from summed components
(residents-weighted), and Δ% is total increase dollars ÷ total current rate, not
an average of percentages.

## The increase must not reach move-in revenue impact

Revenue Impact is `(proposed − street) × T3 move-ins`: it models **new leases at
a street rate**. An annual increase reprices **sitting residents**, so pushing
it through that formula fabricates revenue. Final may show the increase, but the
impact columns must keep using the rule/street-based rate.

The increase's own honest impact is `covered residents × monthly delta`, kept in
a separate column. The two impact numbers are **not additive** — they measure
different populations.

**How to apply:** keep a separate `streetBasisProposed` (manual override → rule
rate → preview) for the impact math even after Final starts showing something
else. The detail endpoint's group-impact map must use the same basis or
detail↔grouped parity breaks.

## Cache

Reference Data responses are cached for minutes at a time. Any new write path
that changes what the grid shows has to invalidate that cache — applying a plan
originally did not, so a freshly applied increase showed stale columns until the
TTL lapsed. Check invalidation whenever a new source starts feeding the grid.
