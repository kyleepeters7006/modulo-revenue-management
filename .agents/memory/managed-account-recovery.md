---
name: Managed-account recovery
description: Security boundaries for administrator-managed accounts, password recovery, and MFA resets.
---

Administrators may create and edit accounts only inside their current tenant. Account setup and password recovery use emailed, expiring, single-use links whose raw tokens are never stored. Users who still control an enrolled authenticator may also reset their own password with username, a current TOTP code, and a policy-compliant new password. Administrators never choose another user’s password and never enroll MFA on another user’s behalf. MFA reset is a separate audited action that revokes sessions and requires the user to enroll their own factor again.

Account-activity visibility has one deliberate exception: administrators authenticated in the Trilogy tenant may review security activity partitioned into a Trilogy section and one section for every other tenant. Administrators in all other tenants may review only their own tenant’s activity. This exception applies to activity review, not cross-tenant user editing.

**Why:** Combining administrator-selected passwords or MFA secrets with account management lets an administrator impersonate the user and weakens the independence of the second factor. Self-service password reset is safe only while the existing second factor remains intact. Separating password and MFA recovery also avoids silently removing both protections during a routine password reset.

**How to apply:** Keep future user-management, invitation, recovery, and support flows tenant-scoped. Self-service password reset accepts TOTP only, never recovery codes; consumes the TOTP step once; uses shared account/IP rate limits and account-safe responses; attributes successful audits to the target; and revokes sessions plus outstanding reset links atomically. Preserve the Trilogy-only, read-only activity-review exception and keep each tenant visibly partitioned. Store only reset-token digests. A user-facing deletion must be a marked soft deletion that disappears from account management while preserving historical attribution; prevent self-deletion and removal of the last active tenant administrator.