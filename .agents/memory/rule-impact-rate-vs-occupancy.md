---
name: Rule impact must isolate rate effect from occupancy
description: Realized "rule performance" revenue impact must attribute only the rate effect; census swings dominate total-revenue deltas and invert the sign.
---

# Realized rule impact = rate effect only

When measuring what a pricing rule actually delivered (the "before vs after" realized
method that compares a group's occupied revenue across the months surrounding the rule's
effective date), attribute **only the rate effect** to the rule:

```
rateBefore = revBefore / occBefore
rateAfter  = revAfter  / occAfter
rateEffect = (rateAfter - rateBefore) * occBefore   <- the rule's impact
occEffect  = (occAfter - occBefore) * rateAfter     <- context only, never attributed
rateEffect + occEffect == rawRevenueAfter - rawRevenueBefore
```

**Why:** a raw total-revenue delta measures census, not price. Occupancy/turnover swings
are worth far more than any rate move, so the raw delta routinely inverts the sign — rate
*concession* rules showed large gains and rate *increase* rules showed large losses, and a
portfolio total read deeply negative while a majority of individual rules were positive.
Measured on real data the split was roughly +$673K/mo rate effect against −$494K/mo
occupancy effect, i.e. the occupancy term swamped and reversed the real result.

**Also:** a pricing rule only changes what *new* move-ins pay. Existing residents keep
their in-house rate, so total group revenue is dominated by who moved in and out, not by
the rule.

**How to apply:**
- Express the "after" figure at constant (pre-change) occupancy so `after - before` *is*
  the rate effect and any before/after breakdown shown to the user reconciles with the
  impact figure.
- If either window has zero occupied units there is no realized rate to compare — report
  no result and fall back to the projected rate delta. Returning the raw revenue delta
  there silently reintroduces the contaminated metric under a "rate effect" label.
- Keep the headline win-rate, per-row win/loss badges, the impact column and the footer
  total on **one** basis. This metric was wrong for a long time precisely because the
  frontend win-rate normalized occupancy out while the impact column did not, so the
  header ("most rules grew revenue") contradicted the total (deeply negative). If one
  layer adjusts, no other layer may re-adjust — that double-counts.
