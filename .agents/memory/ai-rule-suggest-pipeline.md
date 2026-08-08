---
name: AI rule-suggestion pipeline
description: Durable constraints for the "Suggest Rules with AI" flow — prompt grammar contract, complexity gate, model choice, and days_vacant evaluation.
---

# AI rule-suggestion pipeline

- The suggest endpoint makes ONE Claude Opus call (`claude-opus-4-6` via aiRouter model override) covering ALL requested service lines, returns max 10 rules total, each tagged with its serviceLine. **Why:** user mandated a single request, 10-rule cap, and the most capable model — this is "the bread and butter of the platform." Do not reintroduce per-SL fan-out or the two-call Claude→GPT formatter here.
- The prompt must dictate the natural-language parser's EXACT grammar (compound "If … AND …" clauses, "vacant units over N days", room-type names, occupancy status). **Why:** the LLM writes conditions the parser silently drops otherwise, producing rules simpler than their descriptions — the exact user complaint. If the parser grammar changes, update the prompt in lockstep.
- A complexity gate drops suggestions with no trigger condition and no targeting filters (roomType/occupancyStatus/vacancyDuration) — blanket rules aren't allowed.
- `days_vacant` trigger conditions are RAW day counts (rawPct — never /100 scaled), evaluated per-unit: group-level trigger evaluation defers them to the unit predicate; the live engine also enforces `filters.vacancyDuration` per unit. **Why:** previously "less than 45 days" became 0.45 and neither engine evaluated it, so preview impact disagreed with live pricing.
- Comparison-phrase regexes accept negative thresholds (e.g. comp var "less than -3").
- Suggest response context: `context.serviceLines[]` always; flat legacy fields only when exactly one SL was requested (back-compat).
