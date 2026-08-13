---
name: User account client_id scoping
description: Trilogy (and other non-admin) users had client_id = null; fix and risk pattern documented.
---

# User account client_id scoping

## The rule

All real users in the `users` table must have `client_id` set to their tenant (e.g. `'trilogy'`). The session middleware uses `(req.session as any)?.clientId || 'demo'`, so a null DB value → `'demo'` in the session, silently routing the user to the wrong tenant's data.

**Why:** Iriscel.Johnston@Trilogyhs.com, michael.kennedy@trilogyhs.com, and kyle.peters@trilogyhs.com all had `client_id = NULL`. They were served `client_id = 'demo'` data — Rule Administration showed global (`client_id = null`) rules, not the trilogy-specific ones. The fix was a direct DB update: `UPDATE users SET client_id = 'trilogy' WHERE email ILIKE '%trilogyhs.com%' AND client_id IS NULL`.

**How to apply:**
- Any user registration or invite flow MUST set `client_id` from the admin's session or an explicit tenant parameter
- Check `users` table for `client_id IS NULL` rows when debugging "user can't see their rules/data"
- Rule Administration returning only global rules is a strong signal the user's `client_id` is wrong in their session
- After fixing `client_id` in the DB, the user must **log out and log back in** — session stores clientId at login time
