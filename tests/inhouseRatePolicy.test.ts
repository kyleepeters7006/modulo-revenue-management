import assert from "node:assert/strict";
import { rowToAssumptions } from "../server/routes/inhousePlanningRoutes";
import { allocateIncreases } from "../server/services/inhouseRatePlanning/solver";

const legacy = rowToAssumptions({
  rateGrowthTargetPct: 6,
  streetRateEffectiveDate: null,
  inhouseEffectiveDate: null,
  annualTurnoverPct: 35,
  minInhouseIncreasePct: 0,
  maxInhouseIncreasePct: 8,
  equalizationStrength: "medium",
  allowInhouseAboveStreet: false,
  maxStreetIncreasePct: 15,
  maxYoYStreetIncreasePct: 15,
});

assert.equal(legacy.allowInhouseAboveStreet, true, "legacy saved false is normalized to current policy");
const allocation = allocateIncreases({
  residents: [{
    key: "legacy",
    location: "Test",
    serviceLine: "AL",
    roomNumber: "1",
    roomType: "Studio",
    careLevel: null,
    payorType: "PRIVATE PAY",
    moveInDate: "2024-01-01",
    currentRateMonthly: 5_400,
    streetRateMonthly: 5_000,
    isCompanionBed: false,
    weight: 90,
  }],
  targetAvgIncrease: 0.02,
  minIncrease: 0,
  maxIncrease: 0.08,
  strength: legacy.equalizationStrength,
  allowAboveStreet: legacy.allowInhouseAboveStreet,
  streetMultiplier: 1,
});
assert.ok(allocation.allocations[0].increase > 0, "normalized policy allows an above-street increase");
console.log("2 passed");