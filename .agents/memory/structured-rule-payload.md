---
name: Structured rule payload
description: Rule designer sends conditions/action as JSON; the sentence is display-only
---

Designer-authored pricing rules travel as a structured JSON payload (conditions, condition operator, action), not as the composed sentence; sentence parsing is reserved for free-text/AI-authored rules. When a structured payload arrives and cannot be represented, the server rejects it — it never falls back to re-reading the sentence.

**Why:** the sentence round-trip repeatedly lost information the UI already had (dropped %, dropped minus sign, wrong threshold scale), and a fallback would silently reintroduce that class of bug.

**How to apply:** any new designer metric, action, or scope must get a structured representation (with the same threshold scales the engine uses) before it is offered in the UI; the designer's option lists deliberately contain only engine-enforceable choices.
