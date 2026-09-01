/**
 * Reference Data audit workbook export regression test.
 *
 * This is intentionally an endpoint test: it verifies the same tenant boundary
 * and download headers that the Data Management button uses, then opens the
 * resulting XLSX and inspects formulas rather than trusting a static file.
 *
 * Run with:
 *   TEST_BASE_URL=https://<dev-domain> npx tsx tests/referenceDataAuditWorkbook.test.ts
 */
import ExcelJS from "exceljs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { pool } from "../server/db";
import { buildReferenceDataAuditWorkbook } from "../server/services/referenceDataAuditWorkbook";

const PASS = "\x1b[32m✓\x1b[0m";
const FAIL = "\x1b[31m✗\x1b[0m";
let passed = 0;
let failed = 0;

function ok(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ${PASS} ${label}`);
  } else {
    failed++;
    console.log(`  ${FAIL} ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function isFormula(value: unknown): value is { formula: string } {
  return Boolean(value && typeof value === "object" && "formula" in value);
}

function collectFormulas(wb: ExcelJS.Workbook): string[] {
  const formulas: string[] = [];
  wb.worksheets.forEach(ws => {
    ws.eachRow(row => row.eachCell({ includeEmpty: false }, cell => {
      if (isFormula(cell.value)) formulas.push(cell.value.formula);
    }));
  });
  return formulas;
}

function cellFormula(ws: ExcelJS.Worksheet | undefined, address: string): string {
  const value = ws?.getCell(address).value;
  return isFormula(value) ? value.formula : "";
}

const SEEDED_CLIENT = "test-reference-data-audit-rule";
const SEEDED_LOCATION = "Reference Data Audit Rule Campus";
const SEEDED_RULE = "Reference Data Audit Legacy Trigger";

async function cleanupSeededRuleCase() {
  await pool.query(
    `DELETE FROM adjustment_rules
      WHERE client_id = $1
         OR location_id IN (SELECT id FROM locations WHERE client_id = $1)`,
    [SEEDED_CLIENT],
  );
  await pool.query(`DELETE FROM rent_roll_data WHERE client_id = $1`, [SEEDED_CLIENT]);
  await pool.query(`DELETE FROM locations WHERE client_id = $1`, [SEEDED_CLIENT]);
  await pool.query(`DELETE FROM clients WHERE id = $1`, [SEEDED_CLIENT]);
}

async function runSeededRuleCase() {
  let workbookPath: string | undefined;
  await cleanupSeededRuleCase();
  try {
    await pool.query(
      `INSERT INTO clients (id, name) VALUES ($1, 'Reference Data Audit Rule Test')`,
      [SEEDED_CLIENT],
    );
    const locationResult = await pool.query<{ id: string }>(
      `INSERT INTO locations (name, client_id, location_code, total_units)
       VALUES ($1, $2, 'RDAR', 1)
       RETURNING id`,
      [SEEDED_LOCATION, SEEDED_CLIENT],
    );
    const locationId = locationResult.rows[0].id;

    await pool.query(
      `INSERT INTO rent_roll_data
         (client_id, location_id, upload_month, date, location, room_number,
          room_type, service_line, occupied_yn, size, street_rate, in_house_rate,
          days_vacant, source_room_type, payor_type)
       VALUES ($1, $2, '2026-08', '2026-08-01', $3, '101', 'Studio', 'AL',
               true, 'Studio', 4000, 3900, 0, 'Studio', 'Private Pay')`,
      [SEEDED_CLIENT, locationId, SEEDED_LOCATION],
    );
    const ruleResult = await pool.query<{ id: string }>(
      `INSERT INTO adjustment_rules
         (client_id, location_id, service_line, name, description, trigger, action,
          is_active, is_historical, lifecycle_status, implemented_at, priority, created_by)
       VALUES ($1, $2, 'AL', $3, $4, $5, $6, true, false, 'implemented',
               NOW(), 42, 'reference-data-audit-test')
       RETURNING id`,
      [
        SEEDED_CLIENT,
        locationId,
        SEEDED_RULE,
        "Seeded implemented rule with a legacy trigger for audit coverage",
        JSON.stringify({
          type: "conditional",
          condition: { field: "legacy_occupancy_band", operator: ">=", value: 50 },
        }),
        JSON.stringify({
          type: "adjust_rate",
          target: "street_rate",
          adjustmentType: "percentage",
          adjustmentValue: 10,
          filters: { serviceLine: ["AL"], roomType: ["Studio"], occupancyStatus: "occupied" },
        }),
      ],
    );
    const ruleId = ruleResult.rows[0].id;

    workbookPath = await buildReferenceDataAuditWorkbook({
      clientId: SEEDED_CLIENT,
      generatedBy: "reference-data-audit-test",
    });
    const seededWb = new ExcelJS.Workbook();
    await seededWb.xlsx.readFile(workbookPath);

    const activeRules = seededWb.getWorksheet("Active Rules");
    const audit = seededWb.getWorksheet("Reference Data Audit");
    const activeRuleRow = activeRules
      ? Array.from({ length: activeRules.rowCount }, (_, index) => index + 1)
        .find(rowNumber => String(activeRules.getCell(rowNumber, 1).value ?? "") === ruleId)
      : undefined;
    ok("seeded implemented rule appears in Active Rules", activeRuleRow !== undefined);
    if (activeRuleRow === undefined || !audit) return;

    const ruleIndex = activeRuleRow - 3;
    const ruleSheetName = `Rule Audit - ${String(ruleIndex + 1).padStart(2, "0")}`;
    const ruleAudit = seededWb.getWorksheet(ruleSheetName);
    ok("matching Rule Audit tab is created", Boolean(ruleAudit), ruleSheetName);
    if (!ruleAudit) return;

    ok("Active Rules preserves seeded priority", activeRules?.getCell(activeRuleRow, 3).value === 42);
    ok("Active Rules records location/service-line/room specificity", activeRules?.getCell(activeRuleRow, 4).value === 7);
    ok(
      "legacy trigger is clearly marked as not formula-represented",
      String(activeRules?.getCell(activeRuleRow, 17).value ?? "").includes("Not formula-represented"),
    );
    ok(
      "Reference Data Audit links proposed rate to matching Rule Audit tab",
      cellFormula(audit, "Y2").includes(`'${ruleSheetName}'!$M2`) &&
        cellFormula(audit, "Y2").includes(`'${ruleSheetName}'!$J2`) &&
        !cellFormula(audit, "Y2").includes(`'${ruleSheetName}'!$L2`),
      cellFormula(audit, "Y2"),
    );
    ok(
      "Rule Audit links identity back to Reference Data Audit",
      cellFormula(ruleAudit, "B2") === "='Reference Data Audit'!$D$2",
      cellFormula(ruleAudit, "B2"),
    );

    const filterFormula = cellFormula(ruleAudit, "F2");
    ok(
      "Rule Audit filter formula matches the seeded location, service line, room type, and occupancy",
      filterFormula.includes(`$A2="${locationId}"`) &&
        filterFormula.includes('$E2="AL"') &&
        filterFormula.includes('$F2="Studio"') &&
        filterFormula.includes("$J2>0"),
      filterFormula,
    );
    const triggerFormula = cellFormula(ruleAudit, "G2");
    ok(
      "unsupported legacy trigger produces a non-matching trigger result",
      triggerFormula.includes('IF(FALSE,"Yes","No")'),
      triggerFormula,
    );
    const adjustedRateFormula = cellFormula(ruleAudit, "J2");
    ok(
      "Rule Audit recalculates the adjusted rate from the base rate",
      adjustedRateFormula.includes('$H2*') && adjustedRateFormula.includes("(1+10/100)"),
      adjustedRateFormula,
    );
    const priorityFormula = cellFormula(ruleAudit, "M2");
    ok(
      "Rule Audit priority selection requires both filter and trigger matches",
      priorityFormula === '=IF(AND($F2="Yes",$G2="Yes"),"Yes","No")',
      priorityFormula,
    );
  } finally {
    if (workbookPath) await rm(path.dirname(workbookPath), { recursive: true, force: true });
    await cleanupSeededRuleCase();
  }
}

async function main() {
  const base = process.env.TEST_BASE_URL || "http://localhost:5000";
  console.log("\nReference Data audit workbook export\n");

  const response = await fetch(`${base}/api/reference-data/audit-workbook`);
  ok("endpoint returns 200", response.ok, `${response.status}`);
  ok(
    "download has XLSX content type",
    response.headers.get("content-type")?.includes("spreadsheetml.sheet") === true,
    response.headers.get("content-type") ?? "missing content type",
  );
  ok(
    "download has stable attachment filename",
    response.headers.get("content-disposition")?.includes("reference_data_audit.xlsx") === true,
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  ok("download is non-empty", bytes.length > 1000, `${bytes.length} bytes`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const names = wb.worksheets.map(ws => ws.name);
  const expected = [
    "Read Me", "Location Data", "Rent Roll", "Inquiry Data",
    "Competitive Survey", "RT Occupancy History", "Move Ins & Outs",
    "Manual Overrides", "Active Rules", "Reference Data Audit", "Calculation Notes",
  ];
  expected.forEach(name => ok(`sheet exists: ${name}`, names.includes(name)));

  const rentRoll = wb.getWorksheet("Rent Roll");
  const audit = wb.getWorksheet("Reference Data Audit");
  ok("Rent Roll has upload-shaped first headers", rentRoll?.getRow(1).getCell(1).value === "Upload Month");
  ok("Rent Roll preserves the room-type source field", rentRoll?.getRow(1).getCell(31).value === "Source Room Type");
  ok("Rent Roll exposes formula audit helpers", rentRoll?.getRow(1).getCell(37).value === "Physical Room First");
  ok("audit has a non-empty result", Boolean(audit && audit.rowCount > 1), `${audit?.rowCount ?? 0} rows`);
  ok("audit total-units cell is a formula", isFormula(audit?.getCell("I2").value));
  ok("audit street-rate cell is a formula", isFormula(audit?.getCell("O2").value));
  ok("audit final-rate cell is a formula", isFormula(audit?.getCell("AA2").value));
  ok("audit freezes identity columns and header", audit?.views?.[0]?.xSplit === 8 && audit?.views?.[0]?.ySplit === 1);

  const formulas = collectFormulas(wb);
  ok("workbook contains formula cells", formulas.length > 20, `${formulas.length} formulas`);
  ok("formulas use qualified source-sheet references", formulas.some(f => f.includes("'Rent Roll'!")));
  ok("formulas use qualified occupancy-sheet references", formulas.some(f => f.includes("'RT Occupancy History'!")));
  ok("formulas use qualified override-sheet references", formulas.some(f => f.includes("'Manual Overrides'!")));
  ok("no formula contains an unresolved column reference", formulas.every(f => !f.includes("undefined")), "unresolved reference found");
  ok("read me identifies the tenant", String(wb.getWorksheet("Read Me")?.getCell("B3").value ?? "").length > 0);

  // The route must ignore a browser-supplied tenant selector. Anonymous
  // requests resolve to demo, so the response should retain the same tenant
  // metadata when an attacker appends ?clientId=trilogy.
  const tampered = await fetch(`${base}/api/reference-data/audit-workbook?clientId=trilogy`);
  const tamperedWb = new ExcelJS.Workbook();
  await tamperedWb.xlsx.load(Buffer.from(await tampered.arrayBuffer()));
  ok(
    "browser clientId query parameter cannot change tenant scope",
    tamperedWb.getWorksheet("Read Me")?.getCell("B3").value === wb.getWorksheet("Read Me")?.getCell("B3").value,
  );

  await runSeededRuleCase();
  await pool.end();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});