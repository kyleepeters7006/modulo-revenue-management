---
name: TypeScript check boundary
description: The project keeps strict TypeScript checking enabled while legacy drift is isolated explicitly.
---

The normal TypeScript check is strict and must continue to run for maintained
source. Legacy files with unresolved API or schema drift may use a visible
file-level boundary, but new files and substantially changed code must remain
inside the checked surface.

**Why:** A project-wide disabled check hides new regressions, while repairing
the entire accumulated legacy drift is a separate effort from restoring a
reliable baseline check.

**How to apply:** Keep the boundary list discoverable with
`rg --files-with-matches '^// @ts-nocheck' client server shared`, and remove a
file's directive when its contracts are repaired.