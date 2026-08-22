---
name: Cancelling and bounding a slow AI request
description: Four non-obvious traps when making a long non-streaming AI endpoint cancellable and time-bounded, each of which fails silently.
---

Every trap below produces a *silent* wrong outcome — no stack trace, no error
log — which is why they cost real debugging time.

## `req.on('close')` is not a disconnect signal

An Express `IncomingMessage` emits `close` as soon as its body has been read, so
for a JSON POST that fires immediately. An abort wired to it kills every request
the instant it starts, and the symptom looks like the upstream service returning
nothing rather than like a cancellation bug. Detect disconnects on the *response*
stream, and distinguish a normal finish from a real disconnect.

## A timeout budget must span all providers, and must be enforced locally

Two independent mistakes:

- **Per-provider budgets add up.** Primary and fallback each granted the full
  budget means the caller waits twice what it agreed to. Derive one deadline and
  pass the remainder to each attempt. If too little remains for a fallback to
  plausibly finish, fail immediately rather than starting an attempt that can
  only time out again.
- **A timeout handed to an SDK is a hint.** Clients retry internally or ignore
  the option, so the deadline needs a local timer as well.

Never `unref()` a deadline timer: an event loop with nothing else pending exits
before it fires, so the "deadline" quietly does nothing. Clear it in a `finally`.

**Why:** an unref'd timer passed every fake-clock test and hung the first
real-time one.

## "Cancelled" and "timed out" are distinguishable only by *whose* signal fired

When a local deadline aborts an attempt, SDKs reject with `APIUserAbortError` —
the exact error name the user pressing Cancel produces. Classify by checking the
**caller's** signal, never the error name alone, and check the deadline flag
before any name-based abort test.

**Why:** getting this backwards makes a timeout look like a client disconnect, so
the route stays silent instead of returning its 504, and the user sees a bare
network failure rather than the guidance that was written for exactly that case.

**How to apply:** anywhere a derived AbortController sits between the caller and
an SDK.

## A cancelled run must not commit its cache write, and abort does not un-resolve

- Checking a cancellation flag *before* a cache write leaves the window where the
  client disconnects mid-query. Decide inside a transaction, at commit time.
- On the client, aborting rejects a fetch still in flight but cannot undo one
  that has already resolved. Give each run an id, retire it before aborting, and
  let only the current run write to state — otherwise the results the user
  declined to wait for land a moment after the cancel.
