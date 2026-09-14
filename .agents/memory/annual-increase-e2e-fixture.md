---
name: Annual increase end-to-end fixture
description: Constraints for keeping the Reference Data annual-increase endpoint regression executable against seeded demo data.
---

The endpoint regression must provision an MFA-enabled user, complete the password-first TOTP challenge, fetch CSRF, and remove sessions plus security dependents during teardown. Applying a plan creates a proposal, so Reference Data reconciliation reads recommendation fields until linked rules are implemented. Pin the planning horizon to the fixture's available prior January and widen only the test tier guardrails enough for both monthly and daily lines to be feasible.

**Why:** Authentication now leaves password-only test users in a pending session, proposal and implemented plan lifecycles publish different Reference Data fields, and persisted demo assumptions can point beyond the seeded historical window or reject the HC fixture as infeasible.

**How to apply:** When changing `tests/refDataAnnualIncrease.test.ts`, preserve the real calculate/apply calls and verify room-type plus service-line detail rollups in both monthly and daily billing modes.

Approval has two additional constraints: publish's due-date comparison must receive PostgreSQL dates as `YYYY-MM-DD` text, and implementing an annual-plan pair must not start background repricing before publish. The regression keeps the solver's next-year horizon for its January match, then makes only the test-created rule envelopes due so the real publish path can run.

**Why:** PostgreSQL date objects stringify as weekday text, which made due rules look future-dated; annual auto-repricing can update the same rule set while publish is calculating and cause a serializable approval retry.

**How to apply:** Keep annual implementation cache-only until publish, and exercise both implementation and publish plus repeated approval rejection when extending this fixture.