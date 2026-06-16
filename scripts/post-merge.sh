#!/bin/bash
set -e
npm install --prefer-offline --no-audit
npm run db:push -- --force
