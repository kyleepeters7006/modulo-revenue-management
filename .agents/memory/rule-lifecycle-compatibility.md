---
name: Rule lifecycle compatibility
description: Compatibility and safety rules for proposed, implemented, disabled, and historical pricing rules.
---

The lifecycle is additive: `proposed`, `implemented`, `disabled`, and `historical` are explicit states, while a NULL lifecycle on a legacy row is interpreted from the existing flags (active means implemented; inactive means disabled). Proposals must be both inactive and explicitly proposed so older `isActive`-only consumers cannot price them.

**Why:** Existing rule consumers do not all use the same query path, and fabricating implementation timestamps for old rows would make historical provenance untrustworthy.

**How to apply:** Keep lifecycle gating centralized in active-rule retrieval and repeat it in reporting queries. Only an authenticated admin may transition a proposal, and implementation timestamps should be used for projected rule provenance.