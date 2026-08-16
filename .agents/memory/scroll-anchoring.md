---
name: Scroll anchoring in long dashboard pages
description: Why manual scroll compensation for async content growth is wrong here, and what actually causes page jumps.
---

# Do not hand-roll scroll compensation

The long pages (Pricing Controls etc.) scroll on `window` with no nested scroll
container and no `overflow-anchor` overrides, so **Chrome's native scroll
anchoring already holds the viewport** when a panel above the fold grows or
shrinks (async AI suggestions arriving, a card removed on Accept, a cached run
restoring).

**Why:** a `useLayoutEffect` that measured the panel's document-space bottom and
called `window.scrollBy(delta)` produced exactly **double** the correct shift —
the browser had already compensated. Measured: a 395px layout change moved the
content 395px on screen with the manual code, and 0.5px without it.

**How to apply:** when a user reports the page "jumping", do not add scroll
compensation. Measure first (record a landmark's `getBoundingClientRect().top`
before and after the change; `window.scrollY` is *expected* to move — the
landmark's on-screen top is not). Real jumps in this app come from explicit
imperative scrolls, e.g. a handler that calls `scrollIntoView` on a card and
then also `window.scrollTo({top: 0})`.
