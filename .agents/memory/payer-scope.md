---
name: Payer scope — one definition of private pay
description: Why private pay is exclusion-based, the two payer vocabularies it must span, and the word-boundary trap in the short billing codes.
---

"Private pay" means **any payer that is not recognisably an externally-priced
programme**. It is defined once, as a JS predicate plus a SQL twin. A blank or
NULL payer counts as private.

**Why exclusion, not inclusion:** four definitions had grown up independently
and disagreed by a third on the same client-month. The inclusion-based ones
(`ILIKE '%private%'`, plus `'%pvt%'`) silently misclassify real residents — an
entire legacy private-pay bucket, plus held beds. A rule that must enumerate
every spelling of "private" fails on the next import that invents one, and it
fails by under-reporting, which looks plausible and so goes unnoticed.

**Why it is harder than it looks — there are TWO payer vocabularies:**
- The rent roll's payer column is a small controlled vocabulary. Exclusion is
  easy and safe here.
- The move-in/out events payer column is ~90 raw values from the billing
  system, full of insurer brand names. Critically it abbreviates Medicare as
  **MCR** and Medicaid as **MCD**, so the obvious MEDICARE/MEDICAID keywords do
  not match them. Unifying the two columns under the rent-roll-shaped keyword
  list silently reclassified roughly 46,000 Medicare Advantage admissions as
  private pay. Always check the actual distinct values of BOTH columns before
  assuming one predicate spans them.

**The word-boundary trap:** short codes must be matched as whole words, never
as substrings. `COMM` as a substring swallows "PRIVATE ACCOMMODATION"; `MCR`
swallows surnames like "MCRAE". Postgres `\y` is the twin of JS `\b`, so both
sides can match identically. Long distinctive keywords (MEDICAID, COMMERCIAL,
HOSPICE) are safe as substrings.

**How to apply:**
- Never write a payer test inline; always call the shared predicate/SQL.
- An exclusion list against an open vocabulary WILL eventually let an unknown
  brand through as private. The guard is a test that pins the classification of
  every payer value observed in production, so a new import fails loudly and
  the value gets classified deliberately.
- Verify the JS and SQL twins agree by classifying every distinct production
  value through both, not by reading them side by side.
- `medicaid_pct` / `medicare_pct` style metrics legitimately stay as targeted
  substring tests — they ask about one specific programme, not about scope.
- NULL payers are, in the observed data, always vacant units, so NULL-is-private
  only affects POTENTIAL revenue on empty units — where assuming we could price
  the unit is the point of the metric. That reasoning does NOT transfer to
  move-in events, where a blank payer is a real admission.
- Buckets that are billing/occupancy STATES rather than payer programmes
  (held beds, companion occupants, conversions, unassigned quick admits) count
  as private. Confirmed as a deliberate product decision, not payer truth.
- Beware the word "private" as a ROOM TYPE. Health-care private rooms make
  hundreds of rules and filters match a naive `%private%` search on rule
  payloads, none of which have anything to do with payer scope. Audit rule
  triggers by their parsed field name, not by substring-searching the JSON.
