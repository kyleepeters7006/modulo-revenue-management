---
name: Structured rule payload
description: Rule designer sends conditions/action as JSON; the sentence is display-only
---

Designer-authored pricing rules travel as a structured JSON payload (conditions, condition operator, action), not as the composed sentence; sentence parsing is reserved for free-text/AI-authored rules. When a structured payload arrives and cannot be represented, the server rejects it — it never falls back to re-reading the sentence.

**Why:** the sentence round-trip repeatedly lost information the UI already had (dropped %, dropped minus sign, wrong threshold scale), and a fallback would silently reintroduce that class of bug.

**How to apply:** any new designer metric, action, or scope must get a structured representation (with the same threshold scales the engine uses) before it is offered in the UI; the designer's option lists deliberately contain only engine-enforceable choices.

Visible labels must describe the actual evaluated value: SNF payer mix is “SNF Private Pay Mix”, competitor rate variance is explicitly a percentage variance, and inquiry and tour volume are separate metrics. Only occupancy metrics may expose trailing windows.

SNF Private Pay Mix is restricted to the HC family and uses one weighted percentage across occupied HC and HC/MC residents. It must return false for every other service line.

**Why:** HC and HC/MC are two stored labels for the skilled-nursing population; separate percentages or a campus-wide payer mix do not represent the metric users intend.

**How to apply:** selecting this metric should scope the rule to both HC and HC/MC, while the server still enforces the HC-family restriction independently of UI scope.

**Why:** ambiguous labels and a global period picker let users save conditions that either meant something different in the engine or were rejected by the server.

**How to apply:** preserve legacy parser aliases and stored field names for old rules. Legacy combined inquiry+tour rules retain combined behavior but are not offered for new rules; reset the period when switching to a metric that does not support it.
