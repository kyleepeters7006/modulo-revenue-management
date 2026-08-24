/**
 * Regression coverage for the measured annual-turnover assumption.
 *
 * This number is not cosmetic: the solver blends the resident base toward the
 * street rate at exactly this speed, so getting it wrong silently changes
 * every recommended in-house increase. Three specific ways it can go wrong,
 * each of which produced a materially different answer on real data:
 *
 *   1. Payer scope. All-payer, this client's HC turns over 943% a year —
 *      real clinical discharges, but almost all Medicare/Managed Care
 *      short-stay residents whose rate is set externally. Counting them
 *      pretends the resident base re-prices itself several times a year.
 *
 *   2. The partial trailing month. The event feed lands a few days into the
 *      new month with a fraction of its discharges. Including it drags every
 *      line down by roughly a twelfth.
 *
 *   3. Numerator/denominator basis drift. The numerator is private-pay
 *      move-outs; the denominator must be private-pay occupied units. Pairing
 *      a scoped numerator with an all-payer denominator understates HC by ~5x.
 *
 *   4. A service line with a denominator and no numerator. Memory care inside
 *      the Health Center is its own line in occupancy history and the rent
 *      roll, but the event feed's "Service Line" column calls the whole
 *      building "Health Center". Its discharges were therefore filed under HC
 *      and HC/MC measured exactly 0% — read as "nobody ever leaves memory
 *      care", and silently replaced by a hand-typed assumption. Only the
 *      event's DEPARTMENT distinguishes the neighbourhood, so the department
 *      mapping is what these tests pin.
 *
 * Scopes are DISCOVERED, so the suite keeps testing something after a
 * re-import rather than pinning values that a new upload invalidates.
 *
 * Run with: npx tsx tests/inhouseTurnoverHistory.test.ts
 */
import { pool } from "../server/db";
import { privatePaySql } from "../shared/payerScope";
import { computeHistoricalTurnover } from "../server/services/inhouseRatePlanning/historicalTurnover";
import {
  DEPT_TO_SERVICE_LINE,
  serviceLineForDept,
} from "../server/services/moveInOutService";
import {
  MODEL_MAX_TURNOVER_PCT,
  TURNOVER_BANDS,
  defaultTurnoverFor,
  explainTurnoverOutOfBand,
  isTurnoverInBand,
  turnoverBandFor,
} from "../shared/turnoverBounds";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
let passed = 0;
let failed = 0;

function ok(description: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`${PASS} ${description}`);
    passed++;
  } else {
    console.log(`${FAIL} ${description}`);
    if (detail) console.log(`    ${detail}`);
    failed++;
  }
}

/** The client with the most move-out events — i.e. the real data set. */
async function largestEventClient(): Promise<string | null> {
  const res = await pool.query<{ client_id: string }>(
    `SELECT client_id
       FROM move_in_out_events
      WHERE event_type = 'move_out' AND counted = true
      GROUP BY client_id
      ORDER BY COUNT(*) DESC
      LIMIT 1`,
  );
  return res.rows[0]?.client_id ?? null;
}

async function main() {
  const clientId = await largestEventClient();
  if (!clientId) {
    console.log("No move-out events in the database — nothing to verify.");
    return;
  }
  console.log(`\n── measuring turnover for client "${clientId}" ──`);

  const result = await computeHistoricalTurnover(clientId, null, null);
  ok("a client with events produces a result", result !== null);
  if (!result) return;

  // ── The measurement window ────────────────────────────────────────────────

  ok(
    "the window is twelve months",
    result.monthsInWindow === 12,
    `got ${result.monthsInWindow}`,
  );
  ok(
    "the window start precedes its end",
    !!result.windowStart && !!result.windowEnd && result.windowStart < result.windowEnd,
    `${result.windowStart} .. ${result.windowEnd}`,
  );

  const { rows: feedRows } = await pool.query<{ max_event_date: string }>(
    `SELECT MAX(event_date) AS max_event_date FROM move_in_out_events WHERE client_id = $1`,
    [clientId],
  );
  const maxEventDate = feedRows[0].max_event_date;
  const maxEventMonth = maxEventDate.slice(0, 7);
  const feedMonthIsPartial = Number(maxEventDate.slice(8, 10)) < 28;
  if (feedMonthIsPartial) {
    ok(
      "a partial trailing month is excluded from the window",
      result.windowEnd! < maxEventMonth,
      `feed ends ${maxEventDate} but window ends ${result.windowEnd}`,
    );
  }

  const { rows: histRows } = await pool.query<{ m: string }>(
    `SELECT to_char(make_date(year, month, 1), 'YYYY-MM') AS m
       FROM room_type_occupancy_history
      WHERE client_id = $1
      ORDER BY year DESC, month DESC
      LIMIT 1`,
    [clientId],
  );
  ok(
    "the window never runs past the occupancy history that has to cover it",
    !!histRows[0] && result.windowEnd! <= histRows[0].m,
    `window ends ${result.windowEnd}, history ends ${histRows[0]?.m}`,
  );

  // ── Payer scope bites on HC/HC-MC, and all-payer is used for other lines ──
  //
  // HC and HC/MC carry tens of thousands of Medicare/Managed Care short-stay
  // rehab discharges. Counting them as turnover pretends the resident base
  // re-prices itself several times a year. The filter is mandatory there.
  //
  // For all other lines (AL, AL/MC, SL, VIL) the numerator counts all move-
  // outs regardless of payer, giving a cleaner "fraction of beds that turned
  // over" measure. Those lines have negligible external-payer volume.

  const { rows: payerRows } = await pool.query<{ all_payer: string; private_pay: string }>(
    `SELECT COUNT(*)::text AS all_payer,
            COUNT(*) FILTER (WHERE ${privatePaySql("payer")})::text AS private_pay
       FROM move_in_out_events
      WHERE client_id = $1
        AND event_type = 'move_out'
        AND counted = true
        AND service_line IN ('HC', 'HC/MC')
        AND substring(event_date, 1, 7) BETWEEN $2 AND $3`,
    [clientId, result.windowStart, result.windowEnd],
  );
  const allPayerHc = Number(payerRows[0].all_payer);
  const privatePayHc = Number(payerRows[0].private_pay);
  ok(
    "HC / HC/MC payer scope excludes externally-priced move-outs",
    privatePayHc < allPayerHc,
    `private ${privatePayHc} vs all ${allPayerHc} — scope is not filtering HC/HC-MC`,
  );

  // HC and HC/MC lines must only count private-pay move-outs.
  const hcLinesInResult = result.byServiceLine.filter((r) =>
    ["HC", "HC/MC"].includes(r.serviceLine),
  );
  const hcMoveOuts = hcLinesInResult.reduce((s, r) => s + r.moveOuts, 0);
  ok(
    "HC / HC/MC lines do not count externally-priced move-outs",
    hcMoveOuts <= privatePayHc,
    `HC+HC/MC lines total ${hcMoveOuts} but only ${privatePayHc} private-pay HC/HC-MC move-outs exist`,
  );

  // Non-HC lines count all move-outs (no payer filter) — verify at least one
  // non-HC line has move-outs and that its privatePayBasis is false.
  const nonHcLines = result.byServiceLine.filter(
    (r) => !["HC", "HC/MC"].includes(r.serviceLine),
  );
  ok(
    "non-HC lines report privatePayBasis = false (unit-turnover basis)",
    nonHcLines.every((r) => !r.privatePayBasis),
    nonHcLines
      .filter((r) => r.privatePayBasis)
      .map((r) => r.serviceLine)
      .join(", ") || "all correct",
  );
  ok(
    "HC / HC/MC lines report privatePayBasis = true",
    hcLinesInResult.every((r) => r.privatePayBasis),
    "an HC-family line was flagged as unit-turnover basis",
  );

  const summedMoveOuts = result.byServiceLine.reduce((s, r) => s + r.moveOuts, 0);

  // ── Every line is internally consistent ───────────────────────────────────

  for (const line of result.byServiceLine) {
    const recomputed = (line.moveOuts / line.avgOccupiedUnits) * 100;
    ok(
      `${line.serviceLine}: the reported percent is its own move-outs over its own units`,
      Math.abs(recomputed - line.turnoverPct) < 0.6,
      `${line.moveOuts}/${line.avgOccupiedUnits} = ${recomputed.toFixed(1)}% but reported ${line.turnoverPct}%`,
    );
    // HC/HC-MC use private-pay share; other lines use all occupied units.
    if (["HC", "HC/MC"].includes(line.serviceLine)) {
      ok(
        `${line.serviceLine}: denominator is private-pay share, not the whole census`,
        line.privatePaySharePct > 0 && line.privatePaySharePct <= 100,
        `share ${line.privatePaySharePct}%`,
      );
    }
    ok(
      `${line.serviceLine}: coverage is a real month count inside the window`,
      line.monthsCovered > 0 && line.monthsCovered <= 12,
      `monthsCovered ${line.monthsCovered}`,
    );

    // ── The band is per service line, and the verdict must follow it ────────

    const band = turnoverBandFor(line.serviceLine);
    ok(
      `${line.serviceLine}: reports the band it was judged against`,
      line.bandMin === band.min && line.bandMax === band.max,
      `got ${line.bandMin}-${line.bandMax}, band is ${band.min}-${band.max}`,
    );
    ok(
      `${line.serviceLine}: nothing outside its own band is ever auto-applied`,
      !line.plausible || isTurnoverInBand(line.serviceLine, line.turnoverPct),
      `${line.turnoverPct}% passed a ${band.min}-${band.max}% band`,
    );
    ok(
      `${line.serviceLine}: a rejected line always says why`,
      line.plausible === (line.outOfBandReason === null),
      `plausible=${line.plausible} reason=${line.outOfBandReason}`,
    );
    // The rounded percent is what the badge prints; judging the unrounded one
    // would let a line read "85%" beside an "expected 30-85%" warning.
    ok(
      `${line.serviceLine}: the verdict matches the number shown, not a rounding of it`,
      line.plausible ===
        (isTurnoverInBand(line.serviceLine, line.turnoverPct) && line.monthsCovered >= 6),
      `${line.turnoverPct}% flagged plausible=${line.plausible}`,
    );
  }

  // ── The floor has to bite, not just the ceiling ───────────────────────────
  //
  // A single 100% ceiling accepted AL/MC at 14%, which implies a seven-year
  // memory-care stay. That direction of error is the dangerous one: it is
  // quiet, and it makes in-house increases look far more load-bearing than
  // they are.

  const tooSlow = result.byServiceLine.filter(
    (r) => r.turnoverPct > 0 && r.turnoverPct < turnoverBandFor(r.serviceLine).min,
  );
  for (const line of tooSlow) {
    ok(
      `${line.serviceLine}: an implausibly SLOW line is rejected, not silently adopted`,
      !line.plausible && (line.outOfBandReason ?? "").includes("longer stay"),
      `${line.turnoverPct}% was accepted below a ${line.bandMin}% floor`,
    );
  }
  console.log(`  (${tooSlow.length} line(s) rejected by the floor rather than the ceiling)`);

  // ── A scope with partial history must not borrow months it does not have ──
  //
  // The failure this guards is silent: a full year of move-outs divided by an
  // average over the four months a campus actually reported reads as a
  // turnover spike, labelled as a twelve-month measure.

  const { rows: shortRows } = await pool.query<{ id: string; name: string; n: string }>(
    `SELECT l.id, l.name, COUNT(DISTINCT (h.year, h.month))::text AS n
       FROM locations l
       JOIN room_type_occupancy_history h ON h.location_id = l.id
       JOIN move_in_out_events e ON e.location = l.name AND e.client_id = l.client_id
      WHERE l.client_id = $1
        AND e.event_type = 'move_out' AND e.counted = true
        AND to_char(make_date(h.year, h.month, 1), 'YYYY-MM') BETWEEN $2 AND $3
      GROUP BY l.id, l.name
      HAVING COUNT(DISTINCT (h.year, h.month)) < 12
      ORDER BY COUNT(DISTINCT (h.year, h.month)) ASC
      LIMIT 1`,
    [clientId, result.windowStart, result.windowEnd],
  );
  if (shortRows[0]) {
    const partial = await computeHistoricalTurnover(
      clientId,
      shortRows[0].id,
      shortRows[0].name,
    );
    const worst = partial?.byServiceLine.reduce(
      (lo, r) => Math.min(lo, r.monthsCovered),
      12,
    );
    ok(
      `a campus with partial history (${shortRows[0].name}) reports its real coverage`,
      worst !== undefined && worst < 12,
      `expected a line under 12 months, got ${worst}`,
    );
    ok(
      "a partially-covered line is never silently auto-applied",
      (partial?.byServiceLine ?? []).every((r) => r.monthsCovered >= 6 || !r.plausible),
      "a line under six months was flagged plausible",
    );
  } else {
    console.log("  (no campus with partial history in the window — coverage path not exercised)");
  }

  // ── A half-specified scope is refused, not silently mixed ─────────────────

  let refusedIdOnly = false;
  try {
    await computeHistoricalTurnover(clientId, "some-id", null);
  } catch {
    refusedIdOnly = true;
  }
  ok(
    "an id without a campus name is refused",
    refusedIdOnly,
    "a campus denominator would have paired with a portfolio numerator",
  );

  let refusedNameOnly = false;
  try {
    await computeHistoricalTurnover(clientId, null, "Some Campus");
  } catch {
    refusedNameOnly = true;
  }
  ok(
    "a campus name without an id is refused",
    refusedNameOnly,
    "a campus numerator would have paired with a portfolio denominator",
  );

  // ── The admissions vocabulary is folded into the pricing one ──────────────

  const { rows: ilRows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM move_in_out_events
      WHERE client_id = $1 AND event_type = 'move_out' AND counted = true
        AND upper(trim(service_line)) = 'IL'`,
    [clientId],
  );
  if (Number(ilRows[0].n) > 0) {
    ok(
      "IL move-outs do not appear as their own line",
      !result.byServiceLine.some((r) => r.serviceLine === "IL"),
      "IL should be folded into VIL — history has no IL rows to divide by",
    );
    const vil = result.byServiceLine.find((r) => r.serviceLine === "VIL");
    ok(
      "IL move-outs land in VIL instead of being dropped",
      !!vil && vil.moveOuts > 0,
      `VIL move-outs: ${vil?.moveOuts}`,
    );
  }

  // ── Memory care inside the Health Center is its own line ──────────────────
  //
  // The failure this guards is the quietest one in the whole measurement: the
  // line still appears, its denominator is right, and it reports 0%. Nothing
  // errors. The page falls back to the typed-in assumption while implying it
  // measured something.

  // The mapping is what makes the split possible, so pin it directly. A future
  // import format that stops emitting the department, or a "simplification"
  // that drops the entry, reverts the bug in full silence.
  ok(
    "the memory-care department still resolves to its own service line",
    serviceLineForDept("HC Legacy") === "HC/MC",
    `got ${serviceLineForDept("HC Legacy")} — HC/MC discharges would be filed as HC`,
  );
  ok(
    "the department lookup tolerates the spelling a workbook actually uses",
    serviceLineForDept("  hc legacy  ") === "HC/MC",
    "case/whitespace variation must not silently fall through to the Service Line text",
  );

  // Stored rows have to agree with the mapping too. Event workbooks are
  // historical uploads; a mapping fix that never reaches the rows already in
  // the table leaves years of discharges misfiled.
  const mappedDepts = Object.keys(DEPT_TO_SERVICE_LINE);
  const { rows: misfiled } = await pool.query<{ dept: string; sl: string; n: string }>(
    `SELECT dept, service_line AS sl, COUNT(*)::text AS n
       FROM move_in_out_events
      WHERE client_id = $1
        AND upper(trim(dept)) = ANY($2)
        AND service_line IS DISTINCT FROM
            (SELECT sl FROM unnest($2::text[], $3::text[]) AS m(d, sl)
              WHERE m.d = upper(trim(dept)))
      GROUP BY 1, 2`,
    [clientId, mappedDepts, mappedDepts.map((d) => DEPT_TO_SERVICE_LINE[d])],
  );
  ok(
    "every stored event agrees with the department mapping",
    misfiled.length === 0,
    misfiled
      .map((r) => `${r.dept} stored as ${r.sl} (${r.n} rows)`)
      .join("; ") || undefined,
  );

  // A line occupancy history carries but the event feed never names is the
  // shape of this bug. Report it against every line, not just HC/MC, because
  // the next vocabulary gap will arrive in a line nobody is watching.
  const starved = result.byServiceLine.filter((r) => r.moveOuts === 0);
  ok(
    "no service line has occupancy to divide by and no move-outs to divide",
    starved.length === 0,
    `${starved.map((r) => r.serviceLine).join(", ")} report 0 move-outs against real occupancy — ` +
      "their discharges are most likely filed under another line",
  );

  const hcmc = result.byServiceLine.find((r) => r.serviceLine === "HC/MC");
  const { rows: hcmcOccRows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM room_type_occupancy_history
      WHERE client_id = $1 AND service_line = 'HC/MC' AND occ_units > 0`,
    [clientId],
  );
  if (Number(hcmcOccRows[0].n) > 0) {
    ok(
      "memory care in the Health Center reports a measured turnover, not a zero",
      !!hcmc && hcmc.moveOuts > 0 && hcmc.turnoverPct > 0,
      `HC/MC: ${hcmc?.moveOuts ?? "no line"} move-outs, ${hcmc?.turnoverPct ?? "-"}%`,
    );

    // Splitting a line out only helps if it is a split and not a copy. The
    // same discharge counted in both HC and HC/MC would inflate the Health
    // Center on top of the memory-care line it was supposed to leave.
    const hc = result.byServiceLine.find((r) => r.serviceLine === "HC");
    if (hc && hcmc && hc.monthsCovered === 12 && hcmc.monthsCovered === 12) {
      const { rows: familyRows } = await pool.query<{ sl: string; n: string }>(
        `SELECT service_line AS sl, COUNT(*)::text AS n
           FROM move_in_out_events
          WHERE client_id = $1
            AND event_type = 'move_out'
            AND counted = true
            AND service_line IN ('HC', 'HC/MC')
            AND substring(event_date, 1, 7) BETWEEN $2 AND $3
            AND ${privatePaySql("payer")}
          GROUP BY 1`,
        [clientId, result.windowStart, result.windowEnd],
      );
      const family = Object.fromEntries(familyRows.map((r) => [r.sl, Number(r.n)]));
      ok(
        "the Health Center and its memory-care line partition the same discharges",
        hc.moveOuts + hcmc.moveOuts === (family.HC ?? 0) + (family["HC/MC"] ?? 0),
        `reported ${hc.moveOuts}+${hcmc.moveOuts} vs feed ${family.HC ?? 0}+${family["HC/MC"] ?? 0}`,
      );
      ok(
        "no memory-care discharge is left behind in the Health Center",
        hcmc.moveOuts === (family["HC/MC"] ?? 0) && hc.moveOuts === (family.HC ?? 0),
        `HC/MC ${hcmc.moveOuts} vs ${family["HC/MC"] ?? 0}, HC ${hc.moveOuts} vs ${family.HC ?? 0}`,
      );
    }
  } else {
    console.log("  (this client has no HC/MC occupancy — memory-care split not exercised)");
  }

  // ── Campus scope narrows both sides together ──────────────────────────────

  const { rows: campusRows } = await pool.query<{ id: string; name: string }>(
    `SELECT l.id, l.name
       FROM locations l
       JOIN move_in_out_events e ON e.location = l.name AND e.client_id = l.client_id
      WHERE l.client_id = $1 AND e.event_type = 'move_out' AND e.counted = true
      GROUP BY l.id, l.name
      ORDER BY COUNT(*) DESC
      LIMIT 1`,
    [clientId],
  );
  if (campusRows[0]) {
    const { id, name } = campusRows[0];
    const scoped = await computeHistoricalTurnover(clientId, id, name);
    ok(`a single campus (${name}) still produces a result`, scoped !== null);
    if (scoped) {
      const scopedMoveOuts = scoped.byServiceLine.reduce((s, r) => s + r.moveOuts, 0);
      const scopedUnits = scoped.byServiceLine.reduce((s, r) => s + r.avgOccupiedUnits, 0);
      const portfolioUnits = result.byServiceLine.reduce((s, r) => s + r.avgOccupiedUnits, 0);
      ok(
        "one campus has fewer move-outs than the whole portfolio",
        scopedMoveOuts < summedMoveOuts,
        `campus ${scopedMoveOuts} vs portfolio ${summedMoveOuts}`,
      );
      // The real trap: scoping events by campus name while the occupancy
      // denominator stays portfolio-wide. That reads as a collapse in
      // turnover rather than as a scoping bug.
      ok(
        "the occupancy denominator narrows with the campus, not just the events",
        scopedUnits < portfolioUnits,
        `campus units ${scopedUnits} vs portfolio ${portfolioUnits} — denominator did not scope`,
      );
    }
  }

  // ── A client with no event history must not fabricate one ─────────────────

  const missing = await computeHistoricalTurnover("__no_such_client__", null, null);
  ok(
    "an unknown client yields no measurement rather than zeroes",
    missing === null,
    "a fabricated 0% turnover would silently plan as if nobody ever leaves",
  );

  // ── The bands themselves ──────────────────────────────────────────────────

  console.log("\n── turnover bands ──");

  for (const [sl, band] of Object.entries(TURNOVER_BANDS)) {
    ok(
      `${sl}: the band is ordered and contains its own default`,
      band.min < band.typical && band.typical < band.max,
      `min ${band.min} / typical ${band.typical} / max ${band.max}`,
    );
    // The solver converts turnover into a daily survival probability, so a
    // band that reached past full replacement would hand it an input it can
    // only clamp — the plan would silently stop responding to the number.
    ok(
      `${sl}: the band stays inside what the projection can model`,
      band.min >= 0 && band.max <= MODEL_MAX_TURNOVER_PCT,
      `band ${band.min}-${band.max} exceeds the 0-${MODEL_MAX_TURNOVER_PCT}% model limit`,
    );
    ok(
      `${sl}: its own default passes its own band`,
      isTurnoverInBand(sl, defaultTurnoverFor(sl)),
      `default ${defaultTurnoverFor(sl)} is outside ${band.min}-${band.max}`,
    );
    ok(
      `${sl}: a value inside the band draws no warning`,
      explainTurnoverOutOfBand(sl, band.typical) === null,
      "the typical value was flagged",
    );
    ok(
      `${sl}: both edges of the band are inclusive`,
      isTurnoverInBand(sl, band.min) && isTurnoverInBand(sl, band.max),
      "an edge value was rejected",
    );
    ok(
      `${sl}: a value under the floor is called out as too slow`,
      (explainTurnoverOutOfBand(sl, band.min - 0.1) ?? "").includes("longer stay"),
      "no floor warning",
    );
  }

  // Care levels must not be interchangeable: if independent living and skilled
  // nursing shared a band we would be back to the single ceiling this replaced.
  ok(
    "the slowest line's ceiling sits below the fastest line's floor",
    TURNOVER_BANDS.VIL.max < TURNOVER_BANDS.HC.min,
    `VIL max ${TURNOVER_BANDS.VIL.max} vs HC min ${TURNOVER_BANDS.HC.min}`,
  );
  ok(
    "acuity orders the defaults — villas turn over slowest, the health center fastest",
    defaultTurnoverFor("VIL") < defaultTurnoverFor("SL") &&
      defaultTurnoverFor("SL") < defaultTurnoverFor("AL") &&
      defaultTurnoverFor("AL") < defaultTurnoverFor("AL/MC") &&
      defaultTurnoverFor("AL/MC") < defaultTurnoverFor("HC"),
    "the per-line defaults are not ordered by care level",
  );
  ok(
    "an unrecognised service line still gets a usable band rather than throwing",
    isTurnoverInBand("NOT_A_LINE", 35) && !isTurnoverInBand("NOT_A_LINE", 250),
    "the fallback band misbehaved",
  );
  ok(
    "service lines resolve regardless of case or stray whitespace",
    turnoverBandFor(" al/mc ").max === TURNOVER_BANDS["AL/MC"].max,
    "a lowercase service line silently fell through to the fallback band",
  );
}

main()
  .catch((err) => {
    console.error(err);
    failed++;
  })
  .finally(async () => {
    await pool.end();
    console.log("\n=== Summary ===");
    console.log(`${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  });
