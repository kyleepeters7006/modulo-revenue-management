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
