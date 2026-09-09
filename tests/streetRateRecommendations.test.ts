import assert from "node:assert/strict";
import {
  buildStreetRateRecommendation,
  premiumCeiling,
  rebalanceStreetRateRecommendations,
} from "../shared/streetRateRecommendations";

const row = (id: string, current: number, top: number | null, units = 10) =>
  buildStreetRateRecommendation({
    id,
    location: id,
    serviceLine: "AL",
    product: "Studio",
    currentStreetRate: current,
    topCompetitorRate: top,
    units,
    maxStreetIncreasePct: 25,
    occupancyPct: 95,
  }, 5);

assert.equal(premiumCeiling(1000, 5), 1050);
assert.equal(premiumCeiling(null, 5), null);

const held = row("held", 1050, 1000);
assert.equal(held.action, "hold");
assert.equal(held.suggestedRate, 1050);

const push = row("push", 900, 1000);
assert.equal(push.action, "push");
assert.equal(push.suggestedRate, 1050);

const yoyCapped = buildStreetRateRecommendation({
  id: "yoy",
  location: "Yoy",
  serviceLine: "AL",
  product: "Studio",
  currentStreetRate: 120,
  priorJanuaryStreetRate: 100,
  maxYoYStreetIncreasePct: 10,
  topCompetitorRate: 200,
  units: 1,
  maxStreetIncreasePct: 50,
  occupancyPct: 95,
}, 50);
assert.equal(yoyCapped.hardCeiling, 110);
assert.equal(yoyCapped.suggestedRate, 120);

const locked = { ...push, locked: true };
const rebalance = rebalanceStreetRateRecommendations([locked, row("open", 900, 1000)], 10);
assert.equal(rebalance.recommendations[0].suggestedRate, locked.suggestedRate);
assert.equal(rebalance.recommendations[0].locked, true);
assert.equal(rebalance.feasible, true);

const infeasible = rebalanceStreetRateRecommendations([{ ...held, locked: true }], 20);
assert.equal(infeasible.feasible, false);
assert.ok(infeasible.shortfallContribution > 0);

const lockedOvershoot = rebalanceStreetRateRecommendations([{ ...push, locked: true }], 2);
assert.equal(lockedOvershoot.feasible, false);
assert.ok(lockedOvershoot.achievedContribution > lockedOvershoot.targetContribution);

const zeroBase = rebalanceStreetRateRecommendations([
  { ...row("zero", 100, 130), suggestedRate: 100, locked: false, growthContribution: 0 },
], 10);
assert.equal(zeroBase.feasible, true);
assert.equal(zeroBase.recommendations[0].suggestedRate, 110);

const negativeTarget = rebalanceStreetRateRecommendations([row("negative", 100, 130)], -5);
assert.equal(negativeTarget.feasible, false);

const noBenchmark = row("no-benchmark", 100, null);
const noBenchmarkRebalance = rebalanceStreetRateRecommendations([noBenchmark], 10);
assert.equal(noBenchmark.hardCeiling, 100);
assert.equal(noBenchmarkRebalance.recommendations[0].suggestedRate, 100);
assert.equal(noBenchmarkRebalance.feasible, false);

console.log("Street Rate recommendation tests: passed");