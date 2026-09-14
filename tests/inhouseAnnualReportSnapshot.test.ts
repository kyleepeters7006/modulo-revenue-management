import { compactPlanForAnnualReport } from "../client/src/lib/inhouseAnnualReportSnapshot";
import type { PlanResult } from "../shared/inhousePlanning";

const residents = Array.from({ length: 10_000 }, (_, i) => ({
  increasePct: i % 2 ? 4.5 : 6.5,
}));
const roomDetails = Array.from({ length: 10_000 }, (_, i) => ({
  key: `room-${i}`,
  location: "Campus",
  roomNumber: String(i),
}));
const plan = {
  residents,
  quarters: Array.from({ length: 4 }, (_, i) => ({
    label: `Q${i + 1}`,
    projectedRateMonthly: 5000,
    roomDetails,
  })),
  summary: {
    residentCount: residents.length,
    residentsReceivingIncrease: residents.length,
  },
} as unknown as PlanResult;

const compact = compactPlanForAnnualReport(plan);
const bytes = Buffer.byteLength(JSON.stringify(compact));
const count = compact.increaseDistribution.reduce((sum, band) => sum + band.count, 0);

if (compact.residents.length !== 0) throw new Error("resident rows were retained");
if ("quarters" in compact) throw new Error("quarter details were retained");
if ("streetRateRecommendations" in compact.summary) {
  throw new Error("legacy recommendation rows were retained");
}
if (count !== residents.length) throw new Error(`distribution lost residents: ${count}`);
if (bytes >= 100_000) throw new Error(`snapshot is still too large: ${bytes} bytes`);

console.log(`Annual report snapshot payload: ${bytes.toLocaleString()} bytes`);
console.log("Annual report snapshot compaction tests: passed");