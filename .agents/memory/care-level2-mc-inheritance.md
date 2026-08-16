---
name: MC care rates inherit from their base service line
description: Why AL/MC and HC/MC fall back to AL and HC Level-2 care rates instead of being treated as missing data.
---

# Memory-care Level-2 rates inherit from the base line

`care_level_rates` holds **our own** Level-2 care rate per location + service line. Coverage
for the memory-care lines is sparse: the MC variants have far fewer rows on file than their
base lines, so a campus routinely has an AL rate but no AL/MC rate.

**The rule:** when a care-eligible service line has no row, fall back to its base line —
`AL/MC → AL`, `HC/MC → HC` — and flag the result as inherited so the UI can mark it
(a `†` with a footnote). Never insert or mutate client care data to close the gap.

**Why:** where an MC row *does* exist it is usually identical to its base line (true for the
large majority of campuses in both AL/MC-vs-AL and HC/MC-vs-HC). So the base line is a
well-supported estimate, and inheriting it is much better than rendering an em-dash that
makes a real campus look like it has no care pricing at all. Flagging it keeps the estimate
honest and visibly distinct from a rate that is actually on file.

**How to apply:** go through the shared resolver in `shared/careRates.ts`
(`resolveCareLevel2`) rather than reading `care_level_rates` directly, so every surface
inherits and flags consistently. Lines outside the care-eligible set (SL, VIL) have no
care concept at all and must stay null — do not give them a fallback.
