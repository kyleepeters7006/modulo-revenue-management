---
name: AI rule-suggestion pipeline
description: Durable constraints for the "Suggest Rules with AI" flow — prompt grammar contract, complexity gate, model choice, and days_vacant evaluation.
---

# AI rule-suggestion pipeline

- The suggest endpoint makes ONE Claude Opus call (`claude-opus-4-6` via aiRouter model override) covering ALL requested service lines, returns max 10 rules total, each tagged with its serviceLine. **Why:** user mandated a single request, 10-rule cap, and the most capable model — this is "the bread and butter of the platform." Do not reintroduce per-SL fan-out or the two-call Claude→GPT formatter here.
- The prompt must dictate the natural-language parser's EXACT grammar (compound "If … AND …" clauses, "vacant units over N days", room-type names, occupancy status). **Why:** the LLM writes conditions the parser silently drops otherwise, producing rules simpler than their descriptions — the exact user complaint. If the parser grammar changes, update the prompt in lockstep.
- A complexity gate drops suggestions with no trigger condition and no targeting filters (roomType/occupancyStatus/vacancyDuration) — blanket rules aren't allowed. This gate is NOT sufficient on its own: it accepts condition OR targeting, so a targeted rule whose condition silently failed to parse still passes. An enforceability guard must run alongside it (see rule-trigger-silent-degradation.md).
- The prompt must both ENUMERATE the allowed trigger metrics and explicitly FORBID the plausible-sounding ones the engine lacks (revenue/T12 growth, YoY, trend, velocity, length of stay, margin, churn). **Why:** listing only positive examples let the model invent "T12 growth is negative", which parsed to no condition at all. Note trailing-12 OCCUPANCY exists while trailing-12 GROWTH does not — the prompt must draw that line explicitly. Also require an explicit numeric threshold per condition; "is high" cannot be encoded.
- `days_vacant` trigger conditions are RAW day counts (rawPct — never /100 scaled), evaluated per-unit: group-level trigger evaluation defers them to the unit predicate; the live engine also enforces `filters.vacancyDuration` per unit. **Why:** previously "less than 45 days" became 0.45 and neither engine evaluated it, so preview impact disagreed with live pricing.
- Comparison-phrase regexes accept negative thresholds (e.g. comp var "less than -3").
- Suggest response context: `context.serviceLines[]` always; flat legacy fields only when exactly one SL was requested (back-compat).
