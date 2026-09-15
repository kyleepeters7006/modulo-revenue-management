import assert from "node:assert/strict";
import {
  getLatestRentRollCacheGeneration,
  getLatestRentRollSnapshot,
  getLatestRentRollSnapshotInFlight,
  invalidateLatestRentRollCache,
  setLatestRentRollSnapshot,
  setLatestRentRollSnapshotInFlight,
} from "../server/latestRentRollCache";

const tenantA = `cache-test-a-${Date.now()}`;
const tenantB = `cache-test-b-${Date.now()}`;
const snapshotA = { uploadMonth: "2026-09", rows: [] };
const snapshotB = { uploadMonth: "2026-08", rows: [] };

setLatestRentRollSnapshot(tenantA, snapshotA, getLatestRentRollCacheGeneration(tenantA));
setLatestRentRollSnapshot(tenantB, snapshotB, getLatestRentRollCacheGeneration(tenantB));
assert.equal(getLatestRentRollSnapshot(tenantA)?.uploadMonth, "2026-09");
assert.equal(getLatestRentRollSnapshot(tenantB)?.uploadMonth, "2026-08");

let resolvePending!: () => void;
const pending = new Promise<void>((resolve) => {
  resolvePending = resolve;
});
setLatestRentRollSnapshotInFlight(tenantA, pending as any);
assert.equal(getLatestRentRollSnapshotInFlight(tenantA), pending);

const staleGeneration = getLatestRentRollCacheGeneration(tenantA);
invalidateLatestRentRollCache(tenantA);
assert.equal(getLatestRentRollSnapshot(tenantA), null);
assert.equal(getLatestRentRollSnapshotInFlight(tenantA), null);
assert.equal(getLatestRentRollSnapshot(tenantB)?.uploadMonth, "2026-08");

setLatestRentRollSnapshot(tenantA, snapshotA, staleGeneration);
assert.equal(getLatestRentRollSnapshot(tenantA), null);

const freshGeneration = getLatestRentRollCacheGeneration(tenantA);
setLatestRentRollSnapshot(tenantA, { uploadMonth: "2026-10", rows: [] }, freshGeneration);
assert.equal(getLatestRentRollSnapshot(tenantA)?.uploadMonth, "2026-10");

resolvePending();
console.log("latest rent-roll cache tenant isolation and invalidation: ok");