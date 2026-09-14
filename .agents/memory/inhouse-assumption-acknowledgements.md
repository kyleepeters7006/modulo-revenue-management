---
name: In-house assumption acknowledgements
description: Persistence rules for the in-house planning editor's scoped assumptions and effective dates.
---

The in-house planning editor must replace its local assumptions with the exact row acknowledged by the save, update the matching query cache, and reload the newest row for a scope.

**Why:** Scope resolution can briefly expose stale cached data or legacy duplicate rows after a write. Returning and applying the acknowledged row prevents effective dates from disappearing between save and refetch, while newest-row ordering makes a later reload deterministic.

**How to apply:** Preserve this behavior for both portfolio and campus scopes whenever the assumptions save or reload path changes. Resolve whether a campus-specific row exists before restoring annual-report inputs: a report snapshot may seed an unsaved campus, but must never overwrite a saved campus row when filters change.