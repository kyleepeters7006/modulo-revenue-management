---
name: Competitor payload aggregation traps
description: Two recurring defect classes in the competitor rate payload — map-reduce branch drift, and fabricated fallback rates in the map popup.
---

# Competitor payload aggregation traps

## 1. Init/accumulate branch drift

The competitor payload is built by map-reduce over survey rows: a branch that
**creates** the competitor entry and a branch that **appends** to an existing
one. Both branches independently construct the per-room-rate objects.

**Rule:** any field added to the room-rate object in the create branch must be
added to the append branch in the same edit.

**Why:** a care rate was added to the create branch only. The result was silent
and highly plausible-looking: the *first* room type of every competitor got a
care adjustment and every later room type showed none. Nothing errored, no row
count changed, and it was invisible in the demo tenant (which has zero care
rates), so only a real tenant would ever see it.

**How to apply:** there is more than one of these aggregations (a filtered path
and an unfiltered "all locations" path), each with two branches. Adding a field
means four edit sites, not one. After changing the payload shape, assert that
every row carries the new key — not that the key is non-null, since a legitimately
absent value is null.

## 2. Never default a missing rate to a plausible number

**Rule:** if a rate needed for a comparison is missing, render an em dash and
suppress the comparison. Never substitute a stand-in value.

**Why:** the map popup's fallback defaulted a missing competitor or portfolio
street rate to $3,500 and a missing care rate to $500. It then rendered a
confident, colour-coded "vs. Portfolio Average" dollar figure computed entirely
from those placeholders — indistinguishable from a real surveyed comparison.
A blank cell is recoverable; a fabricated rate that a pricing decision is made
against is not.

**How to apply:** applies to any surface showing a rate the user might act on.
Missing input means no output, not a guessed input.

## 3. Rate math belongs on the server

The browser formats; it never derives. When a popup or panel is rebuilt around a
server-computed breakdown, delete the old client-side arithmetic rather than
leaving it as a fallback — dead rate math (monthly to daily conversions in
particular) survives rewrites, stops being rendered, and is then resurrected
later by someone who assumes it is still correct.
