---
name: Occupancy source of truth
description: room_type_occupancy_history is the authoritative occupancy source; rent_roll_data.occupied_yn is a fallback for clients without RTO uploads.
---

## Rule
Always read occupancy from `room_type_occupancy_history` (SUM occ_units / SUM available_units). Fall back to `COUNT(*) FILTER (WHERE occupied_yn)` from `rent_roll_data` only when RTO has no rows for that client.

**Why:** The RTO table stores physically-distinct room counts uploaded from operator census reports. `occupied_yn` in rent_roll_data reflects the raw import which can double-count beds (B-beds, companion rooms split into multiple rows) or lag behind the actual census. For trilogy, RTO shows ~89% while occupied_yn shows ~46% — a massive discrepancy.

**How to apply:**
- Before adding any new endpoint that shows occupancy, check whether it queries RTO first.
- Pattern: query RTO grouped appropriately, set `hasRTO = avail > 0`, use RTO when true.
- For combined service_line strings (e.g. "AL, AL/MC"): split on comma, attribute occ/avail to each token. Or aggregate at location level to avoid double-counting.
- Endpoints confirmed already using RTO: /api/overview, /api/analytics/campus-metrics, /api/pricing-controls/commentary, rule-performance endpoint.
- Endpoints fixed to use RTO: /api/ai/suggest, /api/ai/chat, /api/pricing-controls/competitive-position, single-unit AI pricing.
