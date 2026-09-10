import assert from "node:assert/strict";
import { registerInhousePlanningRoutes } from "../server/routes/inhousePlanningRoutes";

const registered = new Set<string>();
const fakeApp = {
  get(path: string) {
    registered.add(`GET ${path}`);
  },
  post(path: string) {
    registered.add(`POST ${path}`);
  },
};

registerInhousePlanningRoutes(fakeApp as any);

assert.ok(
  registered.has("POST /api/inhouse-planning/calculate"),
  "the integrated Calculate Plan endpoint remains available",
);
assert.ok(
  registered.has("POST /api/inhouse-planning/export"),
  "the integrated export endpoint remains available",
);
assert.ok(
  registered.has("POST /api/inhouse-planning/apply"),
  "the integrated submit endpoint remains available",
);
assert.ok(
  registered.has("GET /api/inhouse-planning/plans"),
  "plan history remains available",
);
assert.equal(
  registered.has("POST /api/inhouse-planning/recommendations"),
  false,
  "the obsolete recommendation endpoint is removed",
);
assert.equal(
  registered.has("GET /api/inhouse-planning/recommendations/latest"),
  false,
  "the obsolete latest-recommendation endpoint is removed",
);
assert.equal(
  registered.has("POST /api/inhouse-planning/recommendations/edit"),
  false,
  "the obsolete recommendation edit endpoint is removed",
);
assert.equal(
  registered.has("GET /api/inhouse-planning/plans/:planId/street-rate-review"),
  false,
  "historical Street Rate review reopening is removed",
);

console.log("In-house planning legacy removal tests: passed");