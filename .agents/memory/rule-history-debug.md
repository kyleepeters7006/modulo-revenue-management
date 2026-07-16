---
name: Rule History debugging lessons
description: Three root causes fixed for 0 move-ins / 0 speed vs expected in the Rule History (rule-performance) section.
---

## Root Causes

### 1. Room type filter mismatch
Historical rules store raw room types in `action.filters.roomType` (e.g., "1BR", "Compan", "MC-Studio", "Private", "Legacy Lane - Companion"). The `rent_roll_data` table stores standardized types ("One Bedroom", "Companion", "Studio", "Studio Dlx", "Two Bedroom"). Without normalization, every April 2026 rule generated 0 candidates and was skipped.

**Fix:** Apply `normalizeRoomType()` to each value in `filters.roomType` before filtering cohort candidates.

**How to apply:** Any time historical rule roomType filters are matched against DB data, normalize first.

### 2. Date window too narrow
Default window was 90 days. April 2026 rules have `effective_date = 2026-04-01` which is 106+ days ago. They were excluded from `histRes` query by `effective_date BETWEEN $startDate AND $endDate`.

**Fix:** Extended default window to 180 days in both backend (server/routes.ts rule-performance endpoint) and frontend (rule-performance-table.tsx `isoDaysAgo(180)`).

**Why:** April effective dates are a regular occurrence — any quarterly pricing round will fall outside a 90-day window.

### 3. soldAfterRule always false for non-demo clients
Trilogy `move_in_date` data maxes at Sep 2025. Historical rules from Apr/Jul 2026 require `moveIn >= effectiveDate` which always fails. Also: July 2026 rules use June 2026 as their cohort snapshot (latest available), and the latest snapshot is also June — so no vacant→occupied transitions can be detected for July rules.

**Fix:** Added cohort-based soldAfterRule detection: if unit was vacant (`!u.occupied_yn`) in the cohort snapshot at the rule's effective month AND is now occupied (`latest.occupied_yn`) → counts as a post-rule move-in. Added `occupied_yn` to the cohort SELECT query.

**Why:** This is the only reliable proxy for "units filled after the rule was applied" when move_in_date data lags or is absent.

### 4. Speed vs expected always null
`avgExp` (expected days-to-sell baseline) was only accumulated for `soldAfterRule` units. Since `soldAfterRule` was always false, `avgExp = null`, and `daysFasterThanExpected = null`.

**Fix:** Added `allExpSum/allExpN` fields to `Agg` type — accumulated for ALL impacted units regardless of sold status. In `finish()`, `avgExp` falls back to `allExpSum/allExpN` when no actual sold units exist. This enables the comparison against `projDts` (days_vacant of occupied units).
