import assert from "node:assert/strict";
import {
  getNicMapRateTierBenchmarks,
  matchNicMapGeography,
  quarterToMonth,
} from "../server/services/nicMapRateTiers";

async function main() {
  assert.equal(quarterToMonth("1Q2026"), "2026-03");
  assert.equal(quarterToMonth("2Q2026"), "2026-06");
  assert.equal(quarterToMonth("bad"), null);

  assert.deepEqual(
    matchNicMapGeography({ city: "Cincinnati", state: "oh" }),
    { geography: "Cincinnati, OH", matchMethod: "exact_city" },
  );
  assert.deepEqual(
    matchNicMapGeography({ city: "Liberty Township", state: "OH", lat: 39.3892, lng: -84.3727 }),
    { geography: "Cincinnati, OH", matchMethod: "nearby_metro" },
  );
  assert.deepEqual(
    matchNicMapGeography({ city: "Indianapolis", state: "IN", lat: 39.7684, lng: -86.1581 }),
    { geography: "Primary and Secondary Markets", matchMethod: "combined_markets" },
  );

  const portfolio = await getNicMapRateTierBenchmarks({});
  assert.equal(portfolio.length, 2);
  assert.deepEqual(portfolio.map((item) => item.propertyType), ["Majority IL", "Majority AL"]);
  assert.ok(portfolio.every((item) => item.display === "middle"));
  assert.ok(portfolio.every((item) => item.appliesToKey === "Senior Housing"));

  const al = await getNicMapRateTierBenchmarks({
    group: "Senior Housing",
    serviceLine: "AL",
    location: { city: "Cleveland", state: "OH" },
  });
  assert.equal(al.length, 1);
  assert.equal(al[0].propertyType, "Majority AL");
  assert.equal(al[0].geography, "Cleveland, OH");
  assert.equal(al[0].display, "tiers");
  assert.deepEqual(
    al[0].points.find((point) => point.month === "2026-06"),
    { month: "2026-06", top: 7992, p75: 6925, middle: 6092, p25: 5263, bottom: 4844 },
  );

  const vil = await getNicMapRateTierBenchmarks({
    group: "Senior Housing",
    serviceLine: "VIL",
  });
  assert.equal(vil.length, 1);
  assert.equal(vil[0].propertyType, "Majority IL");

  assert.deepEqual(
    await getNicMapRateTierBenchmarks({ group: "SNF", serviceLine: "HC" }),
    [],
  );

  console.log("NIC MAP rate-tier tests: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});