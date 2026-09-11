import { pool } from "./server/db";
import { DEFAULT_ASSUMPTIONS } from "./shared/inhousePlanning";
import { calculatePlan } from "./server/services/inhouseRatePlanning";

async function main() {
  const { rows } = await pool.query(
    `SELECT client_id, COUNT(*) c FROM rent_roll_data GROUP BY 1 ORDER BY c DESC LIMIT 1`,
  );
  const clientId = rows[0].client_id as string;
  const sls = await pool.query(
    `SELECT DISTINCT service_line FROM rent_roll_data WHERE client_id = $1 AND service_line IS NOT NULL ORDER BY 1`,
    [clientId],
  );
  const assumptions = {
    ...DEFAULT_ASSUMPTIONS,
    streetRateEffectiveDate: "2027-01-01",
    inhouseEffectiveDate: "2027-01-01",
  };
  for (const r of sls.rows) {
    const sl = r.service_line as string;
    try {
      const plan = await calculatePlan({
        clientId,
        locationId: null,
        location: null,
        serviceLine: sl,
        assumptions,
      });
      const premium =
        (plan.recommendedStreetRateMonthly / plan.summary.newAvgInhouseRateMonthly - 1) * 100;
      console.log(
        `${sl.padEnd(8)} street +${plan.streetIncreasePct.toFixed(2)}%  inhouse +${plan.summary.weightedAvgIncreasePct.toFixed(2)}%  premium ${premium.toFixed(2)}%  reported ${(plan.streetPremiumOverInhousePct ?? NaN).toFixed(2)}%  feasible=${plan.feasible}`,
      );
    } catch (err) {
      console.log(`${sl.padEnd(8)} skipped: ${(err as Error).message.slice(0, 80)}`);
    }
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
