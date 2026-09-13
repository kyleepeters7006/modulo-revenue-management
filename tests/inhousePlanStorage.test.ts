import { strict as assert } from "node:assert";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const localStorage = new MemoryStorage();
(globalThis as any).window = {
  indexedDB: undefined,
  localStorage,
};

const {
  readInhousePlan,
  writeInhousePlan,
} = await import("../client/src/lib/inhousePlanStorage");

const identity = "client::user";
const scope = "ALL_CAMPUSES::AL,HC";
const saved = {
  plans: [{ sl: "AL", plan: { summary: {} } }],
  lastRunAt: "2026-09-13T15:42:00.000Z",
};

assert.equal(
  await writeInhousePlan(identity, scope, saved),
  true,
  "localStorage fallback reports a successful save",
);
assert.deepEqual(
  await readInhousePlan(identity, scope),
  saved,
  "saved plan and timestamp survive a read-after-write round trip",
);
assert.equal(
  await readInhousePlan(identity, "ALL_CAMPUSES::VIL"),
  null,
  "a different filter scope cannot restore this plan",
);
assert.equal(
  await readInhousePlan("other-client::user", scope),
  null,
  "a different identity cannot restore this plan",
);

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  },
});
(globalThis as any).window.indexedDB = {
  open: () => {
    throw new Error("iOS must not open IndexedDB for calculated plans");
  },
};
const iosScope = "ALL_CAMPUSES::SL";
assert.equal(
  await writeInhousePlan(identity, iosScope, saved),
  true,
  "iOS writes the compact plan through localStorage without opening IndexedDB",
);
assert.deepEqual(
  await readInhousePlan(identity, iosScope),
  saved,
  "iOS restores the compact plan without opening IndexedDB",
);

(globalThis as any).window.localStorage = {
  getItem: () => null,
  setItem: () => {
    throw new Error("storage denied");
  },
  removeItem: () => {},
};
assert.equal(
  await writeInhousePlan(identity, scope, saved),
  false,
  "a genuine storage failure is reported",
);

console.log("In-house calculated-plan storage tests passed");