---
name: ResizeObserver loop → Replit runtime-error overlay "crash"
description: Why tall Radix dropdowns make the app "restart" in dev, and the fix that actually works.
---

# Symptom
Opening a Radix UI dropdown (Select/Popover) that renders a **tall list** (e.g. ~50 location items) pops the Replit Vite runtime-error overlay showing `[plugin:runtime-error-plugin] (unknown runtime error)` with no message. Users perceive it as the app "restarting/crashing". Short lists (few items) don't trigger it.

# Root cause
The browser emits a benign `window` `error` event: `message = "ResizeObserver loop completed with undelivered notifications."` with `evt.error === null`. Radix's popper uses ResizeObserver to position the panel; positioning a tall list mutates layout within the same frame → the loop notification. `@replit/vite-plugin-runtime-error-modal` listens via `window.addEventListener("error", e => sendError(e.error))`; a null `e.error` renders as "(unknown runtime error)".

# What does NOT work
A `window.addEventListener("error", ..., true)` handler that matches the message and calls `stopImmediatePropagation()`. The `error` event targets `window`, so at AT_TARGET phase **all** listeners fire in *registration order* regardless of capture flag. The overlay plugin registers its listener before app code (`main.tsx`) runs, so it fires first and `stopImmediatePropagation` is too late.

# Fix that works
In `client/src/main.tsx`, before React renders, wrap the global `ResizeObserver` so its callback runs inside `requestAnimationFrame`. Deferring one frame breaks the synchronous loop so the notification is never emitted.
**Why:** order-independent (doesn't fight the overlay's listener); applies to every observer created later (Radix's, plus app tables). **How to apply:** keep it at the top of the entry module; tradeoff is callbacks fire next frame (negligible for layout/scroll-width sync observers already in the codebase).

# Debugging tip
The testing subagent could not reliably surface `console.*` output, and these error events never reach `console.error`. To capture them, write diagnostics into a fixed-position DOM element (the subagent reads the DOM/snapshot reliably) — that's how the exact message was confirmed.
