---
name: Street-rate quality rules
description: Why own street-rate plausibility must be relative, prorated move-in semantics, and the daily/monthly trap
---

- The rent-roll export overwrites the street rate with the resident's **prorated first-month charge** in the move-in (or move-out) month — street rate equals in-house rate and the affected units churn monthly. Expected source behavior, not corruption; the month after, the rate "recovers", so classify both the collapse and the rebound as prorated (resident event in current OR previous month).
- Second-occupant tags (`2ND OCCUPANT`, `LEGACY - 2ND OCCUPANT`) live in **payor_type**, not room_type; those rows are B-bed companion surcharges and must be excluded from every street-rate suspect rule and median.
- HC/HC-MC street rates are natively DAILY ($300–900 normal); absolute monthly floors mass-false-positive. Plausibility checks must be relative (order-of-magnitude shift vs prior month) and medians must be grouped per location+service line — campus-wide medians flip when the daily/monthly bed mix shifts.
- Original rent-roll upload files are never persisted (all import paths parse in-memory buffers), so a bad month cannot be re-imported without the user re-uploading; unit-change defects (e.g. a campus loaded in daily rates, exactly ×30 off) must be repaired via a committed idempotent script.

**Why:** prorated rows and daily HC rates are the two main ways street-rate cleanup work regresses into false positives; the Goshen daily-rate upload is the canonical unit-change defect.
**How to apply:** any street-rate validation, aggregate, or cleanup must exclude second-occupant payor rows, treat HC lines as daily, and treat move-in-month rate collapses (and next-month rebounds) as expected.
