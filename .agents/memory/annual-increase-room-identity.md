---
name: Annual increase room identity
description: Safety rule for matching saved in-house calculations to Reference Data room rows after room-type normalization changes.
---

A saved in-house calculation may fall back from the exact room-type identity only when campus, service line, room number, and move-in date still match uniquely.

**Why:** Room types can be renamed or re-normalized between imports, which should not make a sitting resident's calculated increase disappear at room level. Room number alone is unsafe because it can repeat, and dropping move-in date could assign an old resident's increase to their replacement.

**How to apply:** Keep exact matching first. Use the room-type-independent fallback only for a unique resident-room identity, retain move-in date, and keep campus and service line in every key and rollup.