---
name: Below-target plan proposals
description: Submission policy for in-house plans that cannot reach the configured rate-growth target.
---

A calculated in-house plan may be submitted as a proposal even when one or more service lines do not reach the target. Feasibility is decision context, not a submission gate.

**Why:** The proposal workflow exists for review and does not change live rates until implementation and publishing. The user explicitly confirmed that below-target outcomes must remain reviewable and submittable.

**How to apply:** Keep below-target warnings informational and preserve infeasibility details in the saved plan. Submit every calculated service line. Block only when the exact raw input snapshot captured at calculation differs from current inputs; canonicalize JSON object keys because PostgreSQL JSONB can reorder identical policies. Returned solver assumptions are normalized and can also create false stale warnings. Persist that snapshot with restored calculations, with a per-line identity when a multi-line result can later be opened one line at a time.