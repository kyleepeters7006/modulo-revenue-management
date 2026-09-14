import {
  findPlanUnit,
  residentRoomKey,
  unitKey,
  type AppliedPlanIndex,
  type AppliedPlanUnitRate,
} from "../server/services/inhouseRatePlanning/appliedPlanRates";

let passed = 0;
let failed = 0;

function ok(description: string, condition: boolean) {
  if (condition) {
    console.log(`✓ ${description}`);
    passed++;
  } else {
    console.error(`✗ ${description}`);
    failed++;
  }
}

function rate(planId: string, newRate: number): AppliedPlanUnitRate {
  return {
    planId,
    version: 1,
    newRate,
    currentRate: newRate - 100,
    increaseDollars: 100,
    increaseDollarsMonthly: 100,
    increasePct: 0.025,
    inhouseEffectiveDate: "2027-02-01",
    streetRate: newRate + 250,
    streetEffectiveDate: "2027-03-01",
    isCompanionBed: false,
  };
}

const moveIn = "2024-05-06";
const alpha = rate("alpha-plan", 4100);
const beta = rate("beta-plan", 4300);
const index: AppliedPlanIndex = {
  byUnit: new Map([
    [unitKey("Alpha", "AL", "101", "Studio", moveIn), alpha],
    [unitKey("Beta", "AL", "101", "Studio", moveIn), beta],
  ]),
  byResidentRoom: new Map([
    [residentRoomKey("Alpha", "AL", "101", moveIn), alpha],
    [residentRoomKey("Beta", "AL", "101", moveIn), beta],
  ]),
  isEmpty: false,
  scopes: [
    { location: "Alpha", serviceLine: "AL" },
    { location: "Beta", serviceLine: "AL" },
  ],
};

ok(
  "exact room identity returns the calculated rate",
  findPlanUnit(index, "Alpha", "AL", "101", "Studio", moveIn)?.newRate === 4100,
);
ok(
  "a renamed room type still returns the same resident's calculated rate",
  findPlanUnit(index, "Alpha", "AL", "101", "Legacy Lane - Studio", moveIn)?.newRate === 4100,
);
ok(
  "the same room number at another campus keeps its own calculation",
  findPlanUnit(index, "Beta", "AL", "101", "Renamed Studio", moveIn)?.newRate === 4300,
);
ok(
  "a replacement resident never inherits the prior resident's calculation",
  findPlanUnit(index, "Alpha", "AL", "101", "Studio", "2026-08-01") === null,
);
ok(
  "a room at an unplanned campus does not borrow another campus's calculation",
  findPlanUnit(index, "Gamma", "AL", "101", "Studio", moveIn) === null,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);