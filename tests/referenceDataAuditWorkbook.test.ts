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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});