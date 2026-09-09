import assert from "node:assert/strict";

const BASE = process.env.TEST_BASE_URL || "http://localhost:5000";

async function post(path: string, body: unknown) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// The exact data result can vary with the current demo dataset; the security
// contract is that anonymous demo requests reach the endpoint instead of
// being rejected by the global MFA gate.
const calculate = await post("/api/inhouse-planning/calculate", {
  serviceLine: "AL",
});
assert.notEqual(calculate.status, 401, "anonymous demo calculation is not MFA-gated");

const recommendations = await post("/api/inhouse-planning/recommendations", {
  serviceLine: "AL",
  maximumPremiumAboveTopCompetitorPct: 3,
});
assert.notEqual(recommendations.status, 401, "anonymous demo recommendations are not MFA-gated");

const apply = await post("/api/inhouse-planning/apply", {
  serviceLine: "AL",
  assumptions: {},
});
assert.equal(apply.status, 401, "anonymous demo users cannot submit a plan");

console.log("In-house planning demo access tests: passed");