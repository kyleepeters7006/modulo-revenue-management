/**
 * In-House Rate Planning — Excel export regression coverage.
 *
 * The export makes a strong claim: every per-resident number in the workbook
 * is a LIVE Excel formula that reproduces the solver. A test that only checked
 * the file opens, or that the formula strings "look right", would not guard
 * that claim at all — a transposed MIN/MAX or a reference pointing one row off
 * produces a perfectly valid workbook full of wrong numbers.
 *
 * So this suite ships a small Excel formula evaluator and actually EVALUATES
 * the strings the exporter emitted, reading the same input cells Excel would,
 * then checks the result equals what the solver independently computed for
 * that resident. If the two ever disagree, the workbook is lying to operators
 * and this test fails.
 *
 * It also verifies the structural promises: frozen panes that survive
 * scrolling right, no-decimal comma money formats, a totals row that sums the
 * live column, and real chart parts wired into the package.
 *
 * Run with: npx tsx tests/inhouseRatePlanExport.test.ts
 */
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { pool } from "../server/db";
import { DEFAULT_ASSUMPTIONS, type PlanningAssumptions } from "../shared/inhousePlanning";
import { calculatePlanDetailed, PlanningDataError } from "../server/services/inhouseRatePlanning";
import { buildRatePlanWorkbook } from "../server/services/inhouseRatePlanning/excelExport";

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

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

// ── a small Excel formula evaluator ────────────────────────────────────────
// Deliberately covers only the vocabulary the exporter emits. Anything else
// throws loudly rather than silently returning a plausible number.

type CellVal = number | string | boolean | null;

class Evaluator {
  private wb: ExcelJS.Workbook;
  private cache = new Map<string, CellVal>();
  private stack = new Set<string>();

  constructor(wb: ExcelJS.Workbook) {
    this.wb = wb;
  }

  cell(sheet: string, addr: string): CellVal {
    const key = `${sheet}!${addr}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    if (this.stack.has(key)) throw new Error(`circular reference at ${key}`);
    this.stack.add(key);

    const ws = this.wb.getWorksheet(sheet);
    if (!ws) throw new Error(`no sheet "${sheet}"`);
    const c = ws.getCell(addr);
    let out: CellVal;
    const v: any = c.value;
    if (v === null || v === undefined) out = null;
    else if (typeof v === "object" && "formula" in v) out = this.evaluate(sheet, v.formula);
    else if (typeof v === "object" && "result" in v) out = v.result;
    else if (v instanceof Date) out = v.toISOString();
    else out = v as CellVal;

    this.stack.delete(key);
    this.cache.set(key, out);
    return out;
  }

  evaluate(sheet: string, formula: string): any {
    const p = new Parser(formula, sheet, this);
    const v = p.parseExpression();
    p.expectEnd();
    return v;
  }
}

const num = (v: any): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const flat = (args: any[]): any[] =>
  args.flatMap((a) => (Array.isArray(a) ? flat(a) : [a]));
const nums = (args: any[]): number[] =>
  flat(args).filter((v) => typeof v === "number" || typeof v === "boolean").map(num);

class Parser {
  private s: string;
  private i = 0;
  private sheet: string;
  private ev: Evaluator;

  constructor(src: string, sheet: string, ev: Evaluator) {
    this.s = src;
    this.sheet = sheet;
    this.ev = ev;
  }

  private ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  private peek(str: string): boolean {
    this.ws();
    return this.s.startsWith(str, this.i);
  }
  private take(str: string): boolean {
    if (this.peek(str)) {
      this.i += str.length;
      return true;
    }
    return false;
  }
  expectEnd() {
    this.ws();
    if (this.i < this.s.length) {
      throw new Error(`unparsed tail in formula: ${this.s.slice(this.i)} (full: ${this.s})`);
    }
  }

  parseExpression(): any {
    return this.parseCompare();
  }

  private parseCompare(): any {
    let left = this.parseConcat();
    for (;;) {
      let op: string | null = null;
      for (const cand of ["<>", "<=", ">=", "=", "<", ">"]) {
        if (this.peek(cand)) {
          op = cand;
          this.i += cand.length;
          break;
        }
      }
      if (!op) return left;
      const right = this.parseConcat();
      const bothStr = typeof left === "string" || typeof right === "string";
      const l = bothStr ? String(left ?? "") : num(left);
      const r = bothStr ? String(right ?? "") : num(right);
      left =
        op === "=" ? l === r
        : op === "<>" ? l !== r
        : op === "<" ? l < r
        : op === ">" ? l > r
        : op === "<=" ? l <= r
        : l >= r;
    }
  }

  private parseConcat(): any {
    let left = this.parseAdditive();
    while (this.peek("&")) {
      this.i += 1;
      const right = this.parseAdditive();
      left = `${left ?? ""}${right ?? ""}`;
    }
    return left;
  }

  private parseAdditive(): any {
    let left = this.parseMultiplicative();
    for (;;) {
      this.ws();
      if (this.peek("+")) {
        this.i++;
        left = num(left) + num(this.parseMultiplicative());
      } else if (this.peek("-")) {
        this.i++;
        left = num(left) - num(this.parseMultiplicative());
      } else return left;
    }
  }

  private parseMultiplicative(): any {
    let left = this.parsePower();
    for (;;) {
      this.ws();
      if (this.peek("*")) {
        this.i++;
        left = num(left) * num(this.parsePower());
      } else if (this.peek("/")) {
        this.i++;
        const d = num(this.parsePower());
        left = d === 0 ? 0 : num(left) / d;
      } else return left;
    }
  }

  private parsePower(): any {
    let left = this.parseUnary();
    while (this.peek("^")) {
      this.i++;
      left = Math.pow(num(left), num(this.parseUnary()));
    }
    return left;
  }

  private parseUnary(): any {
    this.ws();
    if (this.take("-")) return -num(this.parseUnary());
    if (this.take("+")) return num(this.parseUnary());
    return this.parsePrimary();
  }

  private parsePrimary(): any {
    this.ws();
    if (this.take("(")) {
      const v = this.parseExpression();
      if (!this.take(")")) throw new Error("expected )");
      return v;
    }
    // string literal
    if (this.peek('"')) {
      this.i++;
      let out = "";
      while (this.i < this.s.length) {
        if (this.s[this.i] === '"') {
          if (this.s[this.i + 1] === '"') {
            out += '"';
            this.i += 2;
            continue;
          }
          this.i++;
          return out;
        }
        out += this.s[this.i++];
      }
      throw new Error("unterminated string");
    }
    // number
    const numMatch = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(this.s.slice(this.i));
    if (numMatch) {
      this.i += numMatch[0].length;
      return Number(numMatch[0]);
    }
    // quoted sheet reference
    const quotedSheet = /^'([^']+)'!/.exec(this.s.slice(this.i));
    if (quotedSheet) {
      this.i += quotedSheet[0].length;
      return this.parseRefBody(quotedSheet[1]);
    }
    // function call, unquoted sheet ref, boolean, or plain cell ref
    const ident = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(this.s.slice(this.i));
    if (ident) {
      const name = ident[0];
      const after = this.s.slice(this.i + name.length);
      if (after.startsWith("(")) {
        this.i += name.length + 1;
        const args = this.parseArgs();
        return this.callFunction(name.toUpperCase(), args);
      }
      if (after.startsWith("!")) {
        this.i += name.length + 1;
        return this.parseRefBody(name);
      }
      if (name.toUpperCase() === "TRUE") {
        this.i += name.length;
        return true;
      }
      if (name.toUpperCase() === "FALSE") {
        this.i += name.length;
        return false;
      }
    }
    // bare cell reference on the current sheet
    return this.parseRefBody(this.sheet);
  }

  private parseArgs(): any[] {
    const args: any[] = [];
    this.ws();
    if (this.take(")")) return args;
    for (;;) {
      args.push(this.parseExpression());
      this.ws();
      if (this.take(",")) continue;
      if (this.take(")")) return args;
      throw new Error(`expected , or ) at ${this.s.slice(this.i)}`);
    }
  }

  /** Parse `$B$27` or `A5:A12` and read the value(s) from `sheet`. */
  private parseRefBody(sheet: string): any {
    const m = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/.exec(this.s.slice(this.i));
    if (!m) throw new Error(`expected a cell reference at: ${this.s.slice(this.i)}`);
    this.i += m[0].length;
    if (!m[3]) return this.ev.cell(sheet, `${m[1]}${m[2]}`);

    const c1 = colNum(m[1]);
    const c2 = colNum(m[3]);
    const r1 = Number(m[2]);
    const r2 = Number(m[4]);
    const out: any[] = [];
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
        out.push(this.ev.cell(sheet, `${colLetter(c)}${r}`));
      }
    }
    return out;
  }

  private callFunction(name: string, args: any[]): any {
    switch (name) {
      case "IF":
        return num(args[0]) !== 0 || args[0] === true
          ? args[1]
          : args.length > 2
            ? args[2]
            : false;
      case "AND":
        return flat(args).every((v) => v === true || num(v) !== 0);
      case "OR":
        return flat(args).some((v) => v === true || num(v) !== 0);
      case "MAX": {
        const n = nums(args);
        return n.length ? Math.max(...n) : 0;
      }
      case "MIN": {
        const n = nums(args);
        return n.length ? Math.min(...n) : 0;
      }
      case "MEDIAN": {
        const n = nums(args).sort((a, b) => a - b);
        if (!n.length) return 0;
        const mid = Math.floor(n.length / 2);
        return n.length % 2 ? n[mid] : (n[mid - 1] + n[mid]) / 2;
      }
      case "SUM":
        return nums(args).reduce((a, b) => a + b, 0);
      case "COUNT":
        return nums(args).length;
      case "AVERAGE": {
        const n = nums(args);
        return n.length ? n.reduce((a, b) => a + b, 0) / n.length : 0;
      }
      case "SUMPRODUCT": {
        const arrays = args.map((a) => (Array.isArray(a) ? a : [a]));
        const len = Math.max(...arrays.map((a) => a.length));
        let total = 0;
        for (let i = 0; i < len; i++) {
          total += arrays.reduce((acc, a) => acc * num(a[i]), 1);
        }
        return total;
      }
      case "COUNTIF": {
        const range = flat([args[0]]);
        const crit = args[1];
        if (typeof crit === "string" && /^[<>]=?|^<>/.test(crit)) {
          const opMatch = /^(<>|<=|>=|<|>)(.*)$/.exec(crit)!;
          const target = Number(opMatch[2]);
          return range.filter((v) => {
            const n = num(v);
            switch (opMatch[1]) {
              case ">": return n > target;
              case "<": return n < target;
              case ">=": return n >= target;
              case "<=": return n <= target;
              default: return n !== target;
            }
          }).length;
        }
        return range.filter((v) => String(v ?? "") === String(crit ?? "")).length;
      }
      case "IFERROR":
        return args[0];
      case "ROUND": {
        const f = Math.pow(10, num(args[1]));
        return Math.round(num(args[0]) * f) / f;
      }
      // Not part of the money chain; the test skips tenure cells.
      case "DATEDIF":
      case "DATE":
      case "VALUE":
      case "LEFT":
      case "RIGHT":
        return 0;
      default:
        throw new Error(`evaluator does not implement ${name}()`);
    }
  }
}

function colNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ── scope discovery ────────────────────────────────────────────────────────

async function discoverScopes(): Promise<
  Array<{ clientId: string; serviceLine: string; label: string }>
> {
  const { rows } = await pool.query<{ client_id: string; service_line: string; n: string }>(`
    SELECT client_id, service_line, COUNT(*) AS n
      FROM rent_roll_data
     WHERE service_line IS NOT NULL
       AND in_house_rate IS NOT NULL AND in_house_rate > 0
     GROUP BY client_id, service_line
     ORDER BY COUNT(*) DESC
     LIMIT 40
  `);

  const out: Array<{ clientId: string; serviceLine: string; label: string }> = [];
  const monthly = rows.find((r) => !/^HC/i.test(r.service_line));
  const dailyLine = rows.find((r) => /^HC/i.test(r.service_line));
  if (monthly) {
    out.push({
      clientId: monthly.client_id,
      serviceLine: monthly.service_line,
      label: `${monthly.client_id} / ${monthly.service_line} (monthly)`,
    });
  }
  if (dailyLine) {
    out.push({
      clientId: dailyLine.client_id,
      serviceLine: dailyLine.service_line,
      label: `${dailyLine.client_id} / ${dailyLine.service_line} (daily)`,
    });
  }
  return out;
}

// ── the suite ──────────────────────────────────────────────────────────────

const EPS = 1e-6;

async function checkScope(scope: { clientId: string; serviceLine: string; label: string }) {
  section(`Export — ${scope.label}`);

  const assumptions: PlanningAssumptions = { ...DEFAULT_ASSUMPTIONS };
  let plan, audit;
  try {
    ({ plan, audit } = await calculatePlanDetailed({
      clientId: scope.clientId,
      locationId: null,
      location: null,
      serviceLine: scope.serviceLine,
      assumptions,
    }));
  } catch (err) {
    if (err instanceof PlanningDataError) {
      console.log(`  (skipped — ${err.message})`);
      return;
    }
    throw err;
  }

  const buffer = await buildRatePlanWorkbook({ plan, audit, generatedBy: "test" });
  ok("workbook builds", buffer.length > 0);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);

  const names = wb.worksheets.map((w) => w.name);
  ok(
    "all five sheets present",
    ["Plan summary", "Resident detail", "Move-in trends", "Rate history", "Method"].every((n) =>
      names.includes(n),
    ),
    names.join(", "),
  );

  const detail = wb.getWorksheet("Resident detail")!;

  // ── frozen panes: header AND leading identity columns ──
  const view: any = detail.views?.[0];
  ok("detail sheet freezes panes", view?.state === "frozen");
  ok(
    "freeze survives scrolling right (xSplit = 3 identity columns)",
    view?.xSplit === 3,
    `xSplit=${view?.xSplit}`,
  );
  ok("header row frozen (ySplit = 2)", view?.ySplit === 2, `ySplit=${view?.ySplit}`);

  // ── locate the data block ──
  const headerRow = 2;
  const firstDataRow = 3;
  const count = audit.residents.length;
  const lastDataRow = firstDataRow + count - 1;
  const totalRow = lastDataRow + 1;
  ok("one row per resident", count > 0 && detail.getCell(`A${lastDataRow}`).value !== null,
     `${count} residents`);

  const headers: Record<string, number> = {};
  detail.getRow(headerRow).eachCell((cell, col) => {
    headers[String(cell.value ?? "").split("\n")[0].trim()] = col;
  });
  const colOf = (label: string) => {
    const c = headers[label];
    if (!c) throw new Error(`no column headed "${label}" (have: ${Object.keys(headers).join(" | ")})`);
    return colLetter(c);
  };

  const cIncrease = colOf("Increase %");
  const cNewRate = colOf("New rate (monthly)");
  const cHeadroom = colOf("Room to street");
  const cShape = colOf("Shape");
  const cMinEff = colOf("Min allowed");
  const cMaxEff = colOf("Max allowed");
  const cDollars = colOf("Increase $ / month");

  // ── the real test: evaluate the emitted formulas ──
  const ev = new Evaluator(wb);

  let increaseMismatch = 0;
  let rateMismatch = 0;
  let headroomMismatch = 0;
  let shapeMismatch = 0;
  let boundsMismatch = 0;
  let worstIncrease = 0;
  let worstRate = 0;
  let firstBad = "";

  const planByKey = new Map(plan.residents.map((r) => [`${r.location}|${r.roomNumber}`, r]));

  for (let i = 0; i < count; i++) {
    const row = firstDataRow + i;
    const a = audit.residents[i];

    const evHeadroom = num(ev.cell("Resident detail", `${cHeadroom}${row}`));
    const evShape = num(ev.cell("Resident detail", `${cShape}${row}`));
    const evMin = num(ev.cell("Resident detail", `${cMinEff}${row}`));
    const evMax = num(ev.cell("Resident detail", `${cMaxEff}${row}`));
    const evInc = num(ev.cell("Resident detail", `${cIncrease}${row}`));
    const evNew = num(ev.cell("Resident detail", `${cNewRate}${row}`));

    if (Math.abs(evHeadroom - a.headroom) > 1e-9) headroomMismatch++;
    if (Math.abs(evShape - a.shape) > 1e-9) shapeMismatch++;
    if (Math.abs(evMin - a.minEffective) > 1e-9 || Math.abs(evMax - a.maxEffective) > 1e-9) {
      boundsMismatch++;
    }

    const dInc = Math.abs(evInc - a.increase);
    if (dInc > EPS) {
      increaseMismatch++;
      if (dInc > worstIncrease) {
        worstIncrease = dInc;
        firstBad = `${a.location} room ${a.roomNumber}: sheet ${(evInc * 100).toFixed(4)}% vs solver ${(a.increase * 100).toFixed(4)}%`;
      }
    }

    const expectedNew = a.currentRateMonthly * (1 + a.increase);
    worstRate = Math.max(worstRate, Math.abs(evNew - expectedNew));
    if (Math.abs(evNew - expectedNew) > 1e-6) rateMismatch++;

    // and the workbook's new rate must match what the UI shows the operator
    const shown = planByKey.get(`${a.location}|${a.roomNumber}`);
    if (shown && Math.abs(evNew - shown.newRateMonthly) > 0.01) rateMismatch++;
  }

  ok("headroom formula reproduces the solver for every resident", headroomMismatch === 0,
     `${headroomMismatch} of ${count} differ`);
  ok("shape formula reproduces the solver for every resident", shapeMismatch === 0,
     `${shapeMismatch} of ${count} differ`);
  ok("min/max bound formulas reproduce the solver", boundsMismatch === 0,
     `${boundsMismatch} of ${count} differ`);
  ok(
    "MEDIAN clamp reproduces every resident's increase",
    increaseMismatch === 0,
    `${increaseMismatch} of ${count} differ, worst ${(worstIncrease * 100).toFixed(6)}pp — ${firstBad}`,
  );
  ok(
    "new-rate formula matches the rate shown in the app",
    rateMismatch === 0,
    `${rateMismatch} mismatches, worst $${worstRate.toFixed(6)}`,
  );

  // ── the totals row ──
  const evTotalPct = num(ev.cell("Resident detail", `${cIncrease}${totalRow}`));
  ok(
    "totals row weighted average reconciles to the plan headline",
    Math.abs(evTotalPct - plan.summary.weightedAvgIncreasePct / 100) < 1e-6,
    `sheet ${(evTotalPct * 100).toFixed(6)}% vs plan ${plan.summary.weightedAvgIncreasePct.toFixed(6)}%`,
  );

  const evTotalDollars = num(ev.cell("Resident detail", `${cDollars}${totalRow}`));
  const expectedDollars = audit.residents.reduce(
    (acc, r) => acc + r.currentRateMonthly * r.increase,
    0,
  );
  ok(
    "totals row sums the monthly increase",
    Math.abs(evTotalDollars - expectedDollars) < 0.01,
    `sheet ${evTotalDollars.toFixed(2)} vs ${expectedDollars.toFixed(2)}`,
  );
  ok("totals row is labelled", String(detail.getCell(`A${totalRow}`).value ?? "").startsWith("TOTAL"));

  // ── the summary sheet reconciles ──
  const achievedRow = findLabelRow(wb, "Achieved weighted-average increase");
  const summaryAchieved = num(ev.cell("Plan summary", `B${achievedRow}`));
  ok(
    "summary achieved average is live from the detail sheet",
    Math.abs(summaryAchieved - plan.summary.weightedAvgIncreasePct / 100) < 1e-6,
    `${(summaryAchieved * 100).toFixed(6)}%`,
  );
  const summaryMonthly = num(ev.cell("Plan summary", `B${findLabelRow(wb, "TOTAL INCREASE PER MONTH")}`));
  ok(
    "summary monthly total equals the detail total",
    Math.abs(summaryMonthly - expectedDollars) < 0.01,
    `${summaryMonthly.toFixed(2)} vs ${expectedDollars.toFixed(2)}`,
  );
  const summaryAnnual = num(ev.cell("Plan summary", `B${findLabelRow(wb, "TOTAL INCREASE PER YEAR")}`));
  ok(
    "summary annual total is twelve months of the monthly total",
    Math.abs(summaryAnnual - expectedDollars * 12) < 0.12,
    `${summaryAnnual.toFixed(2)}`,
  );

  // Lambda must round-trip: it is the one solved input everything hangs off.
  const lambdaRow = findLabelRow(wb, "Lambda (solved calibration scalar)");
  const lambdaCell = num(ev.cell("Plan summary", `B${lambdaRow}`));
  ok("lambda is exported as a live input cell", Math.abs(lambdaCell - audit.lambda) < 1e-12);

  // The street multiplier used to be pasted from the solve. It is derivable
  // from the two effective dates, so it must be a formula that reproduces the
  // service's own streetMultiplierAtInhouse.
  const multRow = findLabelRow(wb, "Street multiplier at in-house date");
  const multCell = wb.getWorksheet("Plan summary")!.getCell(`B${multRow}`);
  ok(
    "street multiplier is a live formula, not a pasted solve output",
    typeof multCell.value === "object" && multCell.value !== null && "formula" in (multCell.value as object),
  );
  ok(
    "street multiplier formula reproduces streetMultiplierAtInhouse",
    Math.abs(num(ev.cell("Plan summary", `B${multRow}`)) - audit.streetMultiplierAtInhouse) < 1e-9,
  );

  // Anything the workbook cannot recompute must be presented as a snapshot, not
  // as an editable input that silently does nothing.
  for (const label of [
    "Annual rate growth target",
    "Annual resident turnover",
    "Required weighted-average increase",
  ]) {
    const cell = wb.getWorksheet("Plan summary")!.getCell(`B${findLabelRow(wb, label)}`);
    const isFormula =
      typeof cell.value === "object" && cell.value !== null && "formula" in (cell.value as object);
    ok(`"${label}" is a static snapshot, not a formula`, !isFormula);
    ok(
      `"${label}" is shaded as a snapshot rather than a live input`,
      (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb === "FFEDEDED",
    );
  }

  // Changing lambda must actually move the sheet — proof the chain is live and
  // not a set of pasted constants that merely look like formulas.
  const bumped = new ExcelJS.Workbook();
  await bumped.xlsx.load(buffer as any);
  bumped.getWorksheet("Plan summary")!.getCell(`B${lambdaRow}`).value = audit.lambda + 0.01;
  const ev2 = new Evaluator(bumped);
  const before = num(ev.cell("Resident detail", `${cIncrease}${firstDataRow}`));
  const after = num(ev2.cell("Resident detail", `${cIncrease}${firstDataRow}`));
  const anyMoved = audit.residents.some((_, i) => {
    const r = firstDataRow + i;
    return (
      Math.abs(
        num(ev2.cell("Resident detail", `${cIncrease}${r}`)) -
          num(ev.cell("Resident detail", `${cIncrease}${r}`)),
      ) > 1e-9
    );
  });
  ok(
    "changing lambda recalculates the sheet (formulas are live, not pasted values)",
    anyMoved,
    `first resident ${before} -> ${after}`,
  );

  // ── number formats: commas, no decimals ──
  const moneyFmt = detail.getCell(`${colOf("Current rate (monthly)")}${firstDataRow}`).numFmt || "";
  ok(
    "money is comma separated with no decimals",
    moneyFmt.includes("#,##0") && !/#,##0\.\d/.test(moneyFmt),
    moneyFmt,
  );

  // ── charts ──
  const zip = await JSZip.loadAsync(buffer);
  const chartParts = Object.keys(zip.files).filter((n) => /^xl\/charts\/chart\d+\.xml$/.test(n));
  ok("workbook contains chart parts", chartParts.length >= 3, `${chartParts.length} charts`);

  const ct = await zip.file("[Content_Types].xml")!.async("string");
  ok(
    "every chart is declared in [Content_Types].xml",
    chartParts.every((p) => ct.includes(`PartName="/${p}"`)),
  );

  let danglingRels = 0;
  for (const relPath of Object.keys(zip.files).filter((n) => n.endsWith(".rels"))) {
    const relXml = await zip.file(relPath)!.async("string");
    const baseDir = relPath.replace(/_rels\/[^/]+$/, "");
    for (const m of Array.from(relXml.matchAll(/Target="([^"]+)"/g))) {
      const t = m[1];
      if (/^https?:|^mailto:|^\.\.\/theme|^#/.test(t)) continue;
      const resolved = t.startsWith("/")
        ? t.slice(1)
        : new URL(t, `file:///${baseDir}`).pathname.slice(1);
      if (!zip.file(resolved)) danglingRels++;
    }
  }
  ok("no dangling relationship targets", danglingRels === 0, `${danglingRels} dangling`);

  // charts must point at ranges that actually hold numbers
  let badRefs = 0;
  for (const part of chartParts) {
    const xml = await zip.file(part)!.async("string");
    for (const m of Array.from(xml.matchAll(/<c:f>([^<]+)<\/c:f>/g))) {
      const ref = m[1];
      const rm = /^'?([^'!]+)'?!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)$/.exec(ref);
      if (!rm) {
        badRefs++;
        continue;
      }
      if (!wb.getWorksheet(rm[1])) badRefs++;
    }
  }
  ok("every chart series references a real sheet range", badRefs === 0, `${badRefs} bad refs`);

  // ── supporting data is actually populated ──
  const moveIn = wb.getWorksheet("Move-in trends")!;
  ok("move-in trend sheet has cohort rows", moveIn.rowCount > 8, `${moveIn.rowCount} rows`);
  const history = wb.getWorksheet("Rate history")!;
  ok("rate history sheet has the realized months", history.rowCount > 8, `${history.rowCount} rows`);
  ok("method sheet documents each step", (wb.getWorksheet("Method")!.rowCount ?? 0) >= 13);
}

/** Find a summary row by its label so the test does not hard-code layout twice. */
function findLabelRow(wb: ExcelJS.Workbook, label: string): number {
  const ws = wb.getWorksheet("Plan summary")!;
  let found = 0;
  ws.eachRow((row, ix) => {
    if (String(row.getCell(1).value ?? "").trim() === label) found = ix;
  });
  if (!found) throw new Error(`no summary row labelled "${label}"`);
  return found;
}

async function main() {
  const scopes = await discoverScopes();
  if (!scopes.length) {
    console.log("No rent-roll scopes with in-house rates found; nothing to test.");
    return;
  }
  for (const scope of scopes) {
    await checkScope(scope);
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
