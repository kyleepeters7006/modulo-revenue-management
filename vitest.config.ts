import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The `@shared` and `@` aliases must mirror vite.config.ts. Without them any
  // server test whose import graph reaches shared/ fails to resolve at load
  // time and reports "0 tests" — a green-looking run that executed nothing.
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, 'shared'),
      '@': path.resolve(import.meta.dirname, 'client', 'src'),
    },
  },
  test: {
    environment: 'node',
    // This project has TWO test conventions, and mixing them broke the runner:
    //   *.vitest.ts — real vitest suites (describe/it), run by this config.
    //   *.test.ts   — standalone scripts that assert and print their own
    //                 summary, run directly with tsx by scripts/runScriptTests.mjs.
    // A `**/*.test.ts` glob here swept up the script-style files, which vitest
    // reported as "No test suite found" / "process.exit unexpectedly called".
    // Twelve passing suites looked like twelve failures, so `npm test` always
    // exited non-zero and stopped being run at all.
    include: ['server/**/*.vitest.ts'],
  },
});
