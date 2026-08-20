---
name: Revenue must state its payer basis
description: Total vs private-pay revenue are separate labelled metrics; never report one unlabelled.
---

Every revenue figure is reported on **both** bases, separately and labelled:
total (all payers, ties to the operator's books) and private pay (residents
whose rate we set — the only revenue street pricing can move).

**Why:** surfaces silently disagreed because they had each picked a basis and
said nothing. The overview tiles were private-pay filtered; the revenue chart,
Reference Data YTD revenue and campus revenue impact were unfiltered totals.
On real data private pay is only ~43% of total revenue, so the same "revenue"
label meant numbers differing by more than 2x depending on which page you were
on.

**How to apply:**
- New API fields name the basis explicitly (`...PrivatePay` / `...Total`).
  Legacy unsuffixed fields keep their established private-pay meaning so no
  consumer silently changes basis.
- The vacant-unit HC 21% / HC-MC 31% private-pay haircut applies to the
  private-pay basis ONLY. Applying it on a total basis understates total
  potential revenue by nearly 5x.
- Never blend the two into one number, and never show a revenue figure whose
  basis is not stated in the UI.
