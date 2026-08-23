---
name: Measuring resident turnover from history
description: Why measured turnover must be private-pay scoped and month-aligned, and the vocabulary/feed traps between the event table and occupancy history.
---

## Rule
A turnover rate fed to pricing logic must be **private-pay scoped on BOTH sides**, and its
numerator and denominator must cover the **same months**.

**Why:** All-payer, one client's Health Center turns over ~943%/yr — ~5,500 discharges a month
against ~6,700 occupied beds. Those are real clinical discharges, not duplicates (verified: event
count == distinct key count). But the overwhelming majority are Medicare / Medicare Advantage /
Managed Care short-stay rehab residents whose rate is set externally. Replacing one moves no
revenue, so counting them pretends the resident base re-prices itself several times a year.
Private-pay-only the same line is ~549%, and AL ~153%, AL/MC ~14%, SL ~39%, VIL ~53%.

**How to apply:**
- Numerator: counted private-pay move-outs. Denominator: occupancy LEVEL from
  `room_type_occupancy_history` × private-pay SHARE from the rent roll. Never count rent-roll
  occupied rows directly as the level — that flag over-counts (B beds, companion rows) and
  inflates the denominator. Never pair a private numerator with an all-payer denominator; on HC
  that understates by ~5x.
- Use the shared exclusion-based payer scope, not an ILIKE '%private%'. The event feed's payer
  column spells Medicare "MCR" and Medicaid "MCD" and carries insurer brand names.
- Restrict the numerator to the months the denominator actually covers, then annualise. A campus
  whose occupancy history lags will otherwise divide a full year of move-outs by an average over
  the few months it reported, and report it as a twelve-month measure.
- Refuse a half-specified scope. Events key on campus NAME, occupancy and rent roll key on
  location ID; supplying one without the other scopes one side only and reads as a real collapse
  rather than a bug.

## Two feed traps
- **The event feed's trailing month is partial.** It lands a few days into the new month with a
  fraction of its discharges. Include it and every line drops by roughly a twelfth. Treat a feed
  that stops before the 28th as not having finished its month.
- **Two service-line vocabularies.** The admissions/event feed emits `IL`; occupancy history and
  pricing use `VIL`. `IL` only ever appears at campuses whose history rows carry `VIL` and never
  `IL`, so it must be folded in — left alone it becomes a line with move-outs and no denominator.
  Conversely `HC/MC` exists in occupancy history but produces no events of its own (those
  discharges are recorded under `HC`), so it measures zero move-outs.

## Plausibility is a disclosure, not a clamp
Report the measured figure even when it is unusable, and say why it is unusable. Silently
substituting a saved assumption while the UI implies a measurement is the failure mode. Short-stay
rehab genuinely exceeds 100%/yr, so the gate is about whether the number can drive a plan, not
about whether the data is wrong.
