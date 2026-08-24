/**
 * Which copy of a move-in/out event is the one we count.
 *
 * ── The problem this exists to solve ───────────────────────────────────────
 * The move-in/out feed for this client is not one import, it is two, running
 * over the same calendar:
 *
 *   legacy  Admissions/Discharges workbook — departments `01-HCC`, `02-AL`,
 *           `03-VIL`, `24-A/I`
 *   export  single-sheet "Export" workbook — departments `HC`, `AL`, `VIL`,
 *           `SL`, `IL`, `HC Legacy`, `AL Legacy`
 *
 * They describe the SAME admissions and the SAME discharges. Matched on
 * campus + date + room number, 98.7% of the export rows in the overlap window
 * have a legacy twin. But each format mints its own synthetic `census_id`, so
 * the `ON CONFLICT (client_id, event_type, census_id)` upsert has never seen
 * them as the same event and both copies survive.
 *
 * Every absolute count over the overlap therefore reads roughly double. That
 * overlap is exactly the trailing-twelve-month window measured turnover uses
 * (Health Center read ~541%) and it feeds T3 move-ins per month, which scales
 * every adjustment rule's projected revenue impact.
 *
 * ── Why a whole format wins a campus-month, rather than row-level matching ──
 * Room-number matching gets most rows but not all: legacy stores the room
 * (`101`) without the bed letter the export format carries (`101/A`), so two
 * residents discharged from the same companion room on one day are one key on
 * the legacy side. A residual few percent of unmatched rows is the worst
 * possible outcome — still double, but no longer visibly double.
 *
 * Picking one format per campus + month is exact. Both formats are complete
 * census feeds for a campus in a month, so keeping one keeps every event once.
 *
 * ── Why the export format wins ─────────────────────────────────────────────
 * It is the newer feed and it resolves strictly more of the portfolio:
 * skilled nursing (`SL`) and independent living (`IL`) are their own lines,
 * and the memory-care neighbourhood inside the Health Center (`HC Legacy`) is
 * the only place an HC/MC discharge is identifiable at all. The legacy format
 * folds all of those into `01-HCC` / `02-AL`. Where the two disagree on volume
 * they disagree by ~2%, which is not worth losing a service line over.
 *
 * Preference is per campus + month, NOT global: 83 campus-months in the
 * overlap window (386 counted move-outs) exist only in the legacy format, and
 * a global rule would silently drop them.
 */
import type { Pool } from "@neondatabase/serverless";

export const EVENT_IMPORT_FORMAT_LEGACY = "legacy";
export const EVENT_IMPORT_FORMAT_EXPORT = "export";

export type EventImportFormat =
  | typeof EVENT_IMPORT_FORMAT_LEGACY
  | typeof EVENT_IMPORT_FORMAT_EXPORT;

/**
 * The format that wins when both cover the same campus + month. See the file
 * header for why this is `export` and not a data-dependent "whichever has more
 * rows" rule — a deterministic preference is the only one a test can pin.
 */
export const PREFERRED_EVENT_IMPORT_FORMAT: EventImportFormat = EVENT_IMPORT_FORMAT_EXPORT;

/**
 * The prefix `importExportSheetFormat` stamps on every synthetic census id it
 * mints. It is the only thing that distinguishes an export-format row already
 * in the table, so the importer and the backfill must derive the format from
 * this one helper rather than each spelling the test out.
 */
export const EXPORT_CENSUS_ID_PREFIX = "exp|";

export function importFormatForCensusId(censusId: string): EventImportFormat {
  return censusId.startsWith(EXPORT_CENSUS_ID_PREFIX)
    ? EVENT_IMPORT_FORMAT_EXPORT
    : EVENT_IMPORT_FORMAT_LEGACY;
}

/**
 * Every read of move-in/out counts goes through this view.
 *
 * A view rather than a `AND NOT superseded` copied into each query, for the
 * same reason the rate baseline is a view: the next consumer of this table
 * will not know the duplicate imports exist, and the failure is silent — the
 * numbers stay plausible, they are just twice as big as reality.
 */
export const MOVE_IN_OUT_ACTIVE_VIEW = "move_in_out_events_active";

export const MOVE_IN_OUT_ACTIVE_VIEW_DDL = `
CREATE OR REPLACE VIEW ${MOVE_IN_OUT_ACTIVE_VIEW} AS
SELECT * FROM move_in_out_events WHERE NOT superseded
`;

/**
 * The two columns the view and the resolution are built on.
 *
 * Declaring them in `shared/schema.ts` only reaches a database someone runs
 * `db:push` against — it does not touch an already-deployed one. Without these
 * statements the deployment this change exists to fix is the deployment that
 * breaks: the view cannot be created (no `superseded`), so every reader errors,
 * and the importer's INSERT names a column (`import_format`) that is not there.
 *
 * The defaults are deliberately the pre-change behaviour — an unstamped row is
 * legacy and active — so the table is coherent between the ALTER and the first
 * `backfillEventImportFormats` / `resolveOverlappingEventImports` pass.
 */
export const MOVE_IN_OUT_COLUMN_DDL: readonly string[] = [
  `ALTER TABLE move_in_out_events
     ADD COLUMN IF NOT EXISTS import_format text NOT NULL DEFAULT '${EVENT_IMPORT_FORMAT_LEGACY}'`,
  `ALTER TABLE move_in_out_events
     ADD COLUMN IF NOT EXISTS superseded boolean NOT NULL DEFAULT false`,
  `CREATE INDEX IF NOT EXISTS miox_client_type_format_date_idx
     ON move_in_out_events (client_id, event_type, import_format, event_date)`,
];

/**
 * Add the columns the view depends on. Idempotent; safe on every boot.
 *
 * Kept separate from `shared/schema.ts` on purpose: schema.ts describes the
 * table for new databases, this runs against the existing one.
 */
export async function ensureMoveInOutEventColumns(
  exec: (sql: string) => Promise<unknown>,
): Promise<void> {
  for (const stmt of MOVE_IN_OUT_COLUMN_DDL) await exec(stmt);
}

/**
 * Create or update the view, columns first. Safe to call on every boot.
 *
 * The column migration is folded in here rather than left to the caller so the
 * ordering cannot be got wrong: the view's `WHERE NOT superseded` is a hard
 * dependency on the ALTER above it, and a boot sequence that ran them apart
 * would fail only on databases that predate the change — i.e. only in
 * production.
 *
 * `CREATE OR REPLACE VIEW` over `SELECT *` can only add columns at the end, so
 * a dropped or renamed column on the base table needs the view rebuilt. That
 * is a schema change, not a runtime condition, hence the explicit fallback
 * rather than letting boot fail.
 */
export async function ensureMoveInOutActiveView(
  exec: (sql: string) => Promise<unknown>,
): Promise<void> {
  await ensureMoveInOutEventColumns(exec);
  try {
    await exec(MOVE_IN_OUT_ACTIVE_VIEW_DDL);
  } catch {
    await exec(`DROP VIEW IF EXISTS ${MOVE_IN_OUT_ACTIVE_VIEW}`);
    await exec(MOVE_IN_OUT_ACTIVE_VIEW_DDL);
  }
}

type Queryable = Pick<Pool, "query">;

/**
 * Repair `import_format` on stored rows from the census-id convention.
 *
 * Rows imported before the column existed all carry the default. Idempotent.
 *
 * @returns the number of rows corrected.
 */
export async function backfillEventImportFormats(
  db: Queryable,
  clientId?: string,
): Promise<number> {
  const derived = `CASE WHEN census_id LIKE '${EXPORT_CENSUS_ID_PREFIX}%'
                        THEN '${EVENT_IMPORT_FORMAT_EXPORT}'
                        ELSE '${EVENT_IMPORT_FORMAT_LEGACY}' END`;
  const res = await db.query(
    `UPDATE move_in_out_events
        SET import_format = ${derived}
      WHERE ($1::text IS NULL OR client_id = $1)
        AND import_format IS DISTINCT FROM ${derived}`,
    [clientId ?? null],
  );
  return res.rowCount ?? 0;
}

/**
 * Recompute `superseded` across the table (or one client).
 *
 * A row is superseded when a DIFFERENT, preferred format also reports that
 * campus + event type + month. Everything else stays active, including every
 * row of a campus-month only one format ever covered.
 *
 * Idempotent by construction: it writes the full truth for every row it
 * touches and skips rows that already agree, so a second run changes nothing.
 * That matters because it runs after every import and on every boot.
 *
 * @returns the number of rows whose flag changed.
 */
export async function resolveOverlappingEventImports(
  db: Queryable,
  clientId?: string,
): Promise<number> {
  const res = await db.query(
    `WITH coverage AS (
       SELECT client_id, location, event_type,
              substring(event_date, 1, 7) AS mm,
              bool_or(import_format = $2) AS has_preferred
         FROM move_in_out_events
        WHERE ($1::text IS NULL OR client_id = $1)
        GROUP BY 1, 2, 3, 4
     )
     UPDATE move_in_out_events e
        SET superseded = (c.has_preferred AND e.import_format <> $2)
       FROM coverage c
      WHERE c.client_id = e.client_id
        AND c.location = e.location
        AND c.event_type = e.event_type
        AND c.mm = substring(e.event_date, 1, 7)
        AND ($1::text IS NULL OR e.client_id = $1)
        AND e.superseded IS DISTINCT FROM (c.has_preferred AND e.import_format <> $2)`,
    [clientId ?? null, PREFERRED_EVENT_IMPORT_FORMAT],
  );
  return res.rowCount ?? 0;
}
