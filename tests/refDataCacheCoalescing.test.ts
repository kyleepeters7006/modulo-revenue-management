import {
  getRefDataCache,
  getRefDataInFlight,
  invalidateRefDataCache,
  setRefDataCache,
  startRefDataCompute,
} from "../server/refDataCache";

let passed = 0;
let failed = 0;
const ok = (description: string, condition: boolean) => {
  if (condition) {
    console.log(`✓ ${description}`);
    passed++;
  } else {
    console.error(`✗ ${description}`);
    failed++;
  }
};

const key = "grouped:test";
invalidateRefDataCache();
startRefDataCompute(key);
const firstWaiter = getRefDataInFlight(key);
startRefDataCompute(key);
const secondWaiter = getRefDataInFlight(key);

ok("concurrent misses share one promise", firstWaiter === secondWaiter);

const payload = { rows: [{ campus: "Alpha" }] };
setRefDataCache(key, payload, Date.now());
ok("the shared computation populates the cache", getRefDataCache(key) === payload);
ok("all waiters receive the same payload", await firstWaiter === payload);
ok("in-flight ownership clears after completion", getRefDataInFlight(key) === null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);