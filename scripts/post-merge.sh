#!/bin/bash
set -e
npm install --prefer-offline --no-audit
# Schema changes are applied by the app's startup migration system.
# drizzle-kit push is intentionally omitted here: it prompts interactively
# when constraint names differ between the schema and the live DB, which
# causes the post-merge script to hang (stdin is /dev/null in CI).
