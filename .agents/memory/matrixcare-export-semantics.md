---
name: MatrixCare export semantics
description: Field semantics of the MatrixCare Corporate Room Charges and Special Room Rate exports, derived from the reference files, plus the scoping rules every exporter must follow.
---

# MatrixCare export semantics

## Every exporter reads through one rate service

Exports must be scoped to **one client** and **one upload month** (the newest), and must
resolve rates with the same precedence the UI shows:

    manual override -> rule-adjusted -> Modulo -> street

**Why:** the exporters originally queried the rent roll unscoped, so they averaged years of
history across two tenants at once, and each one picked a different rate column — meaning
the exported number matched nothing any screen displayed.

**How to apply:** never read rent roll rows directly in a new exporter. A candidate rate
that is null, non-finite or <= 0 is missing data, not a price — fall through to the next
candidate rather than exporting a zero.

## Facility identity is client-scoped

Location **names are only unique within a tenant**. Any name-based fallback for resolving a
facility must run over a client-filtered set, or a rent-roll row with a stale location id
can pick up another tenant's MatrixCare mapping.

Not every tenant has MatrixCare facility mappings populated at all. Skipping unmapped
facilities makes a correctly-scoped export look completely empty, which reads as a bug.

**Decision (owner's call): unmapped locations still export**, using a derived facility name
and id, rather than the export hard-failing or dropping those rows. The run reports them
via `X-Unmapped-Facility-Count` / `X-Unmapped-Facilities` response headers.

**Why:** most locations in some tenants have no mapping yet, so refusing to build the file
would block exporting entirely. The owner judged a warning sufficient and preferred a
complete file over a blocked one.

**How to apply:** do not "fix" this into a hard failure. If the risk of derived ids being
rejected downstream ever needs addressing, raise it as a product question first.

## Billing frequency must be classified in one place

Health-campus lines are per diem; senior housing is monthly; MatrixCare wants a daily
BasePrice. Classify the service line centrally — when each exporter kept its own list, an
unrecognised service line got converted in one file and left raw in another.

## Special Room Rate field semantics (derived from the reference export)

The reference file carries **no resident identifier columns** and ends every line with a
trailing empty field. Rows are one per occupied unit, using the in-house (contracted) rate,
because a special rate is a rate freeze rather than a proposed rate.

Field values follow the payer, not the row:
- **Private-pay payers** — bed-hold columns mirror the rate: hold flags 1, hold amounts
  equal to the amount, hold percents 0.
- **Insurance / managed-care payers** — the whole block is 0. These are fixed-rate payers
  unaffected by street pricing.
- **Monthly-billed senior housing** — Proration 2, Monthly 1 (and the two hold-monthly
  flags follow Monthly). **Daily-billed health campus** — Proration 1, Monthly 0.

**How to apply:** verify any change by diffing your generated header against the reference
file in `attached_assets/`, and re-derive value rules by frequency-counting the reference
rows rather than copying a single sample row — the dominant pattern covers only ~60%.

## Bed types

The Corporate Room Charges template keys pricing on BedTypeDescription
(Private / Semi-Private / Companion, sometimes with branded or rating suffixes), so a
single service-line average written to every bed type destroys the differentiation the
format exists to express. Several rent-roll room types legitimately collapse onto one bed
type — average within the group. B-bed companion rows stay excluded from these aggregates.
