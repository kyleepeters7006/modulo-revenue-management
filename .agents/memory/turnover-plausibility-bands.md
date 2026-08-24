---
name: Per-service-line turnover bands
description: Industry-sourced LOS ranges converted to annual turnover bands; two distinct ceilings; warn-not-clamp policy.
---

## Rule
Plausibility bands for resident turnover must be **per service line** (LOS varies 4× across care levels) and must be kept distinct from the **model limit**.

### Two distinct ceilings
1. **Model limit (0–100%).** The projection converts annual turnover into a daily survival probability, `(1 - t) ^ (1/365)`. At or above 100% that has no real root; the solver clamps. Hard input bound.
2. **Plausible band (per line, tighter).** Advisory only — warn, never clamp.

### Industry-sourced bands (Argentum, NIC MAP, MedPAC, Alzheimer's Assoc.)
| Line | Band | Typical | Published LOS basis |
|------|------|---------|---------------------|
| VIL | 10–50% | 25% | NIC MAP: median 4–5 yr (20–25%/yr) |
| SL | 15–55% | 33% | NIC MAP: median 2.5–3.5 yr (29–40%/yr) |
| AL | 20–85% | 55% | Argentum: median ~22 months (55%/yr) |
| AL/MC | 30–100% | 75% | Argentum/Alzheimer's Assoc.: median 15–16 months (75%/yr) |
| HC | 55–100% | 80% | MedPAC: mixed short-stay PP (~20 days) + long-stay PP (~600–900 days) |
| HC/MC | 25–100% | 60% | MedPAC long-stay: 18–30 months, long-stay custodial |

**Band ordering guarantee:** VIL.max (50%) < HC.min (55%) — tested in inhouseTurnoverHistory.test.ts.
**Acuity ordering:** VIL(25) < SL(33) < AL(55) < AL/MC(75) < HC(80) — also tested.

### Key policy rules
- **Band defaults never overwrite stored data.** Seed a per-line default only when `scopeLevel === "default"`.
- **Measured in-band history outranks a stored value.** When it displaces one, the evidence line says so explicitly ("replaces the saved 30%").
- **A floor matters as much as a ceiling.** AL/MC at 14%/yr (7-year memory-care stay) was the dangerous false negative. The floor catches it.
- **Set bands against bedhold-excluded measurements.** Bedholds inflate AL by ~13%; bands were calibrated on bedhold-excluded data.
- **LOS is the sanity-check lever.** `losMonths = 1200 / turnoverPct`. Show it so operators can ground-check by care-level intuition.
