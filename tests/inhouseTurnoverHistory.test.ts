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
 * Scopes are DISCOVERED, so the suite keeps testing something after a
 * re-import rather than pinning values that a new upload invalidates.
 *
 * Run with: npx tsx tests/inhouseTurnoverHistory.test.ts
 */
import { pool } from "../server/db";
import { privatePaySql } from "../shared/payerScope";
import { computeHistoricalTurnover } from "../server/services/inhouseRatePlanning/historicalTurnover";

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

  // ── Payer scope actually bites ────────────────────────────────────────────

  const { rows: payerRows } = await pool.query<{ all_payer: string; private_pay: string }>(
    `SELECT COUNT(*)::text AS all_payer,
            COUNT(*) FILTER (WHERE ${privatePaySql("payer")})::text AS private_pay
       FROM move_in_out_events
      WHERE client_id = $1
        AND event_type = 'move_out'
        AND counted = true
        AND substring(event_date, 1, 7) BETWEEN $2 AND $3`,
    [clientId, result.windowStart, result.windowEnd],
  );
  const allPayer = Number(payerRows[0].all_payer);
  const privatePay = Number(payerRows[0].private_pay);
  ok(
    "the payer scope excludes externally-priced move-outs",
    privatePay < allPayer,
    `private ${privatePay} vs all ${allPayer} — scope is not filtering`,
  );

  const summedMoveOuts = result.byServiceLine.reduce((s, r) => s + r.moveOuts, 0);
  ok(
    "no line counts a move-out we do not price",
    summedMoveOuts <= privatePay,
    `lines total ${summedMoveOuts} but only ${privatePay} private-pay move-outs exist`,
  );

  // ── Every line is internally consistent ───────────────────────────────────

  for (const line of result.byServiceLine) {
    const recomputed = (line.moveOuts / line.avgOccupiedUnits) * 100;
    ok(
      `${line.serviceLine}: the reported percent is its own move-outs over its own units`,
      Math.abs(recomputed - line.turnoverPct) < 0.6,
      `${line.moveOuts}/${line.avgOccupiedUnits} = ${recomputed.toFixed(1)}% but reported ${line.turnoverPct}%`,
    );
    ok(
      `${line.serviceLine}: the denominator is the private-pay share, not the whole census`,
      line.privatePaySharePct > 0 && line.privatePaySharePct <= 100,
      `share ${line.privatePaySharePct}%`,
    );
    ok(
      `${line.serviceLine}: plausibility agrees with the value it flags`,
      line.plausible ===
        (line.turnoverPct > 0 && line.turnoverPct <= 100 && line.monthsCovered >= 6),
      `${line.turnoverPct}% over ${line.monthsCovered}mo flagged plausible=${line.plausible}`,
    );
    ok(
      `${line.serviceLine}: coverage is a real month count inside the window`,
      line.monthsCovered > 0 && line.monthsCovered <= 12,
      `monthsCovered ${line.monthsCovered}`,
    );
  }

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
