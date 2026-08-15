---
name: Move-in/out event source
description: Authoritative move-in/out counts come from imported event data with rent-roll fallback; key-parity rules for consumers.
---

# Move-in/out event source

Move-in/out counts prefer the imported `move_in_out_events` table (Move Ins & Outs Detail workbook upload) whenever a client has rows; otherwise fall back to rent-roll `move_in_date` derivation. All consumers (rule performance, reference data, rule impact/designer, SL move-in rate) must branch on `hasMoveInOutEvents(clientId)`.

**Counting rules:** move-in counted = Census_Event 'Admission' only (hospital-leave 'Return' rows stored uncounted); move-out counted = Discharge_Type 'Discharge - Return Not Anticipated' only. Two counting modes: pricing-impact metrics keep HC/HC-MC move-ins Private-Pay-only (default); census-style displays (e.g. reference-data Move-Ins/Outs/Net columns) count ALL payers via `allPayers: true` — otherwise Net looks falsely negative because move-outs are never payer-filtered.

**Why:** rent-roll move-in dates under/over-count (snapshot dedupe artifacts); the event workbook is the operator's authoritative census feed.

**How to apply:** when adding any new move-in/out statistic, use the moveInOutService accessors and keep key parity with the consumer — reference-data rows use room-type-grouped keys (`rtg.group_name`), so event-derived maps must be remapped through `room_type_groupings` before lookup or grouped rows silently show 0.

**Never hand-roll a move-in query off `rent_roll_data.move_in_date`.** The two sources are mutually exclusive in practice: a client on the event feed leaves `move_in_date` entirely NULL, so a rent-roll-only query returns *zero* for exactly the clients with the best data — and zero is indistinguishable from "demand collapsed" unless you carry an explicit availability flag. Always go through the accessors, which branch on `hasMoveInOutEvents`.

**Room-type keys from the event feed are only trustworthy at service-line level.** Event `room_type` values do not reliably match rent-roll room types (measured on real data: one service line matched none of its room types, another matched about half). Aggregate event-derived move-ins to the service line unless you remap through `room_type_groupings` first; a per-room-type figure otherwise prints phantom zeros beside real values.

**Anything derived from move-in counts needs a "no feed" branch.** Rate-change impact math divides by move-ins/month, so an absent feed must render as "unavailable", never as 0 — especially in AI prompts, where a bare 0 reads as weak demand and argues for discounting.
