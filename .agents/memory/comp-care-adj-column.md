---
name: Competitor care ADJ column
description: What the competitor ADJ column means, why it repeats across room types, and the destructive inverse-write behind the editable "Care Adj." cell.
---

## The ADJ column is a differential, never a rate

The competitor card's ADJ column is `theirCareLevel2 − ourCareLevel2`, not the competitor's
care fee. `adjusted = base + careAdj`, so a competitor whose care schedule is richer than ours
shows a positive ADJ even when neither side's raw care rate resembles that number.

**Why:** the comparison must put both sides on our care basis before variance is computed.
Reading ADJ as "their care fee" makes every figure look like an override or an import error.

**How to apply:** when a user questions an ADJ value, resolve it against two sources — the
survey row's care level 2 for that competitor/type/month, and `care_level_rates` for that
campus + service line. If the subtraction reproduces the number, it is computed, not stored.

## The value is constant across room types by construction

Competitors publish one care schedule per community; our rate is one row per campus +
service line. Only the base rate varies by room type, so ADJ is identical down the column.
A uniform ADJ is the expected shape, **not** evidence of a stuck value or a bulk override.

## Editing "Care Adj." rewrites the competitor's surveyed care rate

The Competitive Data page renders a *difference* in an editable cell, but the PATCH handler
back-solves and stores `competitorCareL2 = enteredAdj + ourCareL2` onto the survey row.

**Why:** there is no adjustment column on the survey table — only the raw care rate — so the
displayed delta has to be inverted before it can be persisted.

**How to apply:** treat this cell as destructive to imported survey data, and note that its
stored result silently shifts whenever our own care rate changes (a care-rate backfill
re-derives every ADJ built on top of it). Prefer correcting `care_level_rates` or the survey
care rate directly over typing a target delta into this cell.

## Two care-adjustment lineages exist and can disagree

Live endpoints recompute the differential on read. `rent_roll_data` also carries a stored
per-unit care adjustment written by the competitor rate-matching job. The stored column goes
stale as soon as either side's care rate moves, so it can disagree sharply with what the UI
shows. Never cite the stored column as the explanation for an on-screen ADJ.
