import { pool } from '/home/runner/workspace/server/db';
import { buildRuleImpactContext, computeQualifiedRuleImpact } from '/home/runner/workspace/server/services/ruleImpactService';
import { applyAdjustmentRulesToBatch, recalculateAndPreloadCampusMetrics } from '/home/runner/workspace/server/services/adjustmentRulesService';
import { isBBedRow } from '/home/runner/workspace/shared/bBed';

(async () => {
  const rulesRes = await pool.query(`SELECT * FROM adjustment_rules WHERE is_active = true AND is_historical IS NOT TRUE`);
  const rules = rulesRes.rows.map((r: any) => ({
    ...r, locationId: r.location_id, serviceLine: r.service_line, serviceLines: r.service_lines,
    effectiveDate: r.effective_date, isActive: r.is_active,
  }));
  let allOk = true;
  for (const clientId of ['trilogy', 'demo']) {
    console.log(`\n===== ${clientId} (gross, B-bed-excluded live counts) =====`);
    const ctx = await buildRuleImpactContext(clientId);
    if (!ctx) continue;
    const locIds = Array.from(new Set(ctx.units.map(u => u.location_id).filter(Boolean))) as string[];
    // Same snapshot month the preview evaluates (client-global latest)
    for (const l of locIds) await recalculateAndPreloadCampusMetrics(clientId, l, ctx.latestMonth);
    const uById = new Map(ctx.units.map(u => [u.id, u]));
    const batch = ctx.units.map(u => ({
      id: u.id,
      unit: { id: u.id, clientId, locationId: u.location_id, location: u.location,
        serviceLine: u.service_line, roomType: u.room_type, roomNumber: u.room_number,
        streetRate: u.street_rate, occupiedYN: u.occupied_yn, daysVacant: u.days_vacant },
    }));
    for (const rule of rules) {
      const impact = computeQualifiedRuleImpact(ctx, rule as any, undefined);
      const results = applyAdjustmentRulesToBatch(batch as any, [rule] as any);
      const liveIds = results.filter(r => r.appliedRuleName).map(r => r.id)
        .filter(id => { const u = uById.get(id)!; return !isBBedRow(u.service_line || '', u.room_number); });
      const flag = impact.affectedUnits === liveIds.length ? 'OK  ' : (allOk = false, 'DIFF');
      console.log(`${flag} preview=${String(impact.affectedUnits).padStart(5)} live=${String(liveIds.length).padStart(5)} | ${rule.name}`);
    }
  }
  console.log(allOk ? '\nALL MATCH' : '\nMISMATCHES REMAIN');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
