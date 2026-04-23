#!/bin/bash
set -e
npm install
# --force skips the interactive "add constraint without truncating?" prompt
# that drizzle-kit push shows for the users_username_unique constraint.
# Stdin is closed in the post-merge environment, so any interactive prompt
# causes the script to hang until the 60s timeout is reached.
# --force accepts adding constraints without truncating data (safe default).
npm run db:push -- --force
