---
name: Historical strategy taxonomy
description: How imported per-location historical pricing rules map to the 5 Rule Performance strategy groups
---

Rule Performance groups rules into 5 strategies: push, hold, ensure, concession-al, concession-sl.

**Rule:** Imported historical rules (from Trilogy Dynamic Pricing workbooks) carry trigger `{"type":"always"}` — the file records outcomes, not conditions. Category must be inferred from the file's own convention: +5% = push (highly occupied, at/below comps), +2.5% = hold (highly occupied, above comps), any other positive % (variable 1–10%) = ensure (raise street rate to match in-house), negative = concession (SL/VIL → concession-sl, else concession-al). Rules with real triggers use `street_to_ih_var` → ensure, `street_to_comp_var <` → push.

**Why:** The July 2026 file's Logic tab defines these 5 strategies with exactly these adjustment values; before this convention all positive historical adjustments were lumped into "hold".

**How to apply:** Keep backend `getRuleCategoryFn` and frontend `PERF_RULE_GROUPS` in lockstep — a category returned by the backend that has no frontend group silently drops rows from the strategy view.
