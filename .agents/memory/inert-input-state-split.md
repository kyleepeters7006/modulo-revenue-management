---
name: Inert inputs from rival state stores
description: A form field bound to the losing side of a merge silently ignores user input; per-key defaults are what expose it.
---

## Rule
When a value has two stores — a shared object and a per-key override map — and a merge function
picks a winner (`{...shared, ...perKey[k]}`), **every input for that value must write to the
winning store.** Binding a visible field to the losing store makes it inert: typing updates state,
re-renders, and changes nothing downstream.

**Why:** This is invisible for as long as both stores hold the same number, which is exactly what
seeding-from-a-shared-default guarantees. Introducing *per-key* defaults makes the two diverge, and
the field silently starts lying — the box shows one number while the engine uses another. Type
checking cannot see it, and unit tests on the engine cannot see it, because both stores are
individually valid.

**How to apply:**
- Grep for the merge helper and confirm every writer targets the store it prefers. A conditional
  layout is the usual place this rots: one branch renders per-key inputs wired correctly, the other
  renders a "simple" single input still wired to the shared object.
- Any time you replace a uniform default with a per-key default, re-check every reader and writer
  of that key first — the change converts a latent no-op into a live divergence.
- Cover it end-to-end, not with unit tests: type a distinctive value, run the engine, and assert
  the engine echoes that exact value back. "The field accepts input" proves nothing.
