---
name: Exporting a solver result to a spreadsheet
description: What may be a live formula vs. what must be a labelled snapshot when exporting solver output to Excel, plus the ExcelJS chart gap and cross-sheet row coupling.
---

# Exporting a solver result to a spreadsheet

## The honesty rule

When exporting a solved plan to a workbook, every cell falls into exactly one of
three buckets, and the workbook must **say which**:

1. **Live input** — an operator-editable value that genuinely feeds a formula.
2. **Derived** — a real Excel formula over the inputs.
3. **Snapshot** — a value the workbook cannot recompute, carried over from the
   server-side solve.

**Why:** the failure mode is a cell that *looks* editable (styled like an input)
but drives nothing. The operator changes the annual growth target, sees the
totals not move, and either concludes the workbook is broken or — much worse —
believes the unchanged totals now correspond to the new target. An unlabelled
snapshot is worse than no export.

**How to apply:** style the three buckets differently (yellow input / plain
formula / grey snapshot) and state the convention in the header. Before shipping,
walk every non-formula cell and ask "does editing this change anything?" If no,
it is a snapshot, not an input. Assert this in a test: snapshot cells must not be
formulas *and* must carry the snapshot fill.

## What genuinely cannot be a formula

Only two things, in practice:

- A value found by **iterative search** (bisection, Newton, Solver) — there is no
  closed form to write into a cell. Export it as a labelled solved input and tell
  the user to re-derive it with **Goal Seek** against the named objective cell.
- A value produced by a **simulation** (e.g. day-by-day turnover) — not
  expressible as a spreadsheet expression at all.

Everything else is usually derivable and should be a formula, even when it looks
like an opaque solver internal. A date-gated multiplier of the form
`applies_if(dateA <= dateB)` is a good example: it looks like solver state but is
a one-line `IF(AND(...))` over two cells that are already in the sheet. Pasting it
silently decouples the effective dates from the whole calculation. Check each
"solver output" for derivability before accepting it as a snapshot.

ISO date strings (`YYYY-MM-DD`) compare correctly with `<=` in Excel, so
date gating works without real date serials — but guard the empty-string case
explicitly, since `"" <= "2027-01-01"` is TRUE and would invert the gate.

## Cross-sheet row coupling needs an assertion

If a detail sheet's formulas reference summary cells by absolute row
(`Summary!$B$20`), those row numbers must be declared in one constant map — and
then **verified against the finished sheet**: re-read each referenced row and
assert its label is what you expect.

**Why:** inserting one row into the summary silently repoints every row of the
detail sheet at the wrong assumption. The workbook still opens, still
recalculates, and is entirely wrong. There is no runtime error and no visual tell.

**How to apply:** pair the row-number map with a label map, write the labels from
that map, and run the assertion at the end of the build so the export fails loudly
rather than shipping a plausible wrong answer.

## ExcelJS has no chart API

ExcelJS (through 4.4) cannot write charts at all. To add native charts, build the
workbook normally, then post-process the `.xlsx` **as a zip**: add
`xl/charts/chartN.xml`, `xl/drawings/drawingN.xml` + its rels, a `<drawing>`
element on the worksheet, and `<Override>` content-type entries.

Traps that make Excel declare the file corrupt and offer to "repair" it:

- **Never number parts from 1 unconditionally.** Scan existing package parts and
  continue past the highest index, or you overwrite another sheet's drawing.
- **Relationship ids must be unique within a rels part** — check for collisions
  before appending rather than assuming a made-up prefix is free.
- `<drawing>` must be placed correctly in the worksheet element sequence (near the
  end, after `pageSetup`, before `legacyDrawing`).
- Every chart series must reference a range that actually exists.

## Empty result sets

A zero-row detail block inverts every range built over it (last data row lands
above the first), which Excel reads as corrupt rather than empty. Reject an empty
result at the top of the builder instead of emitting a broken file.
