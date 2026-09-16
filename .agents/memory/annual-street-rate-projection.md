---
name: Annual street-rate projection
description: How Reference Data should display portfolio or campus annual street-plan targets on room-type rows.
---

An annual plan's stored recommended street rate is an absolute portfolio/campus summary, while its linked street rule is a percentage adjustment. Reference Data must project that percentage from each room group's current, outlier-gated Street Rate; it may use the stored absolute target only for legacy plans whose linked percentage is unavailable.

**Why:** Copying the portfolio target onto every room type made a $6,999 Companion row display a false decrease when the plan's $6,148 target was a 4% portfolio increase.

**How to apply:** Load the linked annual street rule percentage with the plan scope, project it against each row's streetSpot for both proposed and applied plans, and keep plan history/export on the stored absolute target basis.