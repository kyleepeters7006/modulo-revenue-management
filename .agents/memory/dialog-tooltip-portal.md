---
name: Tooltips inside scrollable dialogs
description: Why hover cards in the bubble/coverage maps are portalled to document.body and viewport-clamped instead of flipped above/below.
---

Hover tooltips anchored to content inside a scrollable dialog must be rendered
through a portal on `document.body` with `position: fixed`, then clamped to the
viewport. Do not try to fix clipping by flipping the card above/below the anchor.

**Why:** two flip-based attempts failed on the rule coverage maps. The clipping
edge is not the viewport, it is the dialog's own overflow box
(`max-h-[88vh] overflow-y-auto`). More importantly, measurement showed the card
renders ~300px tall while that scroll box is only ~550px, so for any anchor near
the middle of the grid *neither* side has enough room — flipping cannot succeed
no matter how the threshold is tuned. Only escaping the overflow box works.

**How to apply:** the shared hook `client/src/hooks/usePortalTooltip.ts` owns
this. Attach its `scrollRef` to the dialog scroll container, `tipRef` to the
portalled card, and wire `onAnchorEnter(id)` / `onAnchorLeave` to the anchors.
Non-obvious details it handles, each of which was a real bug:

- Measure the card's *actual* rendered rect in a `useLayoutEffect`; a hardcoded
  height estimate is what made both earlier attempts wrong. Render at
  `opacity: 0` for the single pre-measurement frame.
- Reset hover state when the dialog closes. Closing unmounts the anchors but
  leaves `hoveredId` set, so reopening renders a stale card pinned to the last
  measured position against a detached anchor.
- Re-position on dialog scroll, window scroll (capture phase) and resize — the
  card is viewport-positioned, so it does not move with its anchor on its own.
- Keep `pointer-events-none` or the card swallows clicks on the anchor.
- Omit the arrow when clamping pushed the card across the anchor; it would
  otherwise point at nothing.

**Verification lesson:** a testing agent reported "tooltip fully visible" on
screenshots that plainly showed it cut off. For geometry bugs, require numeric
assertions on `getBoundingClientRect()` rather than a visual judgement.

**Trap — there are two rule bubble maps.** Both render the identical title
"Rule Coverage — Bubble Map", so a UI report about "the bubble map" is ambiguous
and fixing one leaves the other broken. They are opened by differently-labelled
buttons: "Bubble Map" in the Rule Administration section (the rule-designer
component) and "Coverage Map" in the Active Rules section header (the
pricing-controls page). Confirm which button the user clicked before editing,
and apply UI fixes to both.
