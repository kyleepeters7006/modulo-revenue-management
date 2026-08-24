/**
 * Regression coverage for the two overlapping move-in/out imports.
 *
 * The event feed for this client is two workbook formats describing the SAME
 * admissions and discharges:
 *
 *   legacy  Admissions/Discharges sheets — departments 01-HCC, 02-AL, 03-VIL, 24-A/I
 *   export  single "Export" sheet       — departments HC, AL, VIL, SL, IL, HC Legacy, AL Legacy
 *
 * Each mints its own synthetic census id, so the upsert's ON CONFLICT never
 * recognised the pair and both copies survived. Every absolute count over the
 * overlap read roughly double — and the overlap is precisely the trailing
 * twelve months measured turnover uses (Health Center read ~541%) and the
 * three months T3 move-ins/month uses, which scales every rule's projected
 * revenue impact.
 *
 * What makes this worth pinning rather than fixing once: nothing errors when
 * it regresses. Both copies are real, well-formed rows, and a doubled turnover
 * or a doubled move-in rate is still a plausible-looking number. So the tests
 * below assert the INVARIANT (one format owns a campus-month) and the
 * CONSEQUENCE (the numbers the two consumers read come from the deduped view),
 * not any particular count that a re-import would invalidate.
 *
 * Scopes and clients are DISCOVERED, so the suite keeps testing something
 * after the next upload.
 *
 * Run with: npx tsx tests/moveInOutImportDedupe.test.ts
 */
import { pool } from "../server/db";
import { privatePaySql } from "../shared/payerScope";
import {
  EVENT_IMPORT_FORMAT_EXPORT,
  EVENT_IMPORT_FORMAT_LEGACY,
  EXPORT_CENSUS_ID_PREFIX,
  MOVE_IN_OUT_ACTIVE_VIEW,
  PREFERRED_EVENT_IMPORT_FORMAT,
  backfillEventImportFormats,
  ensureMoveInOutActiveView,
  importFormatForCensusId,
  resolveOverlappingEventImports,
} from "../server/services/moveInOutEventsView";
import {
  getT3MoveInsMapFromEvents,
  resolveStoredEventImportOverlap,
} from "../server/services/moveInOutService";
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

async function count(sql: string, params: any[] = []): Promise<number> {
  const { rows } = await pool.query(sql, params);
  return Number(rows[0]?.n ?? 0);
}

/** The client with the most events — i.e. the real data set. */
async function largestEventClient(): Promise<string | null> {
  const res = await pool.query<{ client_id: string }>(
    `SELECT client_id FROM move_in_out_events GROUP BY client_id ORDER BY COUNT(*) DESC LIMIT 1`,
  );
  return res.rows[0]?.client_id ?? null;
}

// ── The format helper, which the importer and the backfill both depend on ────

function unitTests() {
  ok(
    "an export-format census id is recognised by its prefix",
    importFormatForCensusId(`${EXPORT_CENSUS_ID_PREFIX}2026-05-04|Anderson - 112|127/A|King|Discharge`) ===
      EVENT_IMPORT_FORMAT_EXPORT,
  );
  ok(
    "a legacy census id — a bare source-system number — is not mistaken for an export id",
    importFormatForCensusId("1643212") === EVENT_IMPORT_FORMAT_LEGACY,
  );
  ok(
    "the preferred format is the newer export feed",
    PREFERRED_EVENT_IMPORT_FORMAT === EVENT_IMPORT_FORMAT_EXPORT,
    "the legacy format folds SL, IL and the memory-care neighbourhoods into their parent buildings",
  );
}

// ── The migration path, against a table that predates the change ────────────
//
// The database this suite runs against already has the new columns, so nothing
// above it would notice if the startup migration were dropped — and the only
// databases that carry the duplicate events this feature exists to remove are
// exactly the ones that predate the columns. So build a pre-change table in a
// scratch schema, point the migration at it, and watch it migrate.

const MIGRATION_SCHEMA = "move_in_out_migration_check";

/** The table as it stood before this change: no import_format, no superseded. */
const PRE_CHANGE_TABLE = `
CREATE TABLE move_in_out_events (
  id             varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      varchar NOT NULL,
  event_type     text    NOT NULL,
  census_id      text    NOT NULL,
  patient_id     text,
  division       text,
  location       text    NOT NULL,
  dept           text,
  service_line   text,
  room_type      text,
  bed_type       text,
  room_name      text,
  payer          text,
  event_date     text    NOT NULL,
  event_category text,
  is_return      boolean DEFAULT false,
  counted        boolean NOT NULL DEFAULT false,
  created_at     timestamp DEFAULT now()
)`;

async function migrationPathTests() {
  const client = await pool.connect();
  const exec = async (s: string) => {
    await client.query(s);
  };
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${MIGRATION_SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${MIGRATION_SCHEMA}`);
    // Session-scoped, so every unqualified `move_in_out_events` below — including
    // the ones inside the migration and resolution helpers — hits the scratch copy.
    await client.query(`SET search_path TO ${MIGRATION_SCHEMA}`);
    await client.query(PRE_CHANGE_TABLE);

    // One campus-month reported by both formats, and one the older format alone
    // reported — the case a global "newer format wins" rule would erase.
    const rows: Array<[string, string, string, string]> = [
      // census_id, location, event_date, event_type
      ["990001", "Springfield - 101", "2026-05-04", "move_out"],
      ["990002", "Springfield - 101", "2026-05-11", "move_out"],
      [`${EXPORT_CENSUS_ID_PREFIX}2026-05-04|Springfield - 101|12/A`, "Springfield - 101", "2026-05-04", "move_out"],
      [`${EXPORT_CENSUS_ID_PREFIX}2026-05-11|Springfield - 101|12/B`, "Springfield - 101", "2026-05-11", "move_out"],
      ["990003", "Rivergate - 202", "2026-05-04", "move_out"],
    ];
    for (const [censusId, location, date, type] of rows) {
      await client.query(
        `INSERT INTO move_in_out_events
           (client_id, event_type, census_id, location, event_date, counted)
         VALUES ('mig', $1, $2, $3, $4, true)`,
        [type, censusId, location, date],
      );
    }

    await ensureMoveInOutActiveView(exec);
    ok("the migration adds its columns to a table that predates them", true);

    const stamped = await backfillEventImportFormats(client, "mig");
    ok(
      "rows imported before the column existed are stamped with their real format",
      stamped === 2,
      `expected the 2 legacy-defaulted export rows to be corrected, got ${stamped}`,
    );

    const changed = await resolveOverlappingEventImports(client, "mig");
    ok("the duplicate copies are set aside", changed === 2, `${changed} row(s) flagged, expected 2`);

    const active = await client.query<{ census_id: string }>(
      `SELECT census_id FROM ${MOVE_IN_OUT_ACTIVE_VIEW} WHERE client_id = 'mig' ORDER BY census_id`,
    );
    const survivors = active.rows.map((r) => r.census_id);
    ok(
      "the shared campus-month is counted once, by the preferred format",
      survivors.filter((c) => c.startsWith(EXPORT_CENSUS_ID_PREFIX)).length === 2 &&
        !survivors.includes("990001") && !survivors.includes("990002"),
      survivors.join(", "),
    );
    ok(
      "the campus-month only the older format reported still counts",
      survivors.includes("990003"),
      `Rivergate's move-out disappeared: ${survivors.join(", ")}`,
    );

    // The importer names import_format in its INSERT column list — on an
    // unmigrated table that is a hard error, not a degraded count.
    await client.query(
      `INSERT INTO move_in_out_events
         (client_id, event_type, census_id, location, event_date, counted, import_format)
       VALUES ('mig', 'move_out', 'exp|new', 'Rivergate - 202', '2026-05-20', true, $1)`,
      [EVENT_IMPORT_FORMAT_EXPORT],
    );
    ok("an import can write the new column straight after the migration", true);

    // A second import into a campus-month re-decides the overlap immediately,
    // rather than leaving it doubled until the next boot.
    const reResolved = await resolveOverlappingEventImports(client, "mig");
    ok(
      "a later arrival of the preferred format supersedes the older copy",
      reResolved === 1,
      `${reResolved} row(s) re-owned, expected Rivergate's legacy move-out to yield`,
    );
    ok(
      "resolution settles — running it again changes nothing",
      (await resolveOverlappingEventImports(client, "mig")) === 0,
    );

    // Re-running the whole migration must be safe: boot does it every time.
    await ensureMoveInOutActiveView(exec);
    const afterRerun = await client.query(
      `SELECT COUNT(*)::int AS n FROM ${MOVE_IN_OUT_ACTIVE_VIEW} WHERE client_id = 'mig'`,
    );
    ok(
      "re-running the migration preserves the resolution",
      Number(afterRerun.rows[0].n) === 3,
      `${afterRerun.rows[0].n} active row(s), expected 3`,
    );
  } finally {
    await client.query(`SET search_path TO public`).catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${MIGRATION_SCHEMA} CASCADE`).catch(() => {});
    client.release();
  }
}

async function main() {
  unitTests();

  console.log("\n── migrating a table that predates the change ──");
  await migrationPathTests();

  // The live database is migrated at boot; do it here too so the suite is
  // runnable without starting the server.
  await ensureMoveInOutActiveView(async (s) => {
    await pool.query(s);
  });


  const clientId = await largestEventClient();
  if (!clientId) {
    console.log("No move-in/out events in the database — nothing further to verify.");
    return;
  }
  console.log(`\n── checking import overlap for client "${clientId}" ──`);

  // ── The stored resolution is current and settled ──────────────────────────

  const secondRun = await resolveStoredEventImportOverlap();
  ok(
    "re-resolving stored rows changes nothing — the table is already settled",
    secondRun.formatsStamped === 0 && secondRun.supersededChanged === 0,
    `stamped ${secondRun.formatsStamped}, re-owned ${secondRun.supersededChanged} — either the boot migration never ran, or the resolution is not idempotent`,
  );
  const thirdRun = await resolveOverlappingEventImports(pool, clientId);
  ok(
    "resolving one client is idempotent too",
    thirdRun === 0,
    `${thirdRun} row(s) changed on a repeat run`,
  );

  const wrongFormat = await count(
    `SELECT COUNT(*)::int AS n FROM move_in_out_events
      WHERE import_format IS DISTINCT FROM
            (CASE WHEN census_id LIKE '${EXPORT_CENSUS_ID_PREFIX}%'
                  THEN '${EVENT_IMPORT_FORMAT_EXPORT}' ELSE '${EVENT_IMPORT_FORMAT_LEGACY}' END)`,
  );
  ok(
    "every stored row carries the import format its census id implies",
    wrongFormat === 0,
    `${wrongFormat} row(s) mis-stamped`,
  );

  // ── The invariant: one vocabulary owns a campus-month ─────────────────────
  //
  // Stated per CAMPUS-month, not per month. A month legitimately holds both
  // formats across the portfolio: 80-odd campus-months exist only in the
  // legacy feed, and those rows must survive.

  const collisions = await pool.query<{
    location: string; event_type: string; mm: string; formats: string; rows: string;
  }>(
    `SELECT location, event_type, substring(event_date, 1, 7) AS mm,
            string_agg(DISTINCT import_format, ',') AS formats,
            COUNT(*)::text AS rows
       FROM ${MOVE_IN_OUT_ACTIVE_VIEW}
      WHERE client_id = $1
      GROUP BY 1, 2, 3
     HAVING COUNT(DISTINCT import_format) > 1
      ORDER BY 3 DESC
      LIMIT 5`,
    [clientId],
  );
  ok(
    "no campus-month has two department vocabularies reporting the same events",
    collisions.rowCount === 0,
    collisions.rows
      .map((r) => `${r.location} ${r.mm} ${r.event_type}: ${r.formats} (${r.rows} rows)`)
      .join("; "),
  );

  // ── Deduping must not silently delete coverage ────────────────────────────

  const orphanedCampusMonths = await count(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT location, event_type, substring(event_date, 1, 7) AS mm
         FROM move_in_out_events WHERE client_id = $1
       EXCEPT
       SELECT location, event_type, substring(event_date, 1, 7) AS mm
         FROM ${MOVE_IN_OUT_ACTIVE_VIEW} WHERE client_id = $1) q`,
    [clientId],
  );
  ok(
    "every campus-month that reported events still reports them",
    orphanedCampusMonths === 0,
    `${orphanedCampusMonths} campus-month(s) lost every row — the losing format was dropped where it was the only source`,
  );

  const unjustifiedlySuperseded = await count(
    `SELECT COUNT(*)::int AS n
       FROM move_in_out_events e
      WHERE e.client_id = $1 AND e.superseded
        AND NOT EXISTS (
          SELECT 1 FROM move_in_out_events x
           WHERE x.client_id = e.client_id AND x.location = e.location
             AND x.event_type = e.event_type
             AND substring(x.event_date, 1, 7) = substring(e.event_date, 1, 7)
             AND x.import_format = $2)`,
    [clientId, PREFERRED_EVENT_IMPORT_FORMAT],
  );
  ok(
    "a row is only set aside when the preferred format actually covers its campus-month",
    unjustifiedlySuperseded === 0,
    `${unjustifiedlySuperseded} row(s) hidden with nothing standing in for them`,
  );

  const survivingPreferred = await count(
    `SELECT COUNT(*)::int AS n FROM move_in_out_events
      WHERE client_id = $1 AND superseded AND import_format = $2`,
    [clientId, PREFERRED_EVENT_IMPORT_FORMAT],
  );
  ok(
    "the preferred format is never the one set aside",
    survivingPreferred === 0,
    `${survivingPreferred} export-format row(s) were hidden`,
  );

  // ── The consumers read the deduped feed ───────────────────────────────────

  const overlapDupes = await count(
    `SELECT COUNT(*)::int AS n FROM move_in_out_events
      WHERE client_id = $1 AND superseded AND counted`,
    [clientId],
  );
  if (overlapDupes === 0) {
    console.log("  (this client has no overlapping imports — consumer checks are trivially satisfied)");
  }

  const turnover = await computeHistoricalTurnover(clientId, null, null);
  ok("measured turnover still produces a result", turnover !== null);
  if (turnover) {
    const [activeMoveOuts, rawMoveOuts] = await Promise.all([
      count(
        `SELECT COUNT(*)::int AS n FROM ${MOVE_IN_OUT_ACTIVE_VIEW}
          WHERE client_id = $1 AND event_type = 'move_out' AND counted
            AND substring(event_date, 1, 7) BETWEEN $2 AND $3
            AND ${privatePaySql("payer")}`,
        [clientId, turnover.windowStart, turnover.windowEnd],
      ),
      count(
        `SELECT COUNT(*)::int AS n FROM move_in_out_events
          WHERE client_id = $1 AND event_type = 'move_out' AND counted
            AND substring(event_date, 1, 7) BETWEEN $2 AND $3
            AND ${privatePaySql("payer")}`,
        [clientId, turnover.windowStart, turnover.windowEnd],
      ),
    ]);
    const reported = turnover.byServiceLine.reduce((s, r) => s + r.moveOuts, 0);
    ok(
      "turnover counts no more move-outs than the deduped feed contains",
      reported <= activeMoveOuts,
      `lines total ${reported} against ${activeMoveOuts} deduped private-pay move-outs`,
    );
    if (overlapDupes > 0) {
      ok(
        "turnover is measured against the deduped feed, not the doubled table",
        reported <= activeMoveOuts && activeMoveOuts < rawMoveOuts,
        `deduped ${activeMoveOuts} vs raw ${rawMoveOuts}; turnover counted ${reported}`,
      );
    }
  }

  // T3 move-ins/month: the figure every rule's projected revenue impact scales
  // with. Compared against the same three months the map was built from.
  const t3Rows = await pool.query<{ m: string }>(
    `SELECT DISTINCT upload_month AS m FROM rent_roll_data
      WHERE client_id = $1 AND upload_month IS NOT NULL
      ORDER BY upload_month DESC LIMIT 3`,
    [clientId],
  );
  const t3Months = t3Rows.rows.map((r) => r.m).filter(Boolean);
  if (t3Months.length > 0) {
    const t3Map = await getT3MoveInsMapFromEvents(clientId, t3Months);
    const mapTotal = Array.from(t3Map.values()).reduce((s, v) => s + v, 0);
    const [activeMoveIns, rawMoveIns] = await Promise.all([
      count(
        `SELECT COUNT(*)::int AS n FROM ${MOVE_IN_OUT_ACTIVE_VIEW}
          WHERE client_id = $1 AND event_type = 'move_in' AND counted
            AND substring(event_date, 1, 7) = ANY($2)
            AND (CASE WHEN service_line IN ('HC','HC/MC') THEN ${privatePaySql("payer")} ELSE TRUE END)`,
        [clientId, t3Months],
      ),
      count(
        `SELECT COUNT(*)::int AS n FROM move_in_out_events
          WHERE client_id = $1 AND event_type = 'move_in' AND counted
            AND substring(event_date, 1, 7) = ANY($2)
            AND (CASE WHEN service_line IN ('HC','HC/MC') THEN ${privatePaySql("payer")} ELSE TRUE END)`,
        [clientId, t3Months],
      ),
    ]);
    ok(
      "T3 move-ins per month are the deduped events averaged over the same months",
      Math.abs(mapTotal - activeMoveIns / t3Months.length) < 0.01,
      `map totals ${mapTotal.toFixed(2)}/mo against ${activeMoveIns}/${t3Months.length} = ${(activeMoveIns / t3Months.length).toFixed(2)}`,
    );
    const t3HasDupes = rawMoveIns > activeMoveIns;
    if (t3HasDupes) {
      ok(
        "T3 move-ins are single-counted, so rule impacts are not scaled by a duplicate import",
        mapTotal < rawMoveIns / t3Months.length,
        `map ${mapTotal.toFixed(2)}/mo vs doubled ${(rawMoveIns / t3Months.length).toFixed(2)}/mo`,
      );
    }
  }
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
