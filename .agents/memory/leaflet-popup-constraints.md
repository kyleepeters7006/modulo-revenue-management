---
name: Leaflet map popup constraints
description: Height, stacking-order and escaping rules for the competitor map popups.
---

Three constraints bite whenever a map popup gains content. All were hit while making
the own-property popup rich rather than name-only.

**1. The map card has a fixed height, so tall popups clip.** The popup is not allowed
to be as tall as its content wants; anything beyond the card's height is simply cut off
at the bottom and the user cannot scroll the page to reveal it. Pass Leaflet's
`maxHeight` option to `bindPopup` so it makes the content scrollable instead of
clipping, and keep the design compact enough that the common case never scrolls.
Budget against the *map container's* height, not the browser viewport.

**Why:** autoPan can only pan the map to fit a popup that is smaller than the
container. Once the popup exceeds it, panning cannot help and the overflow is lost.

**2. Leaflet stacks controls above popups.** `.leaflet-control` sits at z-index 800
and `.leaflet-popup-pane` at 700, so the zoom buttons render *on top of* an open popup
and can hide part of its header. Raising the popup pane above the controls is the fix;
it is a global change, so an open popup will overlay the controls on every map.

**3. Popups are raw HTML strings, so escape every interpolated string.** Location,
region, address and service-line names all arrive from uploaded spreadsheets, which is
not a trusted HTML boundary — interpolating them unescaped is a stored DOM-XSS path.
Escape string values; numbers are safe once coerced with `Number()`.

**How to apply:** any time popup content grows, re-check it against the card height at
the campus with the most service lines (the worst case), and confirm nothing new is
interpolated without escaping.

## bindPopup defaults will clip a wide popup

Leaflet's default popup `maxWidth` is **300px**. A popup whose content sets a larger
`min-width` (e.g. a multi-column comparison table) gets clipped, because the inline style
and the Leaflet wrapper disagree. Always pass explicit `{ maxWidth, maxHeight }` options to
`bindPopup` — matching the content's own max-width — instead of relying on the inline style
alone. `maxHeight` also has to be set for Leaflet to make the popup scroll rather than
overflow the fixed-height map card.
