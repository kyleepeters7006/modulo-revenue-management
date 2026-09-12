import { strict as assert } from "node:assert";
import { rollupAnnualIncrease } from "../client/src/lib/annualIncreaseRollup";

const roomRows = [
  {
    campus: "A", serviceLine: "AL", roomType: "Studio", roomNumber: "101",
    ihRecommendationResidents: 1,
    ihRecommendationCurrentRate: 4000,
    ihRecommendationNewRate: 4200,
    ihRecommendationDeltaDollar: 200,
    ihRecommendationDeltaPct: 0.05,
    ihRecommendationMonthlyImpact: 200,
    ihRecommendationEffectiveDate: "2027-01-01",
    ihRecommendationStreetRate: 5400,
    ihRecommendationStreetEffectiveDate: "2027-02-01",
    ihPlanResidents: null,
  },
  {
    campus: "A", serviceLine: "AL", roomType: "Studio", roomNumber: "102",
    ihRecommendationResidents: 1,
    ihRecommendationCurrentRate: 5000,
    ihRecommendationNewRate: 5100,
    ihRecommendationDeltaDollar: 100,
    ihRecommendationDeltaPct: 0.02,
    ihRecommendationMonthlyImpact: 100,
    ihRecommendationEffectiveDate: "2027-01-01",
    ihRecommendationStreetRate: 5400,
    ihRecommendationStreetEffectiveDate: "2027-02-01",
    ihPlanResidents: null,
  },
  {
    campus: "A", serviceLine: "AL", roomType: "Studio", roomNumber: "103",
    ihRecommendationResidents: null,
    ihRecommendationCurrentRate: null,
    ihRecommendationNewRate: null,
    ihRecommendationDeltaDollar: null,
    ihRecommendationDeltaPct: null,
    ihRecommendationMonthlyImpact: null,
    ihRecommendationEffectiveDate: null,
    ihRecommendationStreetRate: null,
    ihRecommendationStreetEffectiveDate: null,
    ihPlanResidents: null,
  },
  {
    campus: "B", serviceLine: "AL", roomType: "One Bedroom", roomNumber: "201",
    ihRecommendationResidents: 1,
    ihRecommendationCurrentRate: 6000,
    ihRecommendationNewRate: 6600,
    ihRecommendationDeltaDollar: 600,
    ihRecommendationDeltaPct: 0.10,
    ihRecommendationMonthlyImpact: 600,
    ihRecommendationEffectiveDate: "2027-01-01",
    ihRecommendationStreetRate: 7000,
    ihRecommendationStreetEffectiveDate: "2027-02-01",
    ihPlanResidents: null,
  },
];

function near(actual: number | null, expected: number, tolerance = 1e-9) {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) <= tolerance, `${actual} != ${expected}`);
}

// Room type: uncovered rooms do not dilute the resident-weighted rate.
const studio = rollupAnnualIncrease(roomRows.filter(r => r.roomType === "Studio"), "ihRecommendation");
assert.equal(studio.residents, 2);
near(studio.currentRate, 4500);
near(studio.newRate, 4650);
near(studio.deltaDollar, 150);
near(studio.deltaPct, 300 / 9000);
near(studio.monthlyImpact, 300);

// Service line and every level above it use the same additive components.
for (const level of ["service line", "location/region/division/portfolio"]) {
  const rolled = rollupAnnualIncrease(roomRows, "ihRecommendation");
  assert.equal(rolled.residents, 3, `${level}: resident coverage`);
  near(rolled.currentRate, 5000);
  near(rolled.newRate, 5300);
  near(rolled.deltaDollar, 300);
  near(rolled.deltaPct, 900 / 15000);
  near(rolled.monthlyImpact, 900);
  assert.equal(rolled.effectiveDate, "2027-01-01");
  near(rolled.streetRate, (5400 * 2 + 7000) / 3);
  assert.equal(rolled.streetEffectiveDate, "2027-02-01");
}

// Recommended and applied lifecycles cannot leak into one another.
const applied = rollupAnnualIncrease(roomRows, "ihPlan");
assert.deepEqual(applied, {
  residents: null,
  newRate: null,
  currentRate: null,
  deltaDollar: null,
  deltaPct: null,
  monthlyImpact: null,
  effectiveDate: null,
  streetRate: null,
  streetEffectiveDate: null,
});

// Incomplete covered rows are rejected as a whole, not counted in the
// denominator while contributing no rate.
const incomplete = rollupAnnualIncrease([
  ...roomRows,
  {
    ihRecommendationResidents: 1,
    ihRecommendationCurrentRate: 7000,
    ihRecommendationNewRate: null,
    ihRecommendationDeltaDollar: 100,
    ihRecommendationMonthlyImpact: 100,
  },
], "ihRecommendation");
assert.equal(incomplete.residents, 3);
near(incomplete.monthlyImpact, 900);

console.log("Reference Data annual-increase room and rollup parity passed");