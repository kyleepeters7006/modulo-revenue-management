---
name: Rule Administration display order vs priority order
description: Why the Rule Administration table's row order must never be used to derive the numbered priority badges, and the tier rule that keeps disabled rules out of the way.
---

# Display order is not priority order

The Rule Administration table (Rule Designer) lets the user sort by any column.
Row order therefore says nothing about rule precedence.

**Rule:** the numbered amber priority badges must always be derived from the canonical
active-rules ordering, never from whatever list is currently rendered. Sorting and
filtering apply to a *separate, freshly allocated* array; the canonical array stays
untouched.

**Why:** exclusive rules resolve by priority — the first matching rule claims a unit and
later ones are dedup-excluded. If display sorting reordered the canonical array, the
badges would renumber whenever the user clicked a column header, implying the pricing
engine had changed behaviour when nothing had. The badge number is a statement about the
engine, not about the screen.

**How to apply:** any new sort/group/filter feature on this table must (a) sort a copy,
(b) keep the canonical order available as a stable tiebreak, and (c) leave a visible hint
that the badges still carry priority once a non-priority sort is active.

# Status tiering

Sorting keeps a primary tier of active → disabled → historical that is *not* inverted
when the direction flips, so toggling to ascending never floats switched-off or archived
rules above live ones. Consequence worth stating in the UI: the default "highest revenue
first" is highest-revenue *within each status tier*, not globally.

# Tiebreak direction

Only the chosen column reverses with direction; ties fall back to canonical priority
ascending in both directions. Multiplying the tiebreak by the direction too makes equal
rows (very common — many rules have $0 monthly impact) shuffle on every toggle, which
reads as a bug.

# Service line shape

A rule's target service lines come from `serviceLines`, falling back to
`action.filters.serviceLine`. The latter has a legacy **single-string** form. A bare
string has `.length`, so the common `x?.length ? x : []` guard passes it straight through
and it later reaches `.some()` / `.join()` and throws. Always normalize to an array
before consuming it.
