/**
 * In-House Rate Planning — everything that touches the database.
 *
 * Kept apart from solver.ts so the arithmetic stays testable without a
 * database, and so the shared payer-scope, B-bed and rate-normalization
 * definitions are consumed in exactly one place.
 */
import { pool } from "../../db";
import { privatePaySql } from "@shared/payerScope";
import { bBedExclusionSql, isBBedRow } from "@shared/bBed";
import { DAYS_PER_MONTH } from "@shared/careRates";
import { isDailyRateServiceLine } from "../rateNormalization";
import {
  buildRateBaselineJoin,
  inHouseRateGate,
  streetRateGate,
} from "../rateBaselineView";
import type { BaselineQuarter, PlanningResident, QuarterRef } from "@shared/inhousePlanning";
import {
  MS_PER_DAY,
  addQuarters,
  isoToMs,
  makeQuarterRef,
  parseFlexibleDate,
  quarterDiff,
  quarterMonths,
  quarterOfMonthKey,
  stayDaysInPeriod,
} from "./dates";

/**
 * SQL that turns the rent roll's two date spellings into a real date.
 * 506k rows are `M/D/YYYY` and 59k are ISO; anything else becomes NULL rather
 * than a guess.
 */
function dateExpr(column: string): string {
  return `CASE
    WHEN ${column} ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN to_date(${column}, 'FMMM/FMDD/YYYY')
    WHEN ${column} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN to_date(left(${column}, 10), 'YYYY-MM-DD')
    ELSE NULL END`;
}

/**
 * Monthly-equivalent rate expression. HC and HC/MC are stored daily; every
 * other line is stored monthly. Normalizing here means the solver never sees
 * two rate bases at once.
 */
function monthlyRateExpr(column: string, slColumn = "rr.service_line"): string {
  return `(CASE WHEN ${slColumn} IN ('HC','HC/MC') THEN ${column} * ${DAYS_PER_MONTH} ELSE ${column} END)`;
}

export interface ScopeFilter {
  clientId: string;
  /** Campus name as stored in `rent_roll_data.location`. Null = whole portfolio. */
  location: string | null;
  serviceLine: string;
}

/** Latest rent-roll month that actually has occupied rows for this scope. */
export async function getLatestMonthForScope(scope: ScopeFilter): Promise<string | null> {
  const params: any[] = [scope.clientId, scope.serviceLine];
  let locSql = "";
  if (scope.location) {
    params.push(scope.location);
    locSql = ` AND rr.location = $${params.length}`;
  }
  const res = await pool.query<{ upload_month: string }>(
    `SELECT rr.upload_month
       FROM rent_roll_data rr
      WHERE rr.client_id = $1
        AND rr.service_line = $2
        AND rr.occupied_yn = true${locSql}
      GROUP BY rr.upload_month
     HAVING COUNT(*) > 0
      ORDER BY rr.upload_month DESC
      LIMIT 1`,
    params,
  );
  return res.rows[0]?.upload_month ?? null;
}

export interface RawResidentRow {
  location: string;
  service_line: string;
  room_number: string;
  room_type: string | null;
  care_level: string | null;
  payor_type: string | null;
  move_in_date: string | null;
  move_out_date: string | null;
  in_house_rate: number;
  street_rate: number | null;
  passes_ih_gate: boolean;
  passes_street_gate: boolean;
}

/**
 * The private-pay residents in scope at `month`.
 *
 * Companion "B bed" rows are INCLUDED. They are removed from street-rate
 * averages because they double-count a physical room, but they are real
 * people paying a real in-house rate and they receive increases like anyone
 * else. Reusing the averaging exclusion as a resident filter would silently
 * drop them from the plan.
 */
export async function fetchResidentRows(
  scope: ScopeFilter,
  month: string,
): Promise<RawResidentRow[]> {
  const params: any[] = [scope.clientId, month, scope.serviceLine];
  let locSql = "";
  if (scope.location) {
    params.push(scope.location);
    locSql = ` AND rr.location = $${params.length}`;
  }

  const join = buildRateBaselineJoin({ rr: "rr.", clientSql: "$1", monthSql: "$2" });
  const res = await pool.query<RawResidentRow>(
    `SELECT rr.location,
            rr.service_line,
            rr.room_number,
            rr.room_type,
            rr.care_level,
            rr.payor_type,
            rr.move_in_date,
            rr.move_out_date,
            rr.in_house_rate,
            rr.street_rate,
            ${inHouseRateGate()} AS passes_ih_gate,
            ${streetRateGate()}  AS passes_street_gate
       FROM rent_roll_data rr
       ${join}
      WHERE rr.client_id = $1
        AND rr.upload_month = $2
        AND rr.service_line = $3
        AND rr.occupied_yn = true
        AND ${privatePaySql("rr.payor_type")}${locSql}`,
    params,
  );
  return res.rows;
}

export interface ResidentBuildOptions {
  /** Start of the planning horizon, UTC ms — resident-day weights start here. */
  horizonStartMs: number;
  /** End of the planning horizon, UTC ms (exclusive). */
  horizonEndMs: number;
}

export interface ResidentBuildResult {
  residents: PlanningResident[];
  /** Rows dropped, with the reason, so the caller can warn honestly. */
  excluded: { noRate: number; implausibleRate: number; noStreetRate: number; departingBeforeHorizon: number };
}

/**
 * Turn raw rows into solver residents.
 *
 * Weight is expected resident-days across the planning horizon. Everyone
 * present today contributes the whole horizon unless they already have a
 * move-out date on file, in which case they contribute only the days up to
 * it — a resident who has given notice should not carry the same influence
 * over the average as one who has not.
 */
export function buildResidents(
  rows: RawResidentRow[],
  opts: ResidentBuildOptions,
): ResidentBuildResult {
  const residents: PlanningResident[] = [];
  const excluded = { noRate: 0, implausibleRate: 0, noStreetRate: 0, departingBeforeHorizon: 0 };
  const horizonDays = (opts.horizonEndMs - opts.horizonStartMs) / MS_PER_DAY;

  for (const row of rows) {
    const daily = isDailyRateServiceLine(row.service_line);
    const rate = Number(row.in_house_rate) || 0;
    if (rate <= 0) {
      excluded.noRate++;
      continue;
    }
    if (!row.passes_ih_gate) {
      excluded.implausibleRate++;
      continue;
    }
    const streetRaw = Number(row.street_rate) || 0;
    const usableStreet = streetRaw > 0 && row.passes_street_gate ? streetRaw : 0;
    if (usableStreet === 0) excluded.noStreetRate++;

    const moveIn = parseFlexibleDate(row.move_in_date);
    const moveOut = parseFlexibleDate(row.move_out_date);
    // A resident with a move-out date already on file contributes only the days
    // up to it. Zero overlap is a real answer — they are gone before the plan
    // starts — so it must NOT fall through to the full horizon. Only a MISSING
    // move-out date means "here for the whole horizon".
    const weight = moveOut
      ? stayDaysInPeriod(null, moveOut, opts.horizonStartMs, opts.horizonEndMs)
      : horizonDays;
    if (weight <= 0) {
      excluded.departingBeforeHorizon++;
      continue;
    }

    residents.push({
      key: `${row.location}||${row.service_line}||${row.room_number}||${moveIn ?? "unknown"}`,
      location: row.location,
      serviceLine: row.service_line,
      roomNumber: row.room_number,
      roomType: row.room_type,
      careLevel: row.care_level,
      payorType: row.payor_type,
      moveInDate: moveIn,
      currentRateMonthly: daily ? rate * DAYS_PER_MONTH : rate,
      streetRateMonthly: daily ? usableStreet * DAYS_PER_MONTH : usableStreet,
      isCompanionBed: isBBedRow(row.service_line, row.room_number),
      weight,
    });
  }

  return { residents, excluded };
}

/**
 * Current street rate for the scope, normalized to monthly.
 *
 * B-bed companion rows are excluded here — this IS a street-rate average, and
 * counting the half-price second-occupant row against a room already counted
 * drags the level down. Outlier-gated through `rate_baseline_v` so a junk row
 * cannot move the recommendation.
 */
export async function fetchCurrentStreetRate(
  scope: ScopeFilter,
  month: string,
): Promise<number> {
  const params: any[] = [scope.clientId, month, scope.serviceLine];
  let locSql = "";
  if (scope.location) {
    params.push(scope.location);
    locSql = ` AND rr.location = $${params.length}`;
  }
  const join = buildRateBaselineJoin({ rr: "rr.", clientSql: "$1", monthSql: "$2" });
  const res = await pool.query<{ avg_rate: string | null }>(
    `SELECT AVG(${monthlyRateExpr("rr.street_rate")}) AS avg_rate
       FROM rent_roll_data rr
       ${join}
      WHERE rr.client_id = $1
        AND rr.upload_month = $2
        AND rr.service_line = $3
        AND rr.street_rate > 0
        AND ${privatePaySql("rr.payor_type")}
        AND ${bBedExclusionSql("rr.")}
        AND ${streetRateGate()}${locSql}`,
    params,
  );
  return Number(res.rows[0]?.avg_rate) || 0;
}

export interface MonthlyRealized {
  month: string;
  rateMonthly: number;
  residentDays: number;
}

/**
 * Realized in-house rate per month: private-pay in-house revenue divided by
 * resident-days, in monthly-equivalent dollars.
 *
 * "Realized rate" here is the ROOM rate we set, not room plus care. Care fees
 * are priced separately and an in-house rate increase does not move them, so
 * folding them in would credit the plan with growth it did not cause.
 *
 * Resident-days come from intersecting each stay with the month. Where a row
 * has no move-in date (3% of rows) the stay is assumed to span the whole
 * month, which is what a monthly snapshot actually tells us.
 */
export async function fetchMonthlyRealizedRates(
  scope: ScopeFilter,
  fromMonth: string,
): Promise<MonthlyRealized[]> {
  const params: any[] = [scope.clientId, scope.serviceLine, fromMonth];
  let locSql = "";
  if (scope.location) {
    params.push(scope.location);
    locSql = ` AND rr.location = $${params.length}`;
  }

  // The baseline join correlates on the row's own month: this query spans
  // every month of history for the client, so there is no single month to
  // push down.
  const join = buildRateBaselineJoin({ rr: "rr.", clientSql: "$1" });

  const monthStart = `to_date(rr.upload_month || '-01', 'YYYY-MM-DD')`;
  const monthEndExcl = `(${monthStart} + INTERVAL '1 month')`;
  const stayStart = `GREATEST(${monthStart}, COALESCE(${dateExpr("rr.move_in_date")}, ${monthStart}))`;
  const stayEnd = `LEAST(${monthEndExcl}, COALESCE(${dateExpr("rr.move_out_date")} + 1, ${monthEndExcl}))`;
  const days = `GREATEST(0, EXTRACT(EPOCH FROM (${stayEnd} - ${stayStart})) / 86400.0)`;

  const res = await pool.query<{ month: string; revenue: string; days: string }>(
    `SELECT rr.upload_month AS month,
            SUM(${monthlyRateExpr("rr.in_house_rate")} * (${days})) AS revenue,
            SUM(${days}) AS days
       FROM rent_roll_data rr
       ${join}
      WHERE rr.client_id = $1
        AND rr.service_line = $2
        AND rr.upload_month >= $3
        AND rr.occupied_yn = true
        AND rr.in_house_rate > 0
        AND ${privatePaySql("rr.payor_type")}
        AND ${inHouseRateGate()}${locSql}
      GROUP BY rr.upload_month
      ORDER BY rr.upload_month`,
    params,
  );

  return res.rows
    .map((r) => ({
      month: r.month,
      residentDays: Number(r.days) || 0,
      rateMonthly: Number(r.days) > 0 ? Number(r.revenue) / Number(r.days) : 0,
    }))
    .filter((m) => m.residentDays > 0 && m.rateMonthly > 0);
}

/**
 * Roll monthly realized rates into quarters, resident-day weighted.
 *
 * A quarter with all three months is `actual`; with one or two it is
 * `partial` — a real measurement over a short window, which is honest but not
 * the same thing. Quarters with nothing at all are absent from the map and
 * get projected separately.
 */
export function rollMonthsIntoQuarters(months: MonthlyRealized[]): Map<string, BaselineQuarter> {
  const acc = new Map<string, { ref: QuarterRef; revenue: number; days: number; months: number }>();
  for (const m of months) {
    const ref = quarterOfMonthKey(m.month);
    const cur = acc.get(ref.label) ?? { ref, revenue: 0, days: 0, months: 0 };
    cur.revenue += m.rateMonthly * m.residentDays;
    cur.days += m.residentDays;
    cur.months += 1;
    acc.set(ref.label, cur);
  }
  const out = new Map<string, BaselineQuarter>();
  for (const [label, v] of Array.from(acc.entries())) {
    out.set(label, {
      ...v.ref,
      realizedRateMonthly: v.days > 0 ? v.revenue / v.days : null,
      basis: v.months >= 3 ? "actual" : "partial",
      monthsAvailable: v.months,
      monthsExpected: 3,
      residentDays: v.days,
    });
  }
  return out;
}

/**
 * Fill in a prior-year quarter that has no data at all.
 *
 * Trilogy's rent roll ends 2026-07 and 2026-02 is missing outright, so a plan
 * written today is routinely compared against quarters that were never
 * recorded. Rather than refuse to plan, the baseline is extrapolated from the
 * observed quarter-over-quarter trend of the complete quarters and returned
 * flagged `projected`. The UI must never render it as an actual.
 */
export function projectMissingQuarters(
  known: Map<string, BaselineQuarter>,
  needed: QuarterRef[],
): { baselines: Map<string, BaselineQuarter>; quarterlyGrowthPct: number | null } {
  const out = new Map(known);
  const complete = Array.from(known.values())
    .filter((q) => q.basis === "actual" && (q.realizedRateMonthly ?? 0) > 0)
    .sort((a, b) => quarterDiff(a, b));

  if (complete.length === 0) {
    return { baselines: out, quarterlyGrowthPct: null };
  }

  // Compound quarter-over-quarter growth across the observed window. Using the
  // whole window rather than the last two quarters keeps one odd quarter from
  // setting the trend for everything that follows.
  const first = complete[0];
  const last = complete[complete.length - 1];
  const span = quarterDiff(first, last);
  const growth =
    span > 0
      ? Math.pow(last.realizedRateMonthly! / first.realizedRateMonthly!, 1 / span) - 1
      : 0;

  for (const q of needed) {
    if (out.has(q.label)) continue;
    const steps = quarterDiff(last, q);
    if (steps <= 0) continue; // before our data starts — nothing to extrapolate from
    out.set(q.label, {
      ...q,
      realizedRateMonthly: last.realizedRateMonthly! * Math.pow(1 + growth, steps),
      basis: "projected",
      monthsAvailable: 0,
      monthsExpected: 3,
      residentDays: 0,
    });
  }

  return { baselines: out, quarterlyGrowthPct: growth * 100 };
}

/** The four quarters starting with the one that contains `isoDate`. */
export function horizonQuarters(isoDate: string, count = 4): QuarterRef[] {
  const ms = isoToMs(isoDate);
  const d = new Date(Number.isNaN(ms) ? Date.now() : ms);
  const start = makeQuarterRef(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) + 1);
  return Array.from({ length: count }, (_, i) => addQuarters(start, i));
}

/** Months a quarter should contain — used to report coverage honestly. */
export function expectedMonths(ref: QuarterRef): string[] {
  return quarterMonths(ref);
}
