import assert from "node:assert/strict";
import {
  calculatedPlanScopeKey,
  filterPlansForScatterScope,
} from "../client/src/pages/inhouse-increases";

function plan(locationId: string | null, location: string) {
  return {
    scope: { locationId, location },
  } as any;
}

const plans = [
  { sl: "AL", plan: plan("campus-a", "Campus A") },
  { sl: "HC", plan: plan("campus-a", "Campus A") },
  { sl: "AL", plan: plan("campus-b", "Campus B") },
  { sl: "AL", plan: plan(null, "All campuses") },
  { sl: "HC", plan: plan(null, "All campuses") },
];

const labels = (locationId: string | null, serviceLines: string[]) =>
  filterPlansForScatterScope(plans, locationId, serviceLines)
    .map(({ sl, plan: current }) => `${current.scope.location ?? "unknown"}:${sl}`);

assert.deepEqual(
  labels("campus-a", ["AL", "HC"]),
  ["Campus A:AL", "Campus A:HC"],
  "campus changes must remove every point from the previous campus",
);
assert.deepEqual(
  labels("campus-b", ["AL", "HC"]),
  ["Campus B:AL"],
  "a campus scope must not retain points from another campus",
);
assert.deepEqual(
  labels("campus-a", ["HC"]),
  ["Campus A:HC"],
  "service-line changes must remove unselected lines",
);
assert.deepEqual(
  labels(null, ["AL", "HC"]),
  ["All campuses:AL", "All campuses:HC"],
  "the portfolio scope must use aggregate service-line plans only",
);
assert.deepEqual(
  labels(null, ["AL"]),
  ["All campuses:AL"],
  "portfolio service-line filtering must remain exact",
);

assert.notEqual(
  calculatedPlanScopeKey("campus-a", ["AL"]),
  calculatedPlanScopeKey("campus-b", ["AL"]),
  "campus changes must change the scatter remount key",
);
assert.notEqual(
  calculatedPlanScopeKey("campus-a", ["AL"]),
  calculatedPlanScopeKey("campus-a", ["HC"]),
  "service-line changes must change the scatter remount key",
);
assert.equal(
  calculatedPlanScopeKey(null, ["HC", "AL"]),
  calculatedPlanScopeKey(null, ["AL", "HC"]),
  "equivalent service-line sets should share one stable remount key",
);

console.log("In-house scatter scope regression tests: passed");