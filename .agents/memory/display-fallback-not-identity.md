---
name: A display fallback is never an identity key
description: Why coalescing null/blank to a friendly label must not leak into grouping keys, React keys, or totals.
---

When a nullable dimension is coalesced to a friendly label for display — the
common case here being a missing room type shown as "Other" — that label must
stay in the display layer only. It must never become a grouping key, a React
list key, or the basis for a count.

**Why:** the coalesced value collides with real data. A missing room type, an
empty-string room type, and a room type genuinely named "Other" are three
distinct partitions in SQL, each carrying its own window-derived counts, but
they render identically. Grouping in memory on the display text silently merges
them and discards all but the first group's counts, so a report understates the
very problem it exists to surface. The same collision in a React key gives
sibling elements duplicate keys and corrupts reconciliation. Both failures are
quiet: no error, just wrong numbers and stale rows.

**How to apply:**
- Build the in-memory grouping key from RAW values, mirroring the SQL PARTITION
  exactly, with an explicit sentinel for null and a separator that cannot occur
  in the data. Apply the friendly fallback only to the field being displayed.
- Ship that raw key to the client as a stable id and use it as the list key.
- Derive totals from the aggregate the database computed, not from the length
  of a display array — display arrays get capped and filtered.
- When a list is capped for payload size, compute totals over everything BEFORE
  slicing, and tell the user the list is truncated while the counts are not.
