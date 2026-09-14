---
name: In-house assumption acknowledgements
description: Persistence rules for the in-house planning editor's scoped assumptions and effective dates.
---

The in-house planning editor must replace its local assumptions with the exact row acknowledged by the save, update the matching query cache, and reload the newest row for a scope.

**Why:** Scope resolution can briefly expose stale cached data or legacy duplicate rows after a write. Returning and applying the acknowledged row prevents effective dates from disappearing between save and refetch, while newest-row ordering makes a later reload deterministic.

**How to apply:** Preserve this behavior for both portfolio and campus scopes whenever the assumptions save or reload path changes. The live resolver always owns the editor: use a campus row when present, otherwise the current portfolio/service-line fallback. Annual-report snapshots may restore historical results but must never write captured inputs into the live editor.