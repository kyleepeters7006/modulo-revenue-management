import { strict as assert } from "node:assert";
import { DAYS_PER_MONTH } from "../shared/careRates";
import { calculateAnnualValueOfOnePercentBaseIncrease } from "../server/services/rateNormalization";

assert.equal(
  calculateAnnualValueOfOnePercentBaseIncrease({
    occupiedYN: true,
    payorType: "Private Pay",
    serviceLine: "AL",
    inHouseRate: 5000,
    streetRate: 6000,
    careRate: 1500,
    rentAndCareRate: 6500,
  }),
  5000 * 12 * 0.01,
  "monthly service lines use in-house base rate and exclude care",
);

assert.equal(
  calculateAnnualValueOfOnePercentBaseIncrease({
    occupiedYN: true,
    payorType: "LEGACY - PVT PAY",
    serviceLine: "HC",
    inHouseRate: 400,
    careRate: 75,
  }),
  400 * DAYS_PER_MONTH * 12 * 0.01,
  "HC daily base rate converts with the shared days-per-month factor",
);

assert.equal(
  calculateAnnualValueOfOnePercentBaseIncrease({
    occupiedYN: false,
    payorType: "Private Pay",
    serviceLine: "AL",
    inHouseRate: 5000,
  }),
  0,
  "vacant units do not contribute",
);

assert.equal(
  calculateAnnualValueOfOnePercentBaseIncrease({
    occupiedYN: true,
    payorType: "Medicare",
    serviceLine: "HC",
    inHouseRate: 400,
  }),
  0,
  "externally priced payers do not contribute",
);

console.log("One-percent base-rate annual value tests passed");