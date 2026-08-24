---
name: Per-service-line turnover bands
description: Why a single portfolio-wide turnover sanity check cannot work across care levels, and the two distinct ceilings that apply.
---

## Rule
Plausibility bands for resident turnover must be **per service line**, and must be kept
distinct from the **model limit**.

Two different ceilings apply and conflating them causes real bugs:

1. **Model limit (0-100%).** The rate-planning projection converts annual turnover into a daily
   survival probability, `(1 - t) ^ (1/365)`. At or above 100% that has no real root, so the
   solver clamps. Nothing above 100% can be represented no matter how true it is. This is a hard
   input bound and belongs in validation.
2. **Plausible band (per line, much tighter).** Independent-living villas and a skilled-nursing
   health center do not turn over at remotely similar rates — roughly 25% versus several hundred
   percent a year in the same portfolio. One portfolio-wide check either waves through nonsense
   for the slow lines or rejects normal behaviour for the fast ones.

**Why:** A single 100% ceiling accepted a memory-care reading of 14%/yr, which implies a
seven-year memory-care stay. That direction of error is the dangerous one — it is quiet, and it
understates how much of next year's growth arrives for free from re-pricing vacated units, so it
makes in-house rate increases look far more load-bearing than they are. **A floor matters as much
as a ceiling.**

**How to apply:**
- Order the bands by acuity. Independent living turns over slowest, memory care and skilled
  nursing fastest. If the slowest line's ceiling is not below the fastest line's floor, the bands
  are not actually distinguishing care levels.
- Judge the *rounded* figure — the one printed in the UI. Judging the unrounded value lets a badge
  read "85%" beside an "expected 30-85%" warning.
- **Warn, never clamp.** A fabricated turnover is far more dangerous than a flagged one, because
  it produces a plausible-looking plan aimed at the wrong target. Report the measured value, say
  why it was rejected, and leave the operator's number in place.
- Where measured history is known to be distorted (e.g. discharges filed against the wrong line),
  set the band from published length-of-stay norms rather than from the client's own data, and say
  so — otherwise the band launders the defect into a sanctioned range.
- Keep two precedence rules apart, and say which is which in the code:
  - **Band defaults never overwrite stored data.** Seed a per-line default from the band only when
    nothing has been saved at any scope. A stored value that falls outside its band earns a
    warning, not a rewrite.
  - **Measured in-band history deliberately does outrank a stored value** — that is the point of
    measuring it. Make the substitution visible ("replaces the saved 30%") rather than just
    displaying the new number, or the plan quietly stops being the one the operator signed off on.
