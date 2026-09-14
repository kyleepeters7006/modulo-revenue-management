# TypeScript check boundary

`npm run check` runs the project TypeScript compiler with strict checking enabled
for the maintained source surface. The compiler target is explicitly set to
ES2020 so iteration over `Map`, `Set`, and other modern collections is checked
against the same language level used by the application.

Some older client pages and server modules currently carry a file-level
`// @ts-nocheck` directive. This is an intentional, visible compatibility
boundary for code whose API and database types have drifted from the current
shared contracts. It is not a project-wide escape hatch:

- Do not add `@ts-nocheck` to new files.
- Keep the directive at the top of an existing legacy file until that file's
  diagnostics can be repaired.
- New or substantially changed code should stay outside this boundary and must
  pass `npm run check`.

The boundary is discoverable with:

```sh
rg --files-with-matches '^// @ts-nocheck' client server shared
```