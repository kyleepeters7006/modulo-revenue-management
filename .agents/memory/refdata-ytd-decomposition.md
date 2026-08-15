---
name: Reference Data YTD growth decomposition
description: Why revenue / in-house rate / street rate YTD are three separate columns and how their roll-ups must be computed.
---

# Reference Data YTD growth decomposition

Reference Data exposes YTD growth as three columns — revenue, in-house rate, street rate — because "rate growth" is ambiguous on its own and revenue growth alone cannot tell you *why* it moved.

The decomposition is the point: **revenue growth ≈ rate growth + census growth**. Showing revenue beside in-house rate makes census the visible residual, so a revenue number driven purely by filling beds cannot be mistaken for pricing power. In-house rate reflects what residents actually pay; street rate reflects what is being asked. Street running below in-house is the loss-to-lease signal.

**Why:** in-house rate growth is derived from the *same* revenue spot/base components, with occupied-unit counts divided out. Reusing those components rather than computing an independent average keeps the decomposition exact instead of approximately consistent.

**How to apply:**
- Emit raw components (spot, base, and the unit count for each) alongside every ratio, and have group roll-ups **re-derive the percentage from summed components**. Never average per-row percentages — a 4-unit room type would weigh the same as a 40-unit one.
- Divide out unit counts *before* taking the ratio, or census growth silently reports as price growth.
- Emit the unit count only when its matching revenue component is valid, and sum both under the same eligibility test, or the ratio drifts.
- Basis differences are intentional and must be preserved: in-house is computed over occupied units with no B-bed exclusion; street excludes B-beds. This mirrors what the table already displays elsewhere.
- Listing a derived ratio key in the shared weighted-average key list is misleading — the roll-up overwrites it afterwards. If you add one, make the override explicit or the next consumer of that list will trust the wrong value.
