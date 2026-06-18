---
name: Inquiry location normalization formats differ per client
description: inquiry_metrics.location uses two different naming formats across clients; normalization must handle both to join with rent_roll campuses
---

The `/api/reference-data` endpoint joins `inquiry_metrics` rows to `rent_roll_data`
campuses via JS-side normalization (`normInqLoc` on inquiry side, `normCampus` on
rent_roll side). Both must produce the SAME normalized key for the same physical campus.

**The trap:** the two clients use opposite inquiry-location naming formats:
- **demo**: inquiry locations share rent_roll's `"Name - NNN"` format (e.g. `"South Bend - 304"`).
- **trilogy**: inquiry locations use `"Name SL"` / `"Name HC"` (service-line suffix word, no number, e.g. `"Belmont SL"`).

`normCampus` (rent_roll side) always strips the ` - NNN` numeric suffix. So `normInqLoc`
must: strip ` - NNN` when present (demo), else strip the trailing service-line suffix
word (trilogy). A single strategy breaks one client (demo got 0 matches with SL-strip;
trilogy got 0 with numeric-strip).

**Why:** the original code only did SL-suffix stripping, so every demo inquiry/tour
column rendered blank (–) while trilogy worked.

**How to apply:** any change to inquiry/campus matching must be validated against BOTH
clients. Note trilogy inquiry data is sparse (~20 of 149 campuses), so many trilogy
campuses (e.g. Avon) are legitimately blank — absence of data, not a matching bug.
