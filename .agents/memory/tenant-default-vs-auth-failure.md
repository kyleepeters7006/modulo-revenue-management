---
name: Tenant default vs auth failure
description: Why a "default to the demo tenant" middleware must classify auth state instead of falling back, and the sticky-marker rule that keeps the classification stable across a page load.
---

A request-scoped tenant default (`req.clientId = "demo"`) turns every authentication
failure into a successful read of someone else's scope. The response is a
well-formed 200 with real demo rows, which a client cannot distinguish from
"your tenant has nothing saved" — so the whole app renders empty states, zero
counts, and blank panels while the user still looks signed in.

**Rule:** the middleware classifies the session into mutually exclusive states
(authenticated / anonymous / session_expired / mfa_pending) and only the state
that never had a tenant is answered with demo data. A session that carried a
tenant and stops revalidating is rejected, not downgraded.

**Why:** demo fallback is a display convenience for anonymous visitors; reusing
it as the error path for authentication makes a tenant-integrity failure
invisible. The symptom reaches the user as "no data showing" on whatever page
they happened to open, which sends debugging into the feature instead of the
session.

**How to apply:**
- Any middleware with a default tenant needs an explicit failure state beside
  the default, surfaced both as a status code and a machine-readable field
  (`code`), because prose in an error body is not something a client can branch on.
- Stripping the stale session markers is necessary (anything reading
  `session.clientId` would keep serving the old tenant) but it makes the very
  next request look anonymous. Without a sticky marker on the session, one page
  load produces a mix of 401s and demo-200s in the same view. Keep the marker
  for a bounded window, then let the session become genuinely anonymous again.
- Leave the routes that let a user recover — auth status, CSRF, login, logout,
  MFA — outside the rejection, or the 401 locks out its own remedy.
- A half-finished sign-in (password accepted, second factor outstanding) is its
  own state. Letting it skip revalidation was how an unverifiable session kept
  its silent demo answer.
- Client side, the single place that reads a failed response is the place to
  raise the app-wide signal; components using raw `fetch` bypass it and will
  report the failure only in their own panel.

Related: `absent-content-is-not-empty-state.md`, `user-client-scoping.md`.
