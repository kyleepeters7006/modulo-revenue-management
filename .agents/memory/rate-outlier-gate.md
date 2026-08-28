---
name: Relative rate outlier gate (two-level)
description: Why aggregate rate filters are relative and two-level, and why resident-level in-house planning must not use them to remove people.
---

# Relative rate outlier gate

Rent-roll street/in-house rates contain junk: positive but absurd values (a $159
studio next to $4,000 ones), usually prorated partial months or feed artifacts.
Aggregates must exclude them. The gate is **relative and two-level**, defined in
ONE place, and every rate-averaging surface builds its predicate from that module.

## The rule

- **Level 1** — drop a rate below a fixed *ratio* of the median for its own
  location + service line.
- **Level 2** — when a location's own median is itself below that ratio of the
  **portfolio median for the same service line**, judge its rows against the
  portfolio median instead.

Medians, never averages: an average is dragged down by the very outliers being
detected. Companion/B-bed rows are excluded from the baseline so a half-price
second-occupant rate cannot depress the reference level.

**Why relative, not a dollar floor:** an absolute floor cannot distinguish
genuinely low-priced inventory from a bad row. Health-care lines are priced per
DAY, so any floor in the hundreds blanks the entire service line and needs a
carve-out; the cheaper senior lines then lose real inventory to the same floor.
A ratio needs no carve-out.

**Why two levels:** level 1 alone is blind when EVERY row in a group is junk —
the junk defines its own baseline and passes its own test. This is not
hypothetical: a real campus had an entire service line imported at roughly a
twentieth of the portfolio rate, and a one-level gate published it as a genuine
rate. Level 2 is the only thing that catches it.

## Four traps

1. **The level-2 population must NOT inherit the caller's
   location/region/division filters.** If it does, drilling into a single campus
   collapses the portfolio yardstick onto that same campus and silently disables
   level 2 — exactly when a user is looking closely at it. Keep a separate
   portfolio-scope predicate (tenant + month + service line) alongside the
   display predicate. There is a regression test for this; keep it.
2. **A baseline must be drawn from the same population it filters.** The
   in-house gate applies only to occupied rows, so its median must be
   occupied-only too, or vacant-row noise decides which occupied rates survive.
3. **The gate applies to the RATE, never to the unit count.** A junk rate does
   not make the room stop existing. Weight room-type averages by *distinct
   physical rooms* (companion suffixes collapsed), not by surviving rows.
4. **A wholly-gated group must leave both numerator and denominator** of any
   unit-weighted roll-up, or its units silently re-weight the room mix.

## How to apply

- Never hand-copy the predicate into a new query. Import the shared builder.
- Use the gate for rate aggregates, not resident eligibility. In-house planning
  must retain every occupied resident with a positive current rate even when
  that rate fails the plausibility gate.
- Expect a small number of groups to go blank rather than report a wrong number.
  On real data this was a handful portfolio-wide, each a single row far out of
  line with its own campus. Blank is the correct output there.
- Changing the basis shifts published averages by a percent or two overall but
  moves a large minority of individual groups. Re-baseline cross-surface
  tie-outs after any change to it.

**Why:** The operator explicitly chose complete resident coverage over removing
low-but-positive source rates. A suspicious rate can be reviewed later; silently
omitting its resident makes the plan incomplete.

**How to apply:** Treat plausibility as an aggregate-quality rule. At the
resident level, preserve the source rate and continue applying the ordinary
minimum, maximum, and street-cap guardrails.
