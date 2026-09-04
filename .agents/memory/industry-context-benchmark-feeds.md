---
name: External benchmark feeds
description: Operational constraints for public economic benchmark sources used in meeting context.
---

Anonymous BLS API requests can be rejected after the shared daily request threshold is exhausted. A failed refresh must never become zero, a fabricated estimate, or a falsely current card; keep the last successful value when one exists and otherwise show the metric as unavailable.

**Why:** the dashboard is used to frame pricing decisions, so a plausible-looking fallback is more dangerous than a visible missing source. Reviewed NIC, CBRE, and peer-company snapshots are also valid context but have different publication cadences and must show their own freshness state.

**How to apply:** check the provider response status before normalizing data, cache successful live values conservatively, label stale last-known values, and keep source URL/as-of metadata on every card. Prefer a managed provider key or scheduled refresh for production scale rather than increasing anonymous request volume. Persist refresh health separately from metric values so provider failures and revisions remain visible after restarts.

Admin corrections to stale/unavailable benchmarks are reviewed overrides, not
edits to provider snapshots. Store them per client with updater/time provenance;
do not let the next BLS refresh overwrite them. Peer-comparison graphics follow
the same tenant-scoped, admin-managed rule.

**Why:** meeting materials need timely manual correction when public feeds lag,
without destroying the source observation or leaking one client's reviewed
materials into another client's dashboard.