/**
 * compPositionOwnRates — shared own-rate aggregation for the competitive-position scatter.
 *
 * Extracted so that:
 *   1. The live route (GET /api/pricing-controls/competitive-position in routes.ts) and
 *   2. The regression test (tests/compPositionRefDataParity.test.ts)
 * execute the EXACT same SQL. Any change here affects both surfaces simultaneously,
 * making it impossible for the test to stay green while the production query regresses.
 *
 * ── CRITICAL NOTE ──────────────────────────────────────────────────────────────────
 * Do NOT add a room_type_groupings JOIN to the rt_modes CTE.
 * rr.room_type is already backfill-normalized ("Studio", "Studio Dlx", etc.).
 * A JOIN would substitute group_name (e.g. "Legacy Lane - Studio") as the room_type
 * value, which does NOT match the `ILIKE 'studio%'` filter in the rates CTE — causing
 * our_studio_rate to silently return NULL for every branded campus and blanking those
 * scatter points on the chart.
 * See .agents/memory/rtg-branded-names.md and tests/compPositionRefDataParity.test.ts
 * (assertion RTG-6) for the full rationale and regression test.
 * ───────────────────────────────────────────────────────────────────────────────────
 */

import { buildRateBaselineJoin, streetRateGate } from "./rateBaselineView";
import { bBedExclusionSql } from "@shared/bBed";

export interface OwnRateRow {
  location: string;
  location_name: string;
  service_line: string;
  our_studio_rate: number | null;
  our_all_rate: number | null;
}

export interface OwnRateFilters {
  locations?: string[];
  regions?: string[];
  divisions?: string[];
  serviceLine?: string;
}

/**
 * Query the own (street) rate per location + service line as the AVERAGE street rate
 * per room type, then unit-weight the per-RT averages to a single all-room figure.
 * This matches the Reference Data aggregation exactly — both surfaces average, and
 * both drop implausible rows using the same relative outlier gate.
 *
 * @param queryFn  - A function matching `pool.query(sql, params)` — accepts either
 *                   a `pg.Pool` or any compatible query wrapper.
 * @param clientId - The tenant whose rent-roll rows to aggregate.
 * @param month    - The upload_month to scope to (YYYY-MM string).
 * @param filters  - Optional location / region / division / serviceLine filters.
 */
export async function queryCompPositionOwnRates(
  queryFn: (sql: string, params: any[]) => Promise<{ rows: any[] }>,
  clientId: string,
  month: string,
  filters: OwnRateFilters = {},
): Promise<OwnRateRow[]> {
  const { locations = [], regions = [], divisions = [], serviceLine } = filters;

  let whereClause = `loc.client_id=$1 AND rr.upload_month=$2 AND rr.street_rate>0`;
  const params: any[] = [clientId, month];
  let p = 3;

  // These filters choose which rows to REPORT. They deliberately have no
  // effect on the outlier baselines, which the rate_baseline_v view defines
  // over the whole portfolio — scoping the scatter to one campus must not
  // shrink the yardstick that campus is judged against.
  if (locations.length) { whereClause += ` AND rr.location = ANY($${p++})`; params.push(locations); }
  if (regions.length)   { whereClause += ` AND loc.region = ANY($${p++})`; params.push(regions); }
  if (divisions.length) { whereClause += ` AND loc.division = ANY($${p++})`; params.push(divisions); }
  if (serviceLine && serviceLine !== 'All') {
    whereClause += ` AND rr.service_line=$${p++}`;
    params.push(serviceLine);
  }

  const res = await queryFn(`
    -- Own-rate aggregation for competitive-position scatter.
    -- Reports a true AVERAGE street rate per room type (identical basis to Reference
    -- Data), then unit-weights the per-RT averages so the all-rooms figure reflects
    -- room mix. Junk rent-roll rows (e.g. a $159 Studio) are removed by the relative
    -- outlier gate below instead of by mode(), which hid real rate dispersion.
    WITH rt_rates AS (
      SELECT rr.location,
        -- Canonical KeyStats location name for benchmarkFor() lookups.
        -- Falls back to rr.location when location_id FK is not populated.
        COALESCE(loc.name, rr.location) AS location_name,
        rr.service_line,
        -- rr.room_type is already backfill-normalized ("Studio", "Studio Dlx", etc.).
        -- DO NOT join room_type_groupings here — group_name values like
        -- "Legacy Lane - Studio" would break the ILIKE 'studio%' filter below,
        -- silently NULLing our_studio_rate for every branded campus.
        rr.room_type,
        -- The outlier gate applies to the RATE only, never to the unit count.
        -- A junk rent-roll rate does not make the room stop existing: excluding
        -- it from cnt too would silently re-weight the room mix and pull the
        -- all-rooms figure away from Reference Data, which counts every
        -- distinct physical room.
        AVG(rr.street_rate) FILTER (WHERE ${streetRateGate('rr.')}) AS rt_rate,
        -- Distinct PHYSICAL rooms, collapsing companion suffixes, so this
        -- weight matches the Reference Data total column exactly.
        COUNT(DISTINCT
          CASE WHEN rr.service_line IN ('AL', 'AL/MC', 'SL', 'VIL')
               THEN REGEXP_REPLACE(rr.room_number, '/[A-Za-z]+$', '')
               ELSE rr.room_number END
        ) AS cnt
      FROM rent_roll_data rr
      LEFT JOIN locations loc ON loc.id = rr.location_id
      ${buildRateBaselineJoin({ rr: 'rr.', clientSql: '$1', monthSql: '$2' })}
      WHERE ${whereClause}
        AND ${bBedExclusionSql('rr.')}
      GROUP BY rr.location, loc.name, rr.service_line, rr.room_type
    )
    SELECT location, location_name, service_line,
      -- Studio-only rate: ILIKE 'studio%' matches "Studio", "Studio Dlx", etc.
      -- against rr.room_type (normalized) — NOT against a branded group_name.
      -- Room types whose every row was gated out contribute no rate, so they are
      -- dropped from both the numerator and the denominator.
      ROUND((SUM(rt_rate * cnt) FILTER (WHERE rt_rate IS NOT NULL AND room_type ILIKE 'studio%')
        / NULLIF(SUM(cnt) FILTER (WHERE rt_rate IS NOT NULL AND room_type ILIKE 'studio%'), 0))::numeric, 0) AS our_studio_rate,
      -- All-rooms weighted rate (used as the fallback when no studio units exist).
      ROUND((SUM(rt_rate * cnt) FILTER (WHERE rt_rate IS NOT NULL)
        / NULLIF(SUM(cnt) FILTER (WHERE rt_rate IS NOT NULL), 0))::numeric, 0) AS our_all_rate
    FROM rt_rates
    GROUP BY location, location_name, service_line
  `, params);

  return res.rows.map(r => ({
    location:       r.location as string,
    location_name:  r.location_name as string,
    service_line:   r.service_line as string,
    our_studio_rate: r.our_studio_rate != null ? Number(r.our_studio_rate) : null,
    our_all_rate:    r.our_all_rate    != null ? Number(r.our_all_rate)    : null,
  }));
}
