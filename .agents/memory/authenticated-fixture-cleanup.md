---
name: Authenticated fixture cleanup
description: Database cleanup requirements for tests that create local authenticated users.
---

Authenticated test users must have their security audit rows removed before the user is deleted; those audit records intentionally retain a foreign-key reference.

**Why:** MFA login exercises create security audit records, and deleting the fixture user first fails with a foreign-key violation.

**How to apply:** In API tests that create users and complete authentication, delete dependent audit/session records during teardown before deleting the user and throwaway client.