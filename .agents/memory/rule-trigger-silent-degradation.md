---
name: Rule trigger silent degradation
description: An unmappable condition clause degrades to a trigger-less blanket rule instead of failing. Parsing + validation is not enough — every text-to-rule path needs an enforceability check.
---

# Rule trigger silent degradation

The natural-language rule parser falls back to a trigger-less `immediate` shape whenever it
cannot map a clause onto a supported metric, and rule validation treats that as valid. The
combination fails silently and severely: a rule whose text promises a gate is persisted with
**no gate at all** and reprices every unit its action filters match.

**Why:** a rule describing three conditions shipped against more than ten times the units it
was meant to touch. None of its stated gates existed in the trigger — they were prose. The
existing complexity gate did not catch it because that gate accepts a condition **OR** mere
targeting, and the rule had room-type filters.

**The invariant:** parsing plus validation only proves a rule is *well-formed*, never that it
is *enforceable*. Any path that turns text into a stored rule must additionally verify that
every gate the text promises survived into the trigger. Creation, edit, AI-accept,
AI-suggest, bulk import and historical-reselect are all such paths — guarding one is
worthless while the others stay open. Provenance is not a safety guarantee: a stored legacy
rule can carry the same defect, so reactivating one needs the same check.

## Designing the check — the traps that matter

- **Never treat a bare comparison word as a gate.** Campuses have names like "Overlook Ridge"
  and "Above Market Campus". Require the comparison to be bound to a magnitude (a numeral, or
  the numeral-free sign tests "is negative" / "is positive"). Matching lone directional words
  rejects valid unconditional rules — a worse failure than the bug being fixed.
- **Strip what the action legitimately enforces** before scanning for leftover gate language:
  vacancy duration, occupancy status, and the proper nouns in room-type / location /
  service-line filters. Otherwise a filter's own wording reads as an unparsed condition.
- **Event and time triggers are not a free pass.** Exempting them reopens the bug with a
  schedule attached — a monthly rule can drop a condition just as silently. Check them too,
  but strip the trigger's own wording first, since event phrasing legitimately contains "when".
- **Count propositions across every gate introducer, not just the first.** Two gates can be
  joined by a second introducer rather than by AND/OR, and a clause that parses standalone can
  vanish inside a compound.
- **Scope a metric's comparison extraction to its own clause.** Reading a comparison from the
  whole sentence lets one metric adopt an unrelated clause's number and store a threshold the
  text never states.
- **Keep one clause-boundary vocabulary.** When the duration matcher recognised fewer boundary
  words than the guard did, a duration belonging to a second clause was attached to the first.
  Derive every boundary check from a single shared definition.

## Prompt-grammar corollary

When a prompt instructs a model to emit a specific phrasing, that exact phrasing needs a
parser test — a prompt example that does not parse is a bug generator. One canonical example
in the suggestion prompt placed a room type between the vacancy keyword and "units", a shape
the duration matcher did not accept, so the model reliably produced rules that lost their
threshold. Equally, only advertise a metric in the prompt if the parser really accepts the
phrasing being advertised.
