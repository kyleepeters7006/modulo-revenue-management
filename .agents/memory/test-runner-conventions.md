---
name: Two test conventions, two runners
description: Why *.vitest.ts and *.test.ts are run by different runners and must not be mixed in one glob.
---

- `*.vitest.ts` — real vitest suites (`describe`/`it`). Run by `vitest.config.ts`.
- `*.test.ts` — standalone scripts that assert inline, print their own summary
  and call `process.exit()`. Run with tsx by `scripts/runScriptTests.mjs`.
- `npm test` runs both and is the only command that covers the whole suite.

**Why:** a `server/**/*.test.ts` vitest glob swept up the script-style files.
Vitest reported them as "No test suite found" / "process.exit unexpectedly
called with 0", so twelve *passing* suites looked like twelve failures and
`npm test` always exited non-zero — which meant nobody ran it. Separately,
`vitest.config.ts` lacked the `@shared` alias that `vite.config.ts` has, so any
suite whose import graph reached `shared/` failed to load and silently reported
zero tests.

**How to apply:**
- Keep the aliases in `vitest.config.ts` mirroring `vite.config.ts`.
- A suite reporting "0 tests" is a load failure, not an empty file. Investigate
  before trusting a green-looking run.
