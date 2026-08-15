---
name: Diagnosing an adjustment rule that impacts zero units
description: A rule showing 0 impacted units is usually correct, not broken — four distinct causes, how to tell them apart, and the overlapExcludedUnits trap.
---

When a user asks "why does this rule show 0 impacted units?", do not assume a counting bug. On a
real portfolio most zero rules are correct. There are four genuinely different causes and they
need different answers:

1. **No matching units** — scope + action filters (room type, vacancy status) match nothing, so
   the triggers never even get evaluated.
2. **Suppressed** — the rule qualifies units, but a higher-precedence rule claimed all of them
   first, so the impact is attributed to that rule instead.
3. **A condition is never met** — one trigger condition matches no unit on its own.
4. **Conditions never co-occur** — every condition matches units individually, but no single unit
   satisfies all of them simultaneously. This is the sneaky one: both halves look reasonable in
   isolation, so the rule reads as sensible while being permanently dormant.

Distinguish 3 from 4 by re-running the impact calculation with one condition at a time. Distinguish
1 from the rest by running it with the trigger removed entirely.

**Why:** a bare "0" with no explanation reads as a broken rule and generates support questions.
It also hides the real product problem — a rule whose thresholds are set outside the range the
portfolio actually occupies (e.g. an 85% occupancy gate on a service line running at 47%).

**How to apply:**
- Before proposing to change or delete a dormant rule, work out which of the four causes applies
  and how far out of range the threshold is. Retuning a threshold is a pricing decision with
  revenue consequences — surface the numbers and let the user choose.
- OR-combined triggers can never produce cause 4: if any one condition matched, the rule would
  have matched. Zero under OR always means every condition is unmet.

## Whether to SHOW a zero rule depends on the scope

Portfolio-wide and scoped views want opposite treatment, and the difference is easy to get wrong:

- **Unscoped:** list every active rule even at 0 units. A dormant rule is real information at
  portfolio level, and hiding it makes the rule look deleted.
- **Scoped to locations / service lines:** rules with no location scope of their own pass the
  rules-list filter (they apply everywhere) but qualify no units inside the filter. At a single
  campus that is most of the table, so the report fills with "0 units / +$0" rows that say nothing
  about the campus being reviewed. Exclude them, and say how many were excluded.

**Why:** a reader who filters to one campus is asking "what is priced here?", not "what rules
exist?". But silently shrinking the list looks like data loss, so the hidden count has to be
visible, and a scope where nothing qualifies needs an explicit empty state rather than a table
that is empty except for a $0 totals row.

**How to apply:** treat "has impact" as units > 0 OR any non-zero dollar figure — a rule can move
rates on units whose dollar impact rounds to zero, and it is still acting on that scope. Before
adding this kind of filter, confirm with a direct impact run that the zeros are genuine; if the
scope were failing to resolve, every rule would read as zero and the filter would hide a bug
behind an empty report.

**The overlapExcludedUnits trap:** the impact result exposes `overlapExcludedUnits`, and it is
tempting to read it as "the candidate pool that got claimed" when the deduped result is zero. It
is not reliable for that. It is tallied at the dedup step, but in-house rules narrow further to
occupied units *afterwards*, so the two numbers can disagree. Use it only as a cheap gate to
decide whether paying for a full undeduped pass is worth it.

**Cost discipline:** diagnosis re-runs the impact calculation, so it must be gated to rules that
actually landed on zero, skipped when the answer is provable without a pass, wrapped so a failure
degrades to "no explanation" instead of failing the endpoint, and budgeted for the one path that
scales with condition count.
