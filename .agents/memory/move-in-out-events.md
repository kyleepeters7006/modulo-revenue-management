---
name: Move-in/out event source
description: Authoritative move-in/out counts come from imported event data with rent-roll fallback; key-parity rules for consumers.
---

# Move-in/out event source

Move-in/out counts prefer the imported `move_in_out_events` table (Move Ins & Outs Detail workbook upload) whenever a client has rows; otherwise fall back to rent-roll `move_in_date` derivation. All consumers (rule performance, reference data, rule impact/designer, SL move-in rate) must branch on `hasMoveInOutEvents(clientId)`.

**Counting rules:** move-in counted = Census_Event 'Admission' only (hospital-leave 'Return' rows stored uncounted); move-out counted = Discharge_Type 'Discharge - Return Not Anticipated' only. HC/HC-MC move-ins remain Private-Pay-only in all counting queries.

**Why:** rent-roll move-in dates under/over-count (snapshot dedupe artifacts); the event workbook is the operator's authoritative census feed.

**How to apply:** when adding any new move-in/out statistic, use the moveInOutService accessors and keep key parity with the consumer — reference-data rows use room-type-grouped keys (`rtg.group_name`), so event-derived maps must be remapped through `room_type_groupings` before lookup or grouped rows silently show 0.
