/**
 * In-House Rate Planning — everything that touches the database.
 *
 * Kept apart from solver.ts so the arithmetic stays testable without a
 * database, and so the shared payer-scope, B-bed and rate-normalization
 * definitions are consumed in exactly one place.
 */
import { pool } from "../../db";
import { privatePaySql } from "@shared/payerScope";
import { isBBedRow } from "@shared/bBed";
import { baseRateExclusionSql } from "@shared/baseRate";
import { DAYS_PER_MONTH } from "@shared/careRates";
import { RATE_OUTLIER_FLOOR_RATIO } from "@shared/rateOutliers";
import {
  classifyRateProduct,
  derivedTypeForProduct,
  rateProductSql,
  type RateProduct,
} from "@shared/rateProduct";
import {
  applyDerivedFormula,
  resolveFormula,
  type DerivedRateFormula,
} from "@shared/derivedRates";
import { isDailyRateServiceLine } from "../rateNormalization";
import {
  buildRateBaselineJoin,
  inHouseRateGate,
  streetRateGate,
} from "../rateBaselineView";
import type {
  BaselineQuarter,
  PlanningResident,
  QuarterRef,
  StreetRateSource,
} from "@shared/inhousePlanning";
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
  source_room_type: string | null;
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
            rr.source_room_type,
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
         AND ${privatePaySql("rr.payor_type")}
         AND ${baseRateExclusionSql("rr.")}${locSql}`,
    params,
  );
  return res.rows;
}

/** What a product street rate resolver hands back for one row. */
export interface ProductStreetRate {
  /** Street rate for this row's product, in the row's own units (daily for HC). */
  rate: number;
  /** Where it came from, so the resident can say so honestly. */
  source: Extract<
    StreetRateSource,
    "product_median" | "service_line_median" | "derived_formula"
  >;
}

export interface ResidentBuildOptions {
  /** Start of the planning horizon, UTC ms — resident-day weights start here. */
  horizonStartMs: number;
  /** End of the planning horizon, UTC ms (exclusive). */
  horizonEndMs: number;
  /**
   * The street rate for a row's own PRODUCT — a second-occupant rate for a
   * companion bed, a semi-private rate for a shared health-care bed, and so
   * on. See `makeProductStreetResolver`.
   *
   * Optional so the solver tests can build residents without a database. When
   * it is absent the row falls back to the base-median street gate, which is
   * what this code did before products existed.
   */
  productStreet?: (row: RawResidentRow, product: RateProduct) => ProductStreetRate | null;
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
 *
 * ── The street rate a resident is measured against ─────────────────────────
 * It must be the street rate for the PRODUCT they occupy: a second occupant
 * against the second-occupant rate, a shared health-care bed against the
 * semi-private rate, a respite stay against the respite rate. Comparing every
 * resident against the single-occupancy base rate breaks in both directions —
 * a villa second occupant pays about a sixth of the base villa rate, so the
 * base-median plausibility gate threw their real rate away and left them with
 * no ceiling at all, while a short-stay resident would be judged against a
 * rate well below what their stay actually asks.
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
    // A low in-house rate may be a data-quality issue, but it is still the
    // resident's actual rate and must remain in the plan. The plausibility gate
    // is retained on the raw row for diagnostics and for rate aggregates; it
    // must never remove a person from resident-level planning.
    const product = classifyRateProduct(
      row.service_line,
      row.room_number,
      row.room_type,
      row.source_room_type,
    );
    const productStreet = opts.productStreet?.(row, product) ?? null;

    // Judge the row's own street rate against its OWN product, not against the
    // single-occupancy base. Without a product rate to judge against, fall back
    // to the base-median gate the row already carries — permissive beats
    // discarding a rate we cannot actually prove is wrong.
    const streetRaw = Number(row.street_rate) || 0;
    const plausible =
      productStreet && productStreet.rate > 0
        ? streetRaw >= RATE_OUTLIER_FLOOR_RATIO * productStreet.rate
        : row.passes_street_gate;

    // A MatrixCare non-base charge can occasionally land in both FinalRate and
    // BaseRate1 while the row still carries the building's monthly service line.
    // Example: a $189/day Skilled charge on an AL room. Its two stored rates are
    // then identical, but the product-matched AL single-occupant benchmark is
    // roughly $5,000/month. This is not a deeply discounted AL resident: it is a
    // daily non-base product whose source descriptor was lost at import, and it
    // must not enter the base-rate planning cohort.
    //
    // Keep the guard deliberately narrow. A genuinely discounted resident stays
    // in the plan when their published Street Rate is valid and differs from
    // their in-house rate.
    const mislabeledDailyProductInMonthlyLine =
      !daily &&
      product === "base" &&
      productStreet != null &&
      productStreet.rate > 0 &&
      streetRaw > 0 &&
      !plausible &&
      Math.abs(rate - streetRaw) < 0.01;
    if (mislabeledDailyProductInMonthlyLine) {
      excluded.implausibleRate++;
      continue;
    }

    let usableStreet = streetRaw > 0 && plausible ? streetRaw : 0;
    let streetRateSource: StreetRateSource = usableStreet > 0 ? "unit" : "none";

    // The unit's own asking rate is missing or implausible. The product rate is
    // still a real, product-matched ceiling — far better than planning this
    // resident with no ceiling at all, which is what "no street rate" means to
    // the solver.
    if (usableStreet === 0 && productStreet && productStreet.rate > 0) {
      usableStreet = productStreet.rate;
      streetRateSource = productStreet.source;
    }
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
      rateProduct: product,
      streetRateSource,
      isCompanionBed: isBBedRow(row.service_line, row.room_number),
      weight,
    });
  }

  return { residents, excluded };
}

/**
 * Median street rate for every location + service line + PRODUCT, plus the
 * service-line-wide median of the same product as a second level.
 *
 * ── Why medians, and why two levels ────────────────────────────────────────
 * Same reasoning as `rate_baseline_v`: a median is not dragged around by the
 * very outliers it exists to detect, and a location whose rows are all junk
 * must still be caught by a yardstick it cannot influence. The difference is
 * that this one is cut by product, so the reference level for a companion bed
 * is what companion beds ask, not what private rooms ask.
 *
 * The service-line level is deliberately NOT narrowed by `scope.location`.
 * Filtering the level-2 population to the campus being planned would collapse
 * the yardstick onto the campus it is supposed to judge — the exact bug the
 * baseline view was made a view to prevent.
 *
 * ── Vacant units count for the base rate, and only for the base rate ───────
 * Street rate is an ASKING rate and exists on empty units, which are often the
 * cleanest evidence of what a room lists for. But a VACANT companion bed is
 * not priced as a second occupant — the whole room is empty, so the row simply
 * carries the room's own asking rate. On trilogy the villa companion rows read
 * $3,299 vacant against $509 occupied, and letting the vacant ones into the
 * median produced a second-occupant "street rate" six times what any second
 * occupant is actually asked to pay. Non-base products therefore measure
 * occupied rows only; the base product keeps its vacant evidence.
 */
export interface ProductStreetBaselines {
  /** `location||service_line||product` → median street rate, in stored units. */
  byLocation: Map<string, number>;
  /** `service_line||product` → median street rate, in stored units. */
  byServiceLine: Map<string, number>;
}

export async function fetchProductStreetBaselines(
  scope: ScopeFilter,
  month: string,
): Promise<ProductStreetBaselines> {
  const res = await pool.query<{
    location: string | null;
    product: string;
    loc_median: string | null;
    sl_median: string | null;
  }>(
    `WITH scoped AS (
       SELECT rr.location, ${rateProductSql("rr.")} AS product, rr.street_rate, rr.occupied_yn
         FROM rent_roll_data rr
        WHERE rr.client_id = $1
          AND rr.upload_month = $2
          AND rr.service_line = $3
          AND rr.street_rate > 0
     ),
     priced AS (
       SELECT * FROM scoped WHERE product = 'base' OR occupied_yn
     ),
     loc AS (
       SELECT location, product,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY street_rate) AS m
         FROM priced GROUP BY location, product
     ),
     sl AS (
       SELECT product,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY street_rate) AS m
         FROM priced GROUP BY product
     )
     SELECT l.location, l.product, l.m AS loc_median, s.m AS sl_median
       FROM loc l
       LEFT JOIN sl s ON s.product = l.product`,
    [scope.clientId, month, scope.serviceLine],
  );

  const byLocation = new Map<string, number>();
  const byServiceLine = new Map<string, number>();
  for (const r of res.rows) {
    const loc = Number(r.loc_median);
    const sl = Number(r.sl_median);
    if (Number.isFinite(sl) && sl > 0) {
      byServiceLine.set(`${scope.serviceLine}||${r.product}`, sl);
    }
    if (!Number.isFinite(loc) || loc <= 0) continue;
    // Level 2: a location median far below the service line's own level is not
    // a cheap campus, it is a campus whose rows are bad. Use the wider median.
    const usable =
      Number.isFinite(sl) && sl > 0 && loc < RATE_OUTLIER_FLOOR_RATIO * sl ? sl : loc;
    byLocation.set(`${r.location ?? ""}||${scope.serviceLine}||${r.product}`, usable);
  }
  return { byLocation, byServiceLine };
}

/**
 * Build the per-row product street rate lookup `buildResidents` uses.
 *
 * Three sources, in order of how directly they evidence the product:
 *
 *   1. the median street rate for that product at that campus,
 *   2. the median for that product across the service line,
 *   3. the derived-rate formula the user configured on the Data Management
 *      page, applied to the campus's own base rate.
 *
 * (3) is the only place a derived rate is used, and it is used as a CEILING
 * for one resident, never fed back into an average — the rule that derived
 * rates are outputs and never inputs is intact. It matters for a product that
 * exists in the resident population but has no priced row anywhere to measure,
 * which is precisely the case the formulas were configured for.
 *
 * ── One known approximation, and its bound ─────────────────────────────────
 * The solver later raises every ceiling by the recommended street increase
 * (`street x multiplier`). For a derived rate that is `base x pct + offset`,
 * multiplying the whole thing also scales the flat offset, where the exact
 * answer would raise only the percentage term. The gap is `offset x (m - 1)` —
 * a few dollars a month on a five percent rise — and every formula configured
 * today carries a zero offset, so the gap is currently exactly zero. Carrying
 * a separate fixed component through the solver, the Excel formulas and the
 * audit sheet to remove it would cost far more clarity than it buys; if flat
 * offsets ever come into real use, that is the point to revisit it.
 */
export function makeProductStreetResolver(
  baselines: ProductStreetBaselines,
  formulas: readonly DerivedRateFormula[],
): (row: RawResidentRow, product: RateProduct) => ProductStreetRate | null {
  return (row, product) => {
    const sl = row.service_line;
    // The two medians are reported separately: a ceiling set by other
    // buildings is a weaker piece of evidence than one set by this building,
    // and an operator auditing a recommendation is entitled to see which.
    const atCampus = baselines.byLocation.get(`${row.location}||${sl}||${product}`);
    if (atCampus && atCampus > 0) return { rate: atCampus, source: "product_median" };

    const acrossSl = baselines.byServiceLine.get(`${sl}||${product}`);
    if (acrossSl && acrossSl > 0) return { rate: acrossSl, source: "service_line_median" };

    const derivedType = derivedTypeForProduct(product);
    if (!derivedType) return null;

    const base =
      baselines.byLocation.get(`${row.location}||${sl}||base`) ??
      baselines.byServiceLine.get(`${sl}||base`);
    const derived = applyDerivedFormula(base, resolveFormula(formulas, derivedType, sl));
    return derived && derived > 0 ? { rate: derived, source: "derived_formula" } : null;
  };
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
         AND ${baseRateExclusionSql("rr.")}
        AND ${streetRateGate()}${locSql}`,
    params,
  );
  return Number(res.rows[0]?.avg_rate) || 0;
}

export interface MixStandardizedStreetComparison {
  /** Average January rate over rooms present and eligible in BOTH months. */
  priorMatchedMonthly: number;
  /** Average current rate over that same matched room set. */
  currentMatchedMonthly: number;
  /** Rooms matched in both months. */
  matchedRooms: number;
  /** Eligible rooms in the current month, matched or not. */
  currentRooms: number;
}

/**
 * January vs today's Street Rate, measured on the same physical rooms.
 *
 * The payer occupying a room and the mix of priced products both change between
 * January and the source month. Two independently weighted averages therefore
 * move even when no room's price changed, which silently shifts the annual
 * ceiling. Both sides are instead averaged over one matched room set.
 *
 * Rooms are deduplicated first: `rent_roll_data` has no uniqueness constraint on
 * (client, month, location, service line, room), so joining raw rows fans out
 * and weights duplicated rooms more heavily.
 *
 * The January side is deliberately NOT payer-filtered — a room switching from
 * Medicare to private pay is exactly the mix artifact being removed — but it is
 * held to the same base-product and plausibility rules, so a room that was a
 * companion or short-stay product in January cannot contribute another
 * product's price.
 */
export async function fetchMixStandardizedStreetComparison(
  scope: ScopeFilter,
  baselineMonth: string,
  currentMonth: string,
): Promise<MixStandardizedStreetComparison> {
  const params: any[] = [scope.clientId, currentMonth, scope.serviceLine, baselineMonth];
  let locSql = "";
  if (scope.location) {
    params.push(scope.location);
    locSql = ` AND rr.location = $${params.length}`;
  }
  const roomCte = (monthSql: string, alias: string, payerFiltered: boolean) => `
    SELECT rr.location, rr.service_line, rr.room_number,
           AVG(${monthlyRateExpr("rr.street_rate")}) AS rate
      FROM rent_roll_data rr
      ${buildRateBaselineJoin({ clientSql: "$1", monthSql, alias })}
     WHERE rr.client_id = $1
       AND rr.upload_month = ${monthSql}
       AND rr.service_line = $3
       AND rr.room_number IS NOT NULL
       AND rr.street_rate > 0
       ${payerFiltered ? `AND ${privatePaySql("rr.payor_type")}` : ""}
       AND ${baseRateExclusionSql("rr.")}
       AND ${streetRateGate("rr.", alias)}${locSql}
     GROUP BY rr.location, rr.service_line, rr.room_number`;

  const res = await pool.query<{
    prior_rate: string | null;
    current_rate: string | null;
    matched_rooms: string;
    current_rooms: string;
  }>(
    `WITH cur AS (${roomCte("$2", "cur_rb", true)}),
          hist AS (${roomCte("$4", "hist_rb", false)}),
          matched AS (
            SELECT cur.rate AS cur_rate, hist.rate AS hist_rate
              FROM cur
              JOIN hist
                ON hist.location = cur.location
               AND hist.service_line = cur.service_line
               AND hist.room_number = cur.room_number
          )
     SELECT (SELECT AVG(hist_rate) FROM matched) AS prior_rate,
            (SELECT AVG(cur_rate) FROM matched) AS current_rate,
            (SELECT COUNT(*) FROM matched) AS matched_rooms,
            (SELECT COUNT(*) FROM cur) AS current_rooms`,
    params,
  );
  const row = res.rows[0];
  return {
    priorMatchedMonthly: Number(row?.prior_rate) || 0,
    currentMatchedMonthly: Number(row?.current_rate) || 0,
    matchedRooms: Number(row?.matched_rooms) || 0,
    currentRooms: Number(row?.current_rooms) || 0,
  };
}

/**
 * Authoritative matched Top Competitor rate for this planning scope, normalized
 * to monthly. The matching/reprocessing pipeline has already written the
 * product-appropriate benchmark to each rent-roll row; averaging the same
 * base-rate population keeps this signal on the planner's exact scope.
 */
export async function fetchTopCompetitorRate(
  scope: ScopeFilter,
  month: string,
): Promise<number | null> {
  const params: any[] = [scope.clientId, month, scope.serviceLine];
  let locSql = "";
  if (scope.location) {
    params.push(scope.location);
    locSql = ` AND rr.location = $${params.length}`;
  }
  const res = await pool.query<{ avg_rate: string | null }>(
    `SELECT AVG(${monthlyRateExpr("rr.competitor_final_rate")}) AS avg_rate
       FROM rent_roll_data rr
      WHERE rr.client_id = $1
        AND rr.upload_month = $2
        AND rr.service_line = $3
        AND rr.competitor_final_rate > 0
        AND ${privatePaySql("rr.payor_type")}
        AND ${baseRateExclusionSql("rr.")}${locSql}`,
    params,
  );
  const value = Number(res.rows[0]?.avg_rate);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface MonthlyRealized {
  month: string;
  rateMonthly: number;
  weightBasis: "resident_months" | "resident_days";
  /** Resident-months for senior housing; resident-days for HC/HC-MC. */
  residentDays: number;
  /** Current rate for the exact same unit rows, using the service line's weight basis. */
  currentMixRateMonthly?: number;
}

export function realizedRateWeightBasis(
  serviceLine: string,
): MonthlyRealized["weightBasis"] {
  return serviceLine === "HC" || serviceLine === "HC/MC"
    ? "resident_days"
    : "resident_months";
}

/**
 * Realized in-house rate per month, in monthly-equivalent dollars.
 *
 * "Realized rate" here is the ROOM rate we set, not room plus care. Care fees
 * are priced separately and an in-house rate increase does not move them, so
 * folding them in would credit the plan with growth it did not cause.
 *
 * AL, AL/MC, SL, and VIL rates are monthly, so every qualifying snapshot is
 * one resident-month. HC and HC/MC rates are daily, so those lines retain the
 * resident's actual overlap days within each month.
 */
export async function fetchMonthlyRealizedRates(
  scope: ScopeFilter,
  fromMonth: string,
  unitMix?: Array<{ key: string; currentRateMonthly: number }>,
): Promise<MonthlyRealized[]> {
  const params: any[] = [scope.clientId, scope.serviceLine, fromMonth];
  let locSql = "";
  if (scope.location) {
    params.push(scope.location);
    locSql = ` AND rr.location = $${params.length}`;
  }

  const monthStart = `to_date(rr.upload_month || '-01', 'YYYY-MM-DD')`;
  const monthEndExcl = `(${monthStart} + INTERVAL '1 month')`;
  const stayStart = `GREATEST(${monthStart}, COALESCE(${dateExpr("rr.move_in_date")}, ${monthStart}))`;
  const stayEnd = `LEAST(${monthEndExcl}, COALESCE(${dateExpr("rr.move_out_date")} + 1, ${monthEndExcl}))`;
  const days = `GREATEST(0, EXTRACT(EPOCH FROM (${stayEnd} - ${stayStart})) / 86400.0)`;
  const weightBasis = realizedRateWeightBasis(scope.serviceLine);
  const observationWeight = weightBasis === "resident_days" ? days : "1";

  let unitMixJoin = "";
  let currentMixRevenueSql = "NULL::double precision";
  if (unitMix?.length) {
    params.push(unitMix.map((u) => u.key));
    const keysParam = params.length;
    params.push(unitMix.map((u) => u.currentRateMonthly));
    const ratesParam = params.length;
    unitMixJoin = `
       JOIN unnest($${keysParam}::text[], $${ratesParam}::double precision[])
         AS mix(unit_key, current_rate_monthly)
         ON mix.unit_key =
            (COALESCE(rr.location, '') || E'\\x1f' || COALESCE(rr.room_number, ''))`;
    currentMixRevenueSql = `SUM(mix.current_rate_monthly * (${observationWeight}))`;
  }

  // The baseline join correlates on the row's own month: this query spans
  // every month of history for the client, so there is no single month to
  // push down.
  const join = buildRateBaselineJoin({ rr: "rr.", clientSql: "$1" });

  const res = await pool.query<{
    month: string;
    revenue: string;
    current_mix_revenue: string | null;
    days: string;
  }>(
    `SELECT rr.upload_month AS month,
            SUM(${monthlyRateExpr("rr.in_house_rate")} * (${observationWeight})) AS revenue,
            ${currentMixRevenueSql} AS current_mix_revenue,
            SUM(${observationWeight}) AS days
       FROM rent_roll_data rr
       ${join}
       ${unitMixJoin}
      WHERE rr.client_id = $1
        AND rr.service_line = $2
        AND rr.upload_month >= $3
        AND rr.occupied_yn = true
        AND rr.in_house_rate > 0
        AND ${privatePaySql("rr.payor_type")}
         AND ${baseRateExclusionSql("rr.")}
         AND ${inHouseRateGate()}${locSql}
      GROUP BY rr.upload_month
      ORDER BY rr.upload_month`,
    params,
  );

  return res.rows
    .map((r) => ({
      month: r.month,
      weightBasis,
      residentDays: Number(r.days) || 0,
      rateMonthly: Number(r.days) > 0 ? Number(r.revenue) / Number(r.days) : 0,
      currentMixRateMonthly:
        Number(r.days) > 0 && r.current_mix_revenue != null
          ? Number(r.current_mix_revenue) / Number(r.days)
          : undefined,
    }))
    .filter((m) => m.residentDays > 0 && m.rateMonthly > 0);
}

/**
 * Roll monthly realized rates into quarters using each service line's
 * observation basis: resident-months for senior housing, resident-days for
 * HC/HC-MC.
 *
 * A quarter with all three months is `actual`; with one or two it is
 * `partial` — a real measurement over a short window, which is honest but not
 * the same thing. Quarters with nothing at all are absent from the map and
 * get projected separately.
 */
export function rollMonthsIntoQuarters(months: MonthlyRealized[]): Map<string, BaselineQuarter> {
  const acc = new Map<
    string,
    { ref: QuarterRef; revenue: number; days: number; monthKeys: Set<string> }
  >();
  for (const m of months) {
    const ref = quarterOfMonthKey(m.month);
    const cur = acc.get(ref.label) ?? { ref, revenue: 0, days: 0, monthKeys: new Set<string>() };
    cur.revenue += m.rateMonthly * m.residentDays;
    cur.days += m.residentDays;
    cur.monthKeys.add(m.month);
    acc.set(ref.label, cur);
  }
  const out = new Map<string, BaselineQuarter>();
  for (const [label, v] of Array.from(acc.entries())) {
    out.set(label, {
      ...v.ref,
      realizedRateMonthly: v.days > 0 ? v.revenue / v.days : null,
      basis: v.monthKeys.size >= 3 ? "actual" : "partial",
      monthsAvailable: v.monthKeys.size,
      monthsExpected: 3,
      availableMonths: Array.from(v.monthKeys).sort(),
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
 * latest observed quarter-over-quarter trend and returned flagged `projected`.
 * A partial quarter may anchor the projection because it is the freshest real
 * rate evidence, but the result remains explicitly projected in the UI.
 */
export function projectMissingQuarters(
  known: Map<string, BaselineQuarter>,
  needed: QuarterRef[],
): { baselines: Map<string, BaselineQuarter>; quarterlyGrowthPct: number | null } {
  const out = new Map(known);
  const observed = Array.from(known.values())
    .filter((q) => q.basis !== "projected" && (q.realizedRateMonthly ?? 0) > 0)
    // quarterDiff(a, b) is the distance FROM a TO b, so using it directly as
    // the comparator reverses chronological order. Keep oldest first and the
    // latest complete quarter last because projections anchor on `last`.
    .sort((a, b) => quarterDiff(b, a));

  if (observed.length === 0) {
    return { baselines: out, quarterlyGrowthPct: null };
  }

  // Continue the latest measured trajectory, rather than compounding an old
  // portfolio-wide trend past the freshest evidence. This matters when Q3 is
  // partial: projecting Q4 from Q2 treats it as two missing quarters and can
  // jump far above the real July/August run rate.
  const last = observed[observed.length - 1];
  const previous = observed.length > 1 ? observed[observed.length - 2] : last;
  const span = quarterDiff(previous, last);
  const growth =
    span > 0
      ? Math.pow(last.realizedRateMonthly! / previous.realizedRateMonthly!, 1 / span) - 1
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
