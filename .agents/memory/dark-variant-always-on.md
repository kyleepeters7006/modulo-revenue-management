---
name: The whole app renders inside a .dark wrapper
description: Why Tailwind dark: variants must never be used in this project, and why sticky table cells need fully opaque backgrounds.
---

# `dark:` variants are permanently ON — never use them

`AppContent` in `client/src/App.tsx` wraps the entire tree in `<div className="dark">`, and the
Tailwind config uses `darkMode: ["class"]`. So every `dark:` variant in the codebase is always
active, even though the product renders as a light theme.

The consequences are asymmetric and that is what makes it confusing:

- `dark:` utilities bound to **theme CSS variables** (`dark:bg-background`) still resolve to the
  light palette, so they look correct and hide the problem.
- `dark:` utilities using a **literal palette colour** (`dark:bg-amber-950/30`) actually paint,
  producing a dark, usually translucent wash over a light page.

**Why this matters:** adding a `dark:bg-amber-950/30` row tint to a table painted a brown wash
over the whole table and, because the colour was translucent, turned the frozen columns
see-through — scrolled-away columns showed through the sticky cells and text appeared stacked on
top of itself. Diagnosing it from the screenshot alone is misleading; the giveaway is a computed
`backgroundColor` with an alpha channel, e.g. `rgba(69, 26, 3, 0.5)`, on an ostensibly light page.

**How to apply:** write light-mode classes only. If you genuinely need a dark treatment, use the
theme variables rather than a `dark:` variant.

## Sticky/frozen table cells must be opaque

Frozen columns scroll *over* the other cells, so any alpha in their background lets the content
underneath bleed through. This applies to every branch of a conditional background, including
"highlight" states — an alpha tint like `bg-[var(--trilogy-teal)]/10` is fine on the `<tr>` but
not on a sticky `<td>`.

To keep a sticky cell visually identical to a translucent row tint while staying opaque, mix the
colour into white instead of alpha-blending it:
`bg-[color-mix(in_srgb,var(--trilogy-teal)_10%,white)]`.

**How to apply:** when tinting table rows, set the tint on the row *and* repeat an opaque version
on each sticky cell, then verify by scrolling the table fully right — not just by looking at it
at rest.
