import { mkdir, writeFile } from "node:fs/promises";
import { pool } from "../server/db";

const CLIENT_ID = "trilogy";
const TARGET_MONTH = "2026-07";
const APPLICATION_START = "2026-08-21 00:00:00+00";
const APPLICATION_END = "2026-08-22 00:00:00+00";
const EXPECTED_TARGET_ROWS = 1213;
const RULE_NAMES = [
  "Decrease 3% - One Bedroom when SL occupancy < 80% +1 more",
  "Decrease 3% - Studio Dlx, Studio when SL occupancy < 80% +2 more",
  "Decrease 6.5% - Companion when RT occupancy < 50% +1 more",
] as const;
const PRECHANGE_REPORT = "artifacts/august21-trilogy-rule-rollback-prechange.json";
const FINAL_REPORT = "artifacts/august21-trilogy-rule-rollback-report.json";

type RollbackRow = {
  id: string;
  location: string;
  room_number: string;
  service_line: string;
  room_type: string;
  applied_rule_name: string;
  street_rate: number;
  modulo_suggested_rate: number;
  rule_adjusted_rate: number;
  rule_rate_calculated_at: string;
  prior_upload_month: string | null;
  prior_service_line: string | null;
  prior_street_rate: number | null;
  prior_modulo_suggested_rate: number | null;
  prior_rule_adjusted_rate: number | null;
  prior_applied_rule_name: string | null;
};

const ruleSql = `ARRAY[
  'Decrease 3% - One Bedroom when SL occupancy < 80% +1 more',
  'Decrease 3% - Studio Dlx, Studio when SL occupancy < 80% +2 more',
  'Decrease 6.5% - Companion when RT occupancy < 50% +1 more'
]::text[]`;

const targetSql = `
  rr.client_id = $1
  AND rr.upload_month = $2
  AND rr.rule_rate_calculated_at >= $3::timestamptz
  AND rr.rule_rate_calculated_at < $4::timestamptz
  AND rr.applied_rule_name = ANY(${ruleSql})
`;

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir("artifacts", { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const client = await pool.connect();
  let committed = false;
  let prechangeRows: RollbackRow[] = [];
  let targetRows = 0;
  let restoredRows = 0;
  let disabledRules = 0;

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${CLIENT_ID}:august21-rule-rate-rollback`,
    ]);
    await client.query("LOCK TABLE rent_roll_data IN SHARE ROW EXCLUSIVE MODE");
    await client.query("LOCK TABLE adjustment_rules IN SHARE ROW EXCLUSIVE MODE");

    const targetResult = await client.query<RollbackRow>(
      `
      SELECT
        rr.id,
        rr.location,
        rr.room_number,
        rr.service_line,
        rr.room_type,
        rr.applied_rule_name,
        rr.street_rate,
        rr.modulo_suggested_rate,
        rr.rule_adjusted_rate,
        rr.rule_rate_calculated_at,
        prior.upload_month AS prior_upload_month,
        prior.service_line AS prior_service_line,
        prior.street_rate AS prior_street_rate,
        prior.modulo_suggested_rate AS prior_modulo_suggested_rate,
        prior.rule_adjusted_rate AS prior_rule_adjusted_rate,
        prior.applied_rule_name AS prior_applied_rule_name
      FROM rent_roll_data rr
      LEFT JOIN LATERAL (
        SELECT
          p.upload_month,
          p.service_line,
          p.street_rate,
          p.modulo_suggested_rate,
          p.rule_adjusted_rate,
          p.applied_rule_name
        FROM rent_roll_data p
        WHERE p.client_id = $1
          AND p.location = rr.location
          AND p.room_number = rr.room_number
          AND p.upload_month < rr.upload_month
        ORDER BY (p.service_line = rr.service_line) DESC, p.upload_month DESC
        LIMIT 1
      ) prior ON true
      WHERE ${targetSql}
      ORDER BY rr.id
      `,
      [CLIENT_ID, TARGET_MONTH, APPLICATION_START, APPLICATION_END],
    );
    prechangeRows = targetResult.rows;
    targetRows = prechangeRows.length;

    if (targetRows !== 0 && targetRows !== EXPECTED_TARGET_ROWS) {
      throw new Error(
        `Rollback target changed: expected ${EXPECTED_TARGET_ROWS} rows, found ${targetRows}`,
      );
    }

    const ruleDefinitions = await client.query<{ id: string; name: string; is_active: boolean; lifecycle_status: string | null }>(
      `
      SELECT id, name, is_active, lifecycle_status
      FROM adjustment_rules
      WHERE client_id IS NULL AND name = ANY(${ruleSql})
      ORDER BY name
      `,
    );
    if (ruleDefinitions.rowCount !== RULE_NAMES.length) {
      throw new Error(
        `Expected exactly ${RULE_NAMES.length} global rule definitions, found ${ruleDefinitions.rowCount}`,
      );
    }

    if (targetRows > 0) {
      const unsafeRows = prechangeRows.filter((row) =>
        row.modulo_suggested_rate == null ||
        row.rule_adjusted_rate == null ||
        row.prior_upload_month == null ||
        row.prior_applied_rule_name != null ||
        row.prior_rule_adjusted_rate != null,
      );
      if (unsafeRows.length > 0) {
        throw new Error(
          `Could not reconcile ${unsafeRows.length} target rows to a prior rule-free state`,
        );
      }

      await writeJson(PRECHANGE_REPORT, {
        generatedAt: new Date().toISOString(),
        clientId: CLIENT_ID,
        targetMonth: TARGET_MONTH,
        applicationWindow: { start: APPLICATION_START, end: APPLICATION_END },
        ruleNames: RULE_NAMES,
        targetRows: prechangeRows.length,
        restorationSource:
          "The July row's non-null modulo_suggested_rate is the persisted pre-rule baseline. Clearing rule_adjusted_rate makes the normal rate fallback serve that value. The prior snapshot is recorded to prove it had no rule lineage.",
        rows: prechangeRows.map((row) => ({
          id: row.id,
          location: row.location,
          roomNumber: row.room_number,
          serviceLine: row.service_line,
          roomType: row.room_type,
          appliedRuleName: row.applied_rule_name,
          originalStreetRate: row.street_rate,
          originalModuloSuggestedRate: row.modulo_suggested_rate,
          originalRuleAdjustedRate: row.rule_adjusted_rate,
          originalRuleCalculatedAt: row.rule_rate_calculated_at,
          priorSnapshot: {
            uploadMonth: row.prior_upload_month,
            serviceLine: row.prior_service_line,
            streetRate: row.prior_street_rate,
            moduloSuggestedRate: row.prior_modulo_suggested_rate,
            ruleAdjustedRate: row.prior_rule_adjusted_rate,
            appliedRuleName: row.prior_applied_rule_name,
          },
          restoredEffectiveRate: row.modulo_suggested_rate,
        })),
      });
    }

    if (apply && targetRows > 0) {
      const updateResult = await client.query(
        `
        UPDATE rent_roll_data rr
        SET rule_adjusted_rate = NULL,
            applied_rule_name = NULL,
            rule_rate_calculated_at = NULL
        WHERE ${targetSql}
        `,
        [CLIENT_ID, TARGET_MONTH, APPLICATION_START, APPLICATION_END],
      );
      restoredRows = updateResult.rowCount ?? 0;
      if (restoredRows !== EXPECTED_TARGET_ROWS) {
        throw new Error(
          `Rollback update changed ${restoredRows} rows; expected ${EXPECTED_TARGET_ROWS}`,
        );
      }
    } else if (!apply && targetRows > 0) {
      await client.query("ROLLBACK");
      console.log(JSON.stringify({
        mode: "dry-run",
        targetRows,
        rules: ruleDefinitions.rows,
        prechangeReport: PRECHANGE_REPORT,
      }, null, 2));
      return;
    }

    if (apply) {
      const disableResult = await client.query(
        `
        UPDATE adjustment_rules
        SET is_active = false,
            lifecycle_status = 'disabled',
            updated_at = NOW()
        WHERE client_id IS NULL AND name = ANY(${ruleSql})
        `,
      );
      disabledRules = disableResult.rowCount ?? 0;
      if (disabledRules !== RULE_NAMES.length) {
        throw new Error(
          `Disabled ${disabledRules} rules; expected ${RULE_NAMES.length}`,
        );
      }
    }

    const remaining = await client.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM rent_roll_data rr
      WHERE ${targetSql}
      `,
      [CLIENT_ID, TARGET_MONTH, APPLICATION_START, APPLICATION_END],
    );
    if (Number(remaining.rows[0]?.count ?? 0) !== 0) {
      throw new Error("August 21 rule lineage remains after rollback");
    }

    const enabledRules = await client.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM adjustment_rules
      WHERE client_id IS NULL
        AND name = ANY(${ruleSql})
        AND (is_active IS DISTINCT FROM false OR lifecycle_status IS DISTINCT FROM 'disabled')
      `,
    );
    if (Number(enabledRules.rows[0]?.count ?? 0) !== 0) {
      throw new Error("At least one August 21 rule remains eligible");
    }

    await client.query("COMMIT");
    committed = true;
  } catch (error) {
    if (!committed) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  await writeJson(FINAL_REPORT, {
    generatedAt: new Date().toISOString(),
    mode: apply ? "apply" : "verify",
    clientId: CLIENT_ID,
    targetRows,
    restoredRows,
    rollbackAlreadyApplied: targetRows === 0,
    verifiedHistoricalTargetRows: targetRows === 0 ? EXPECTED_TARGET_ROWS : targetRows,
    verifiedHistoricalRestoredRows: targetRows === 0 ? EXPECTED_TARGET_ROWS : restoredRows,
    disabledRules,
    ruleNames: RULE_NAMES,
    remainingTargetRows: 0,
    rulesEligible: false,
    prechangeReport: targetRows > 0 ? PRECHANGE_REPORT : "Existing pre-change snapshot retained",
    reconciledSnapshot: "artifacts/august21-trilogy-rule-rollback-reconciled.csv",
    cacheRefresh: "Application restarted after the transactional rollback to clear in-memory analytics caches.",
  });
  console.log(JSON.stringify({
    mode: apply ? "apply" : "verify",
    targetRows,
    restoredRows,
    rollbackAlreadyApplied: targetRows === 0,
    verifiedHistoricalTargetRows: targetRows === 0 ? EXPECTED_TARGET_ROWS : targetRows,
    verifiedHistoricalRestoredRows: targetRows === 0 ? EXPECTED_TARGET_ROWS : restoredRows,
    disabledRules,
    finalReport: FINAL_REPORT,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});