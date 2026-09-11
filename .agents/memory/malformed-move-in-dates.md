---
name: Move-in date validation
description: Database-safe handling of malformed or unsupported rent-roll move-in dates.
---

PostgreSQL `to_date` is not a safe validator for rent-roll input: impossible values such as February 31 can raise an exception before a comparison can reject them. Supported date formats must be checked for both syntax and calendar validity before conversion, and invalid values must become a skipped diagnostic rather than a turnover event.

**Why:** A source-format defect should not abort the turnover calculation or silently become a normalized date that infers a replacement.

**How to apply:** Keep the accepted formats explicit, validate month/day/year ranges before calling `make_date`, aggregate skipped occupied-room transitions into a bounded diagnostic, and never classify a malformed value as a departure.