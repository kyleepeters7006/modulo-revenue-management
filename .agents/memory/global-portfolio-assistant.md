---
name: Global portfolio assistant boundaries
description: Security and data-access rules for the all-pages Claude assistant
---

**Rule:** The global assistant uses Claude Opus through Replit AI Integrations and can access portfolio facts only through a fixed registry of bounded, read-only, tenant-scoped tools. It must never execute model-provided SQL, code, URLs, table names, or operations; expose resident PII or raw notes; or fall back to the demo tenant when authentication is absent or stale.

**Why:** A conversational model needs broad analytical coverage, but unrestricted database access or a default tenant would turn prompt injection, stale sessions, and ambiguous identity into cross-tenant or personal-data exposure. The tool boundary keeps authorization and query shape under server control.

**How to apply:** Add new data domains as explicit server tools with validated inputs, hard row/date limits, `client_id` predicates derived from the authenticated session, and safe provenance labels. The assistant and AI rule generator must import one shared rule-suggestion contract sourced from the parser's supported metrics so grammar, sign conventions, overlap precedence, scope, and impact semantics cannot drift. Use the exact `claude-opus-4-6` model for this assistant, omit non-default sampling parameters, and keep prompts/tool payloads out of audit logs.