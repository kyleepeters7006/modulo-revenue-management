---
name: Rule preview / engine parity
description: Any rule-impact preview or drill-down must match the surface that reports the rule — same trigger shapes, same engine, same overlap dedup, same request scope.
---
A rule preview is only useful if it predicts what the user sees after saving. Five independent
things have each broken that contract; check all of them when touching preview code.

## Never hand-roll an impact estimate beside the shared engine

A rule preview that filters units itself will drift from the engine. The Rule Designer preview
once applied only `action.filters` and never looked at `trigger` at all — so editing a trigger
threshold could not move "Units affected", and the preview disagreed with the saved rule.

**Why:** two code paths computing "which units does this rule touch" always diverge; the
trigger-free path silently reported the gross population as if it were the result.

**How to apply:** route every preview through the shared qualified-impact service rather than
re-deriving the unit set. Treat a preview number that cannot respond to a trigger edit as proof
the trigger is not being evaluated.

## 1. Handle both trigger shapes
Triggers are stored either as a `conditions` array with `conditionOperator` (AND/OR) or as a
legacy single `condition` object. Preview code that re-implements evaluation must handle both.

**Why:** a preview that understood only the legacy shape skipped the trigger entirely for
multi-condition rules, so rule rates displayed on every row.

**How to apply:** mirror the engine's metric scales — occupancy is a fraction (0-1) in triggers,
ih_street_variance is a percent, occupied-weighted per campus+service line, excluding Companion.
Missing metric data fails the condition; metrics not computable from aggregated data pass rather
than blocking display.

## 2. Never hand-roll an impact estimate beside the shared engine
Route every preview through the shared qualified-impact service instead of re-deriving the unit
set from `action.filters`.

**Why:** two code paths computing "which units does this rule touch" always diverge. One preview
applied only the filters and never evaluated the trigger, so editing a threshold could not move
the unit count and the number was really the gross unfiltered population.

**How to apply:** a preview number that cannot respond to a trigger edit is proof the trigger is
not being evaluated. Treat that as the first thing to test.

## 3. Report net of overlap dedup, not gross
Rules are shown to users *after* a unit-level claim walk ordered specificity DESC → priority DESC
→ effectiveDate DESC → createdAt DESC, where each unit belongs to the first rule that qualifies
it. A standalone preview quotes a gross count that collapses on save.

**How to apply:**
- Keep the comparator in one exported place shared by the list and the preview; duplicating the
  sort is how they silently drift.
- Show gross and "claimed by other rules" next to the net number, or a large legitimate
  suppression reads as the rule silently failing.
- Match the candidate set too. A location-scoped preview must drop rules belonging to *other*
  locations, because impact resolves location as `(scope.locationId || rule.locationId)` — the
  page scope overrides a rule's own campus and lets a foreign rule claim units it never could.
- A rule saved as historical is inactive and never joins the walk, so preview it standalone.

## 4. Editing is not creating
When previewing an edit, exclude the rule's own saved copy from the dedup walk and reuse its
stored ordering identity (createdAt, priority, effectiveDate).

**Why:** the saved copy is still active and claims the whole population first, so every edit
previews as zero units. And a prospective rule stamped with the current time outranks its real
position in any tie, promising units the saved edit will not own.

**How to apply:** accept the "exclude this rule" input for preview requests only — on a create
path it lets a caller suppress an arbitrary rule and persist wrong impact metadata. Also keep the
preview request body identical to the save request body (service lines, room types, effective
date, stacking, historical flag); a preview that omits fields the save sends is scoping a
different rule than the one that gets written.

## 5. A drill-down is a preview too
Anything reached by clicking a reported number — campus breakdowns, coverage lists, exports —
must reproduce that number exactly, which means replaying the dedup walk *and* resolving the page
filters (campus / region / division / service line) the same way the list did.

**Why:** a per-rule detail endpoint computed standalone quoted the gross population and disagreed
with the cell that opened it by an order of magnitude. Page filters are the second, quieter half:
the list scopes impact to the filtered campuses, so an unfiltered drill-down disagrees again as
soon as the user narrows the view.

**How to apply:** resolve "page filters → rule set + impact scope" in ONE shared helper both
endpoints call, and have the drill-down request carry the same query params the list was fetched
with. Also note the two sides read rules from different places — raw `pool.query` rows are
snake_case, so `isActive` / `priority` / `effectiveDate` are silently undefined and the dedup
ordering degrades; prefer the Drizzle row, or map those fields explicitly.
