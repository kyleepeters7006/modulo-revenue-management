---
name: Parity tests that actually guard parity
description: Why a test embedding hand-copied production SQL guarantees nothing, and what a real cross-surface parity test must do instead.
---

# Parity tests that actually guard parity

A test that embeds a **hand-copied duplicate of production SQL** provides no
parity guarantee whatsoever. It asserts that the copy agrees with the other
copy. Production can regress and the test stays green forever, because nothing
in it ever executes the code that shipped.

**Why:** this happened here. A scatter-vs-reference-data parity test carried its
own transcription of the scatter query. The production function was changed; the
transcription was not; the suite stayed green while the two surfaces genuinely
disagreed. The bug surfaced only when a fixture value was computed by hand.

**How to apply:**

- **Call the exported production function.** If a query is worth a parity test,
  it is worth extracting into a function the test can invoke. One side of the
  comparison may be a SQL mirror; both sides must never be.
- **Share the fragments that must not drift.** Where a mirror is unavoidable,
  build it from the same exported SQL-builder the production query uses, so a
  change to the shared predicate cannot land on one side only.
- **Test the filtered paths, not just the unfiltered one.** Scope-collapse bugs
  (a baseline or population that silently narrows when the caller passes a
  filter) are invisible to an unfiltered test and are exactly the class of bug
  that reaches a user who is drilling in.
- **Assert intent, not incidental output.** A fixture assertion that both sides
  return the same number is weak if that number is also what a broken
  implementation returns. Prefer fixtures where the wrong basis produces a
  visibly different value.
- Test *prose* rots too. When a policy changes, comments and section headings
  describing the old policy make the file actively misleading about what is
  guarded; a reader treats the stale description as a specification.

## A live-data test that discovers its own scopes must discover them through
## the same filters the production query applies

Picking "the campus with the most rows of the shape I want" finds a campus that
the production path then rejects — wrong payer scope, rate below the
plausibility gate — so the scope is skipped and the suite reports green having
tested nothing.

**Why:** the campus with the most companion B-bed rows had zero private-pay
residents with a usable rate, so the B-bed arm of a guardrail suite silently
never ran.

**How to apply:** apply the shared predicates (payer scope, rate gates, latest
month) inside the discovery query, take a *list* of candidates rather than one,
and walk it until a scope actually yields output. A discovery miss must fail,
not skip.

## Prove a guardrail assertion has teeth by breaking the guardrail

Before trusting a suite that only ever passes, mutate the production code it
guards (remove the street cap; drop the daily→monthly conversion) and confirm
the failures land where expected. Restore afterwards. An assertion that stays
green under the mutation it was written for is decoration.

## Encode the guardrail, not the happy path

"Every resident gets at least the configured minimum" is false by design: the
street ceiling legitimately holds a resident below the minimum. The assertion
has to compute the floor that actually applies (min clamped by headroom) or it
will be weakened later to make real data pass.
