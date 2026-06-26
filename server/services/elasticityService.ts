import { pool } from "../db";

// ---------------------------------------------------------------------------
// Price Elasticity Service
//
// Elasticity = (% change in days-to-sell) / (% change in street rate)
//
// "Days to sell" is proxied by the average days_vacant of vacant units in a
// month (how long a unit sits before it leases). We compare two trailing
// windows of rent-roll history:
//   - "after"  = the most recent 3 months
//   - "before" = the 3 months immediately preceding that
//
// A negative elasticity is the intuitive case: raising the rate (positive
// %Δrate) lengthens days-to-sell (positive %Δdays) → here the ratio is
// positive; lowering the rate shortens days-to-sell. The sign is preserved as
// computed so downstream consumers can reason about direction directly.
//
// ── Online learning ────────────────────────────────────────────────────────
// Each run produces a fresh "raw" elasticity from the latest windows. Instead
// of overwriting, we blend it into the stored value with an exponential moving
// average whose weight (alpha) shrinks as more observations accumulate:
//     elasticity_new = alpha * raw + (1 - alpha) * elasticity_prior
// This lets the estimate stabilise (improve) over time while still tracking
// genuine market shifts. Confidence grows with the number of observations.
// ---------------------------------------------------------------------------

const DAILY_SERVICE_LINES = new Set(["HC", "HC/MC", "SMC"]);
const DAYS_PER_MONTH = 30.44;

// Minimum |%Δrate| required for a meaningful elasticity (avoids divide-by-near-zero).
const MIN_RATE_CHANGE_PCT = 0.005; // 0.5%

export interface ElasticityRecord {
  clientId: string;
  locationId: string | null;
  locationName: string;
  serviceLine: string;
  roomType: string;
  elasticity: number | null;
  rawElasticity: number | null;
  daysToSellBefore: number | null;
  daysToSellAfter: number | null;
  daysToSellChange: number | null;
  rateBefore: number | null;
  rateAfter: number | null;
  sampleSize: number;
  confidence: number;
}

interface MonthlyAgg {
  month: string;
  avgStreet: number | null;
  avgDaysToSell: number | null; // avg days_vacant for vacant units
}

const avg = (a: number[]): number | null =>
  a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;

/**
 * Compute the raw (latest-period) elasticity and days-to-sell stats for one
 * segment from its ordered monthly aggregates (newest first).
 */
function computeRawElasticity(byMonth: MonthlyAgg[]): {
  rawElasticity: number | null;
  daysToSellBefore: number | null;
  daysToSellAfter: number | null;
  daysToSellChange: number | null;
  rateBefore: number | null;
  rateAfter: number | null;
} {
  // byMonth is newest-first
  const afterWindow = byMonth.slice(0, 3);
  const beforeWindow = byMonth.slice(3, 6);

  const dtsAfter = avg(afterWindow.map(m => m.avgDaysToSell).filter((v): v is number => v != null));
  const dtsBefore = avg(beforeWindow.map(m => m.avgDaysToSell).filter((v): v is number => v != null));
  const rateAfter = avg(afterWindow.map(m => m.avgStreet).filter((v): v is number => v != null));
  const rateBefore = avg(beforeWindow.map(m => m.avgStreet).filter((v): v is number => v != null));

  const daysToSellChange =
    dtsAfter !== null && dtsBefore !== null ? dtsAfter - dtsBefore : null;

  let rawElasticity: number | null = null;
  if (
    dtsAfter !== null && dtsBefore !== null && dtsBefore > 0 &&
    rateAfter !== null && rateBefore !== null && rateBefore > 0
  ) {
    const pctChangeDays = (dtsAfter - dtsBefore) / dtsBefore;
    const pctChangeRate = (rateAfter - rateBefore) / rateBefore;
    if (Math.abs(pctChangeRate) >= MIN_RATE_CHANGE_PCT) {
      rawElasticity = pctChangeDays / pctChangeRate;
    }
  }

  return {
    rawElasticity,
    daysToSellBefore: dtsBefore,
    daysToSellAfter: dtsAfter,
    daysToSellChange,
    rateBefore,
    rateAfter,
  };
}

/**
 * Recompute elasticity for every segment of a client from rent_roll_data
 * history, blend with the prior stored value (online learning), and persist.
 * Returns the number of segments written.
 */
export async function computeAndStoreElasticity(clientId: string): Promise<{ updated: number }> {
  // 1) Latest 6 upload months (newest first) — enough for before/after windows.
  const monthsRes = await pool.query<{ m: string }>(
    `SELECT DISTINCT upload_month AS m
     FROM rent_roll_data
     WHERE client_id = $1 AND upload_month IS NOT NULL
     ORDER BY upload_month DESC LIMIT 6`,
    [clientId]
  );
  const months = monthsRes.rows.map(r => r.m);
  if (months.length < 2) {
    return { updated: 0 };
  }

  // 2) Per (campus, service_line, room_type, month) aggregates.
  const aggRes = await pool.query<{
    location_id: string | null;
    campus: string;
    service_line: string;
    room_type: string;
    month: string;
    avg_street: string | null;
    avg_days_to_sell: string | null;
  }>(
    `SELECT
        loc.id                                                          AS location_id,
        rr.location                                                     AS campus,
        rr.service_line                                                 AS service_line,
        rr.room_type                                                    AS room_type,
        rr.upload_month                                                 AS month,
        mode() WITHIN GROUP (ORDER BY rr.street_rate) FILTER (WHERE rr.street_rate > 0) AS avg_street,
        AVG(rr.days_vacant) FILTER (WHERE NOT rr.occupied_yn AND rr.days_vacant > 0)    AS avg_days_to_sell
     FROM rent_roll_data rr
     LEFT JOIN locations loc ON loc.client_id = rr.client_id AND loc.name = rr.location
     WHERE rr.client_id = $1 AND rr.upload_month = ANY($2)
     GROUP BY loc.id, rr.location, rr.service_line, rr.room_type, rr.upload_month`,
    [clientId, months]
  );

  // 3) Group by segment.
  type Seg = { locationId: string | null; campus: string; sl: string; rt: string; byMonth: Map<string, MonthlyAgg> };
  const segments = new Map<string, Seg>();
  for (const r of aggRes.rows) {
    const key = `${r.campus}||${r.service_line}||${r.room_type}`;
    if (!segments.has(key)) {
      segments.set(key, {
        locationId: r.location_id ?? null,
        campus: r.campus,
        sl: r.service_line,
        rt: r.room_type,
        byMonth: new Map(),
      });
    }
    segments.get(key)!.byMonth.set(r.month, {
      month: r.month,
      avgStreet: r.avg_street !== null ? Number(r.avg_street) : null,
      avgDaysToSell: r.avg_days_to_sell !== null ? Number(r.avg_days_to_sell) : null,
    });
  }

  // 4) Load prior stored values for blending.
  const priorRes = await pool.query<{
    location_name: string; service_line: string; room_type: string;
    elasticity: number | null; sample_size: number | null;
  }>(
    `SELECT location_name, service_line, room_type, elasticity, sample_size
     FROM elasticity_metrics WHERE client_id = $1`,
    [clientId]
  );
  const priorMap = new Map<string, { elasticity: number | null; sampleSize: number }>();
  for (const p of priorRes.rows) {
    priorMap.set(`${p.location_name}||${p.service_line}||${p.room_type}`, {
      elasticity: p.elasticity !== null ? Number(p.elasticity) : null,
      sampleSize: Number(p.sample_size) || 0,
    });
  }

  // 5) Compute + blend + persist per segment.
  let updated = 0;
  for (const [key, seg] of Array.from(segments.entries())) {
    const orderedMonths = months
      .map(m => seg.byMonth.get(m))
      .filter((v): v is MonthlyAgg => v !== undefined);
    const raw = computeRawElasticity(orderedMonths);

    const prior = priorMap.get(key);
    const priorElasticity = prior?.elasticity ?? null;
    const priorSamples = prior?.sampleSize ?? 0;

    // Online-learning blend. Only counts as an observation when raw is defined.
    let blended: number | null = priorElasticity;
    let sampleSize = priorSamples;
    if (raw.rawElasticity !== null) {
      sampleSize = priorSamples + 1;
      // alpha decays with the number of observations so the estimate stabilises.
      const alpha = priorElasticity === null ? 1 : 1 / Math.min(sampleSize, 12);
      blended =
        priorElasticity === null
          ? raw.rawElasticity
          : alpha * raw.rawElasticity + (1 - alpha) * priorElasticity;
    }
    const confidence = Math.min(1, sampleSize / 12);

    await pool.query(
      `INSERT INTO elasticity_metrics
        (client_id, location_id, location_name, service_line, room_type,
         elasticity, raw_elasticity, days_to_sell_before, days_to_sell_after,
         days_to_sell_change, rate_before, rate_after, sample_size, confidence, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, NOW())
       ON CONFLICT (client_id, location_name, service_line, room_type)
       DO UPDATE SET
         location_id        = EXCLUDED.location_id,
         elasticity         = EXCLUDED.elasticity,
         raw_elasticity     = EXCLUDED.raw_elasticity,
         days_to_sell_before= EXCLUDED.days_to_sell_before,
         days_to_sell_after = EXCLUDED.days_to_sell_after,
         days_to_sell_change= EXCLUDED.days_to_sell_change,
         rate_before        = EXCLUDED.rate_before,
         rate_after         = EXCLUDED.rate_after,
         sample_size        = EXCLUDED.sample_size,
         confidence         = EXCLUDED.confidence,
         updated_at         = NOW()`,
      [
        clientId, seg.locationId, seg.campus, seg.sl, seg.rt,
        blended, raw.rawElasticity, raw.daysToSellBefore, raw.daysToSellAfter,
        raw.daysToSellChange, raw.rateBefore, raw.rateAfter, sampleSize, confidence,
      ]
    );
    updated++;
  }

  console.log(`[elasticity] Computed/stored elasticity for ${updated} segments (client=${clientId})`);
  return { updated };
}

/**
 * Load all stored elasticity records for a client, keyed `campus||sl||rt`.
 * Used by /api/reference-data and the rule-suggestion engine (shared accessor).
 */
export async function getElasticityMap(clientId: string): Promise<Map<string, ElasticityRecord>> {
  const res = await pool.query(
    `SELECT client_id, location_id, location_name, service_line, room_type,
            elasticity, raw_elasticity, days_to_sell_before, days_to_sell_after,
            days_to_sell_change, rate_before, rate_after, sample_size, confidence
     FROM elasticity_metrics WHERE client_id = $1`,
    [clientId]
  );
  const map = new Map<string, ElasticityRecord>();
  for (const r of res.rows as any[]) {
    map.set(`${r.location_name}||${r.service_line}||${r.room_type}`, {
      clientId: r.client_id,
      locationId: r.location_id ?? null,
      locationName: r.location_name,
      serviceLine: r.service_line,
      roomType: r.room_type,
      elasticity: r.elasticity !== null ? Number(r.elasticity) : null,
      rawElasticity: r.raw_elasticity !== null ? Number(r.raw_elasticity) : null,
      daysToSellBefore: r.days_to_sell_before !== null ? Number(r.days_to_sell_before) : null,
      daysToSellAfter: r.days_to_sell_after !== null ? Number(r.days_to_sell_after) : null,
      daysToSellChange: r.days_to_sell_change !== null ? Number(r.days_to_sell_change) : null,
      rateBefore: r.rate_before !== null ? Number(r.rate_before) : null,
      rateAfter: r.rate_after !== null ? Number(r.rate_after) : null,
      sampleSize: Number(r.sample_size) || 0,
      confidence: Number(r.confidence) || 0,
    });
  }
  return map;
}

/**
 * Shared accessor: elasticity record for a single segment (used by the rules
 * / rule-suggestion engine in downstream work).
 */
export async function getElasticityForSegment(
  clientId: string, campus: string, serviceLine: string, roomType: string
): Promise<ElasticityRecord | null> {
  const map = await getElasticityMap(clientId);
  return map.get(`${campus}||${serviceLine}||${roomType}`) ?? null;
}

/**
 * Convert a monthly rate to a daily rate. HC / HC-MC / SMC are stored as daily
 * rates already, so they pass through unchanged.
 */
export function toDailyRate(monthlyOrDailyRate: number, serviceLine: string): number {
  return DAILY_SERVICE_LINES.has(serviceLine)
    ? monthlyOrDailyRate
    : monthlyOrDailyRate / DAYS_PER_MONTH;
}

/**
 * Predict the change in days-to-sell that would result from a rate change,
 * using the learned elasticity:
 *     %Δdays = elasticity × %Δrate  →  Δdays = currentDaysToSell × elasticity × %Δrate
 * Returns null when elasticity or the inputs are unavailable.
 */
export function predictDaysToSellChange(
  elasticity: number | null,
  currentDaysToSell: number | null,
  currentRate: number | null,
  deltaRate: number | null
): number | null {
  if (
    elasticity === null || currentDaysToSell === null ||
    currentRate === null || currentRate === 0 || deltaRate === null
  ) {
    return null;
  }
  const pctRateChange = deltaRate / currentRate;
  return currentDaysToSell * elasticity * pctRateChange;
}

export interface ElasticityImpactParams {
  moveInsMonthly: number | null; // distinct move-in events per month for this segment
  deltaRate: number | null;      // change in monthly street rate ($/month)
  deltaDaysToSell: number | null;// predicted change in days-to-sell (days)
  dailyRate: number | null;      // current daily rate ($/day)
}

export interface ElasticityImpact {
  monthly: number | null;
  annual: number | null;
}

/**
 * Elasticity-based revenue impact (per the requested formula).
 *
 *   Monthly = (MoveIns_monthly × ΔRate)
 *             − (ΔDaysToSell × DailyRate × MoveIns_monthly) ÷ 12
 *
 *   Annual  = (MoveIns_monthly × ΔRate × 12)
 *             − (ΔDaysToSell × DailyRate × MoveIns_annual)
 *
 * where MoveIns_annual = MoveIns_monthly × 12.
 *
 * The first term is the added revenue from charging more per move-in; the
 * second term is the revenue lost while units sit vacant longer (slower sell).
 */
export function calculateElasticityRevenueImpact(p: ElasticityImpactParams): ElasticityImpact {
  const { moveInsMonthly, deltaRate, deltaDaysToSell, dailyRate } = p;
  if (
    moveInsMonthly === null || deltaRate === null ||
    deltaDaysToSell === null || dailyRate === null
  ) {
    return { monthly: null, annual: null };
  }
  const moveInsAnnual = moveInsMonthly * 12;
  const monthly =
    moveInsMonthly * deltaRate -
    (deltaDaysToSell * dailyRate * moveInsMonthly) / 12;
  const annual =
    moveInsMonthly * deltaRate * 12 -
    deltaDaysToSell * dailyRate * moveInsAnnual;
  return { monthly, annual };
}
