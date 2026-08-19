---
name: Dead vs live rate columns on the rent roll
description: rent_and_care_rate is a dead column; in_house_rate is the live one. Zero-vs-NULL means demo data hides the bug that production data exposes.
---

# Dead vs live rate columns

The in-house rate lives in **`in_house_rate`**. The `rent_and_care_rate` column is
effectively dead — it carries no value for any real client.

**Why:** it survives from an earlier import shape. Nothing populates it now, but it
is still selected and read in places, so it looks like a legitimate source.

**How to apply:** when a surface needs the in-house / resident-paid rate, read
`in_house_rate`. Treat any code reading `rent_and_care_rate` as suspect and verify
against the data before trusting it.

## The trap that makes this expensive to find

The dead column is **literal `0` for the real client but `NULL` for the demo client**.
That difference decides whether a fallback fires:

- SQL `COALESCE(dead, street)` falls through only on `NULL` → returns `0` on real data.
- JS `dead || street` treats `0` as falsy → silently falls through to the street rate.

So a surface that means "in-house rate" quietly renders the **street rate** instead.
It does not error and it does not look empty — it looks plausible. The giveaway is
that the in-house metric becomes *byte-identical* to the street/ADR metric, and any
in-house-vs-street variance collapses to exactly zero.

**Verify like this:** compare the two metrics numerically. Identical series across
every month is the signature, not an artifact.

## Broader lesson: demo data masks production-shaped bugs

Demo/seed data is uniform and synthetic; the real client's data is messy. Several
divergences are invisible on demo and only appear on real data:

- Zero-vs-NULL in a column, as above.
- Aggregation choices (mode vs mean) agree on uniform demo data and diverge on real
  distributions.

**Always confirm a data-shape finding against the real client's rows**, not the demo
client, before concluding a surface is correct.

## Measure aggregation differences at the real grouping level

When comparing two aggregation methods (e.g. mode vs mean), compute the difference at
the **granularity the code actually groups by**, not at a coarser level. Measuring at
a coarse level (like whole service line) exaggerates the gap by an order of magnitude
and produces a false alarm: a gap that looks like ~20% at service-line level can be
under 2% at the real per-location/room-type grouping.
