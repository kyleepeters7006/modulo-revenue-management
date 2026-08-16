---
name: Competitive survey data scoping and AL/MC competitor mapping
description: Diagnose empty competitor benchmarks in tenant order (session → user row → predicate), and treat the AL/MC competitor-type mapping as data-dependent rather than fixed.
---

# Empty competitor benchmarks: diagnose in this order

**Rule:** when a competitor benchmark, price position or AI commentary comes back
empty for one tenant but not another, work through the causes in likelihood order
before touching any query:

1. an unauthenticated session silently resolving to the demo tenant;
2. a user row whose client_id is null, routing a real user to demo;
3. survey rows that were imported without a tenant stamped on them.

**Why:** cause 3 is the memorable one — the survey table was originally imported
with no tenant on any row, so a plain equality predicate filtered out everything —
but it is the rarest, and rewriting a query to chase it hides the first two. A
NULL-tolerant predicate is still worth keeping as insurance against an import that
forgets to stamp the tenant, since it costs nothing when the data is clean.

**How to apply:** confirm which tenant the request actually resolved to before
concluding the data is missing. Note that different surfaces reach this data
through different query paths, so one page working is not evidence that the
predicate is right.

# AL/MC competitor-type mapping

**Rule:** there is no permanently correct value for the AL/MC entry in the
service-line-to-competitor-type map. It depends on whether the client's survey
import actually produced AL/MC rows.

**Why:** mapping AL/MC to itself alone is right where the import populates AL/MC
rows. It is wrong for any client whose survey contains none — those locations get
no competitor benchmark and no price position, and they fail silently rather than
erroring.

**How to apply:** check the actual competitor-type distribution for that client
before changing the mapping, and remember that widening it moves every surface
that consumes the benchmark, not just the one being debugged.
