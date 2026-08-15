---
name: Client pricing-workbook reconciliation
description: How to tie the platform's rent-roll figures to the client's Excel pricing workbook, which conventions make the two agree, and the data defects the tie-out exposes.
---

# Reconciling to the client's Excel pricing workbook

The client's quarterly "Pricing Analysis" workbook (tab `Pricing-All Campuses`, one row per
campus x service line x room type) is the best external benchmark for validating platform
rent-roll data. Done on the right basis, unit counts tie **exactly**.

## The four conventions that make the two sides agree

1. **B-bed exclusion.** The workbook excludes companion `/B` rows for AL, AL/MC, SL and VIL,
   and includes every bed for HC and HC/MC. Applying that same rule reproduces the workbook's
   counts; VIL tied to within one unit, which is the strongest confirmation the convention is right.
2. **Kingston is out of scope.** Campuses whose code begins with `K` (e.g. `Ashland KOA-0554`)
   exist in our rent roll but are deliberately excluded from the workbook, which reports
   "Total Units (ex Kingston)". Always drop them before comparing, or every service line
   looks inflated.
3. **The workbook has an `AL/SL` service line that we do not.** Those units land in our `SL`.
   Fold `AL/SL` into `SL` on the workbook side or SL appears ~30% over.
4. **HC in-house rate is private-pay only.** The workbook's HC in-house figure is the private-pay
   rate. Averaging our `in_house_rate` across all payors blends in Medicaid/Medicare/MA
   reimbursement and overstates it by ~7%.

**Why:** without these four, headline variances of +13% (AL), +57% (SL) and +7% (HC in-house)
look like platform bugs when they are basis differences. With them, totals matched exactly
(13,954 units both sides) and occupancy landed within ~1pt per line.

**How to apply:** any time someone asks whether platform numbers are "in the right ball park",
reconcile on this basis first, then treat what remains as a real variance.

## What a correct tie-out actually exposes

Once the basis is right, the residual variances are genuine data defects, not methodology:

- **Daily-magnitude rates in monthly street-rate fields.** A subset of AL/AL-MC/SL/VIL units
  carry street rates in the tens or low hundreds (e.g. $189, $107) where a ~$5,000 monthly rate
  belongs, plus a few hard zeros. These drag the AL street average down ~2.6%; excluding them
  brings it to within 0.4% of the workbook. The defect recurs every month, so it is an ingest
  problem, not a one-off bad file.
- **Corrupt derived competitor rates.** `competitor_final_rate` is a *derived* column and blows
  up in both directions — values in the hundreds of millions alongside monthly rates reduced to
  daily magnitude — while `competitor_base_rate` on the same row stays sane. It is averaged into
  room-type and service-line competitor rates, so the corruption reaches displayed competitive
  position. Sanity-band this column before trusting any comp comparison.
- **Care Level 2 drift of exactly +4%.** Where our care rates differ from the workbook they are
  almost always the workbook value x 1.04 — an escalator applied on one side only, not random
  error. Treat an exact-4% pattern as an effective-date question, not a data-quality one.

**Why:** these three survived a clean tie-out, so they are attributable to the platform rather
than to differing definitions.

## Room-type taxonomy will not join cleanly

The workbook uses granular, campus-specific room-type names (`1BR`, `One BR Apt Deluxe`,
`Compan`, `Studio - Double 300 SQ FT`) which we collapse into a small canonical set. In
particular a double-occupancy studio maps to `Companion` for us but is counted as a studio in
the workbook, so our Companion population is roughly double theirs even though campus totals
agree. Compare at campus x service line; only drill to room type after normalizing branded
prefixes, and expect the split to disagree even when the total is right.
