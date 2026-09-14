/**
 * Regression coverage for the portfolio-to-campus annual report worker pool.
 *
 * This stays database-free: route tests can provide the real calculation and
 * persistence callbacks, while this test protects bounded concurrency and the
 * all-settled failure boundary.
 */
import assert from "node:assert/strict";
import { generateCampusAnnualReports } from "../server/services/inhouseAnnualReportGeneration";

(async () => {
  const locations = [
    { id: "a", name: "Campus A" },
    { id: "b", name: "Campus B" },
    { id: "c", name: "Campus C" },
  ];
  const lines = [
    { serviceLine: "AL", assumptions: { rateGrowthTargetPct: 6 }, tierPolicy: { lowCutoffPct: 88 } },
  ];
  let active = 0;
  let peak = 0;
  const saved: string[] = [];
  const result = await generateCampusAnnualReports({
    locations,
    lines,
    concurrency: 2,
    calculate: async (location, postedLines) => {
      assert.deepEqual(postedLines, lines, "each campus receives the explicit portfolio inputs");
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, location.id === "b" ? 15 : 2));
      active -= 1;
      if (location.id === "b") throw new Error("campus calculation failed");
      return {
        lines: [{
          serviceLine: "AL",
          currentPlan: {},
          occupancyPct: 92,
          occupancyMonth: "2026-12",
          currentTier: "target",
          cells: [],
          warnings: [],
        }],
        skipped: [],
      };
    },
    save: async ({ location }) => {
      saved.push(location.id);
    },
  });

  assert.equal(peak, 2, "campus calculations never exceed the configured concurrency");
  assert.deepEqual(saved.sort(), ["a", "c"], "successful campuses are saved independently");
  assert.deepEqual(result.failed.map(({ locationId }) => locationId), ["b"]);
  console.log("In-house annual report generation tests: passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});