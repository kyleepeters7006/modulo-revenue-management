---
name: Manual override attribution
description: Compatibility rules for actor attribution on manual rate overrides
---

Manual override actor columns are text for backward compatibility: authenticated writes store user IDs, while older/imported rows may store a display username or system label. Any user display join must fall back to the stored actor and then a neutral “Unknown user” label.

**Why:** Legacy unauthenticated saves must preserve existing attribution, and an inner-only UUID join turns valid historical actor text into a blank audit trail.

**How to apply:** Keep authenticated create/update writes distinct from display formatting, preserve existing actors when the current request has no session, and cover API and import writers with attribution tests.