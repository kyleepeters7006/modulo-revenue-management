---
name: Street-rate aggregation — mode vs average
description: Reference Data uses modal street rate, other surfaces use AVG; junk sub-$1000 rows in the rent roll make the two disagree.
---

# Street-rate aggregation: mode vs average

Reference Data computes the spot street rate with `mode() WITHIN GROUP (ORDER BY rr.street_rate)` —
the most common rate for the group. Other surfaces (notably the Competitive Position scatter)
use plain `AVG(rr.street_rate)`. When the rent roll contains a junk rate, the two disagree and
the average is the wrong one.

**Why:** the rent roll carries a meaningful number of nonsense street rates — rows with a
positive but absurdly low value (e.g. a $159 studio, a $1,269 one-bedroom). These are data
entry / feed artifacts, not real pricing. A modal rate ignores them; an average does not.
Scale when last measured: a few hundred rows above $0 but under $1,000 spread across the
majority of senior-housing campuses in a single month. Assume it is always non-zero.

**How to apply:**
- Any new surface reporting "our rate" for a room type should use the modal rate, matching
  Reference Data. Do not invent a separate outlier threshold — inconsistent thresholds are how
  these surfaces drifted apart in the first place.
- When two surfaces disagree on our own rate for the same units, check for a junk row before
  suspecting the room-type filter or the B-bed predicate.
- B-bed exclusion incidentally hides some junk rows (bad values often land on the `/B` bed), so
  a surface that excludes B beds can look correct while the underlying data is still dirty.
  Do not read that as evidence the aggregate is safe.
