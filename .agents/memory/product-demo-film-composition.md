---
name: Product demo film composition
description: Non-obvious rules for cutting screen-recording-style product videos from static app screenshots — transitions, caption scrims, and coordinate transforms.
---

# Composing a product demo film from static screenshots

## Never cross-dissolve two dense UI screens

A plain `xfade=transition=fade` between two screenshots of a data-dense app puts
two full page layouts on screen at once. Both are legible for the whole
transition and it reads as a rendering bug, not a cut.

**Why:** dense UI has high-contrast text everywhere, so there is no quiet region
for the dissolve to happen in. Photography cross-dissolves because photos have
soft areas; product screens do not.

**How to apply:** dip through black (`transition=fadeblack`) or wipe. Keep the
transition inside a narration pause so the audio does not fight the cut.

## An opaque end card must not fade in over live UI

Fading a closing title card over the last screen has the same ghosting problem —
mid-fade the headline sits on top of readable product text.

**How to apply:** two steps. First fade a plain background plate over the whole
canvas so the window empties, then fade the end-card type up on top of it. Since
both plates share the same background, only the type appears to animate.

## Caption scrims need a solid band, not just a gradient

A pure gradient scrim strong enough to hide white page content at the top of the
band is too heavy at the bottom. Small kicker type placed high in a gradient
still has page text showing through behind it.

**How to apply:** short gradient to dissolve the top edge, then a near-solid
band (~0.94 alpha), and place *all* type inside the solid part. Check the worst
case: dark text on a white page panel.

A tall bottom scrim also conveniently hides the natural viewport cut-off at the
bottom edge of a screenshot, which otherwise reads as clipped UI.

## Spotlight rectangles: two ways the geometry silently drifts

1. **Read coordinates off the true-resolution image.** Measuring against a
   downscaled preview (e.g. 1024-wide previews of 1280-wide captures) introduces
   a constant scale error — 1.25x in that case — and every highlight lands off
   its target.
2. **`-resize WxH!` scales the axes independently.** Deriving the vertical
   factor from the horizontal one is wrong whenever the aspect ratio changes at
   all. Compute `sx` and `sy` separately.

Validate the result rather than eyeballing it: assert each transformed rect is
inside the window and does not reach into the caption band. Both failures are
invisible in code review and only show up in an extracted frame.

## Highlight borders must not bisect text

A focus outline whose edge crosses a line of page text looks like a rendering
defect. Size the rect to the gaps between UI blocks, not to a round number.

## Caption pills collide with live controls

A label parked above a highlighted band usually lands on a toolbar or filter row.
Check what is actually behind it per scene and allow per-scene left/right
alignment — and be willing to drop the label entirely when neither side is
clear. The headline usually carries the meaning on its own.
