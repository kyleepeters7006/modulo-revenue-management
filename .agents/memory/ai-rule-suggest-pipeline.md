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

## Every discarded candidate must be attributed, or drift is undetectable

The gates are correct and must stay strict, but a gate that discards a candidate without saying so
makes prompt/parser drift invisible: its ONLY symptom is fewer suggestion cards, which is
indistinguishable from a scope where the model genuinely had little to say.

- **A bare `continue` in the candidate loop is a bug even when the rejection is right.** Record a
  reason code, the offending sentence, and the service lines, and return the tally with the run.
- **Drift detection must count only wording failures** (parse and enforceability), never
  policy failures. A model drafting 150% increases parsed perfectly; counting that as drift points
  the next engineer at a grammar mismatch that does not exist.
- **The 10-rule cap is not a rejection.** Surplus beyond the cap is discarded by design; folding it
  into "could not be used" tells the operator something false.
- **An empty run has several causes that need different next steps** — no campuses matched, no rent
  roll, no units in the service lines, the model drafted nothing, or the model drafted rules that
  all failed a gate. Collapsing them into one message hides the only one that indicates a bug.
- **An explained-empty run must survive a page reload.** Restore-from-cache that keys on
  `suggestions.length` drops exactly the outcome most worth explaining. Gate the restore on the
  presence of a generation-time reason code instead, so a run whose cards were merely accepted or
  denied away does not resurface as "all rejected".

**Why:** the gates live in a shared module rather than inline in the route specifically so a test can
drive the real decision logic; a test that re-implements the gate chain would pass while production
drifted.

## Accepting a suggestion must re-select impact through the same path that displayed it

Accept recomputes a number the operator already approved, so it drifts from the card unless both
sides run one shared selector on identical inputs. Every historical divergence widened the scope,
which is the dangerous direction — a too-large figure reads as plausible.

The invariants:

- **Scope is recovered server-side from the cached run, never from the request.** If the run is gone
  the scope is unrecoverable and saving anyway yields a portfolio-wide *rule*, not just a wrong
  number. Refuse the accept.
- **Score the action as generation scored it.** Accept injects the recovered campus scope as a
  *name*-based action filter before saving; scoring against that post-injection action applies a
  predicate generation never did, dropping rows whose location id is in scope but whose name is
  stale. Snapshot the action before injection.
- **A coarser fallback estimate may only substitute when it covers exactly the same campuses.** The
  elasticity fallback takes at most one location id, so for a region/division run it is
  portfolio-wide; letting it stand in for a zero from the correctly-scoped engine re-widens the very
  scope the rest of the work protects. A scoped zero is an answer.
- **In-house rate rules never take that fallback at all** — it counts vacant units, which an
  in-house rate does not touch.
- **Report which basis produced the figure**, so a fallback estimate cannot pass as a full
  calculation downstream.

**Why:** the failure is silent end to end — the card shows one number, the saved rule another, and
neither surface errors. A test only detects it with a deliberately lopsided fixture: small in-scope
campuses beside a much larger out-of-scope one, and more than one service line, so scoped and
unscoped answers cannot coincide.
