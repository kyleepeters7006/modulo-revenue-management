---
name: Rule save visibility
description: Why newly saved rules don't appear in Rule Administration immediately, and the fix applied.
---

# Rule save visibility after save

## The rule

`purgeRuleCaches(clientId)` must be `await`ed **before** `res.json()` in every rule-creation POST handler. The GET `/api/adjustment-rules` must carry `Cache-Control: no-store`.

**Why:** `res.json()` queues the response; the browser receives it and immediately fires `fetchRules()`. If `purgeRuleCaches` runs after `res.json()`, there is a narrow window where the browser's GET can hit the server's still-stale in-memory cache and receive the old rule list. Express auto-generates an ETag from the response body; the old ETag matches the browser's cached version → 304 → rule never appears. The `Cache-Control: no-store` header kills the browser-side ETag game entirely for this endpoint.

**How to apply:**
- `server/routes.ts` POST `/api/adjustment-rules` — `await purgeRuleCaches(clientId)` then `res.json(...)`
- `server/routes.ts` POST `/api/adjustment-rules/suggestions/accept` — same order
- `server/routes.ts` GET `/api/adjustment-rules` — `res.set('Cache-Control', 'no-store')` at the top
- Frontend `handleSaveRule` in `rule-designer.tsx` — optimistically prepend `data.rule` to `rules` state, then do a `cache: 'reload'` fetch for the authoritative list
