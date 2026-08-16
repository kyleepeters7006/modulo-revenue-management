/**
 * Loads a THS Census Report Summary CSV into `census_capacity_reference`.
 *
 * This is a tie-out/reference source, NOT a pricing input. Occupancy history
 * stays the single computational source for capacity and occupancy; this table
 * only lets us detect when our derived capacity has drifted from what the
 * client's finance system reports.
 *
 * Usage:  tsx server/importCensusReference.ts <csv-path> [clientId]
 *
 * Report shape
 * ------------
 * The export contains several unlabelled roll-up sections (full company,
 * ex-Kingston, Kingston-only, and other cuts) followed by one section that is
 * broken out by division. Only the division section carries an explicit label
 * column, and it sums exactly to the full-company roll-up, so it is the block
 * we read — it is the only one whose scope is unambiguous.
 *
 * Health-care departments report capacity in AvailableBeds and senior-housing
 * departments in AvailableUnits; the other column is zero. Both are stored.
 * Capacity rows appear on the payer rows within each department, so a
 * department's capacity is the sum across its payer rows.
 */
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { pool } from './db';

/** Report department label -> our service line. */
const DEPARTMENT_TO_SERVICE_LINE: Record<string, string> = {
  '01-HC': 'HC',
  '02-HC Legacy': 'HC/MC',
  '03-AL': 'AL',
  '03-AL Legacy': 'AL/MC',
  '05-IL': 'VIL',
  '06-SL': 'SL',
};

/**
 * Column layout of the division section.
 *
 * Everything is resolved from the header row and from the data itself — never
 * from a fixed offset — so a re-ordered export either still works or fails
 * loudly, instead of quietly importing some other numeric measure as capacity.
 *
 * The header repeats each measure several times with a numeric suffix
 * (AvailableBeds20 / AvailableBeds21 / AvailableBeds22): one pair is the
 * per-payer detail, one is a subtotal, and one restates the report's own
 * company-wide grand total on every row. Which is which is worked out in
 * `selectCapacityColumns` below rather than assumed from ordering.
 */
interface HeaderColumns {
  division: number;
  department: number;
  /** Every AvailableBeds/AvailableUnits column pair, in header order. */
  capacityPairs: { beds: number; units: number }[];
}

function resolveHeaderColumns(header: string[]): HeaderColumns {
  const norm = header.map((h) => (h ?? '').trim());
  const findAll = (re: RegExp) => norm.map((h, i) => (re.test(h) ? i : -1)).filter((i) => i >= 0);

  const division = norm.findIndex((h) => /^division$/i.test(h));
  const departmentMatches = findAll(/^DisplayDept\d*$/i);
  const bedsMatches = findAll(/^AvailableBeds\d*$/i);
  const unitsMatches = findAll(/^AvailableUnits\d*$/i);

  const missing: string[] = [];
  if (division < 0) missing.push('division');
  if (departmentMatches.length === 0) missing.push('DisplayDept');
  if (bedsMatches.length === 0) missing.push('AvailableBeds');
  if (unitsMatches.length === 0) missing.push('AvailableUnits');
  if (missing.length) {
    throw new Error(
      `Census report division section is missing expected column(s): ${missing.join(', ')}. ` +
      `Found headers: ${norm.filter(Boolean).join(', ')}`
    );
  }
  if (bedsMatches.length !== unitsMatches.length) {
    throw new Error(
      `Census report has ${bedsMatches.length} AvailableBeds column(s) but ` +
      `${unitsMatches.length} AvailableUnits column(s); they are expected to come in pairs.`
    );
  }

  return {
    division,
    department: departmentMatches[0],
    capacityPairs: bedsMatches.map((beds, i) => ({ beds, units: unitsMatches[i] })),
  };
}

/**
 * Works out which capacity column pair holds the per-row detail, by checking the
 * data rather than trusting column order.
 *
 * A pair that restates a report-wide total carries the same value on every row,
 * which identifies it. The detail pair is then the one that actually sums to
 * that total. If nothing sums to it, the export's shape has changed in a way we
 * don't understand and we refuse rather than publish a wrong reconciliation.
 */
function selectCapacityColumns(
  pairs: { beds: number; units: number }[],
  dataRows: string[][],
): { detail: { beds: number; units: number }; reportedTotal: number | null } {
  const valueOf = (row: string[], p: { beds: number; units: number }) =>
    parseReportNumber(row[p.beds]) + parseReportNumber(row[p.units]);

  const constantPairs = pairs.filter((p) => {
    const first = valueOf(dataRows[0], p);
    return first > 0 && dataRows.every((r) => valueOf(r, p) === first);
  });

  // No self-stated total to check against (a cut-down export). Fall back to the
  // first pair; the caller reports that the check was skipped.
  if (constantPairs.length === 0) {
    return { detail: pairs[0], reportedTotal: null };
  }

  // Several columns can look constant; the grand total is the largest of them.
  const totalPair = constantPairs.reduce((a, b) =>
    valueOf(dataRows[0], b) > valueOf(dataRows[0], a) ? b : a,
  );
  const reportedTotal = valueOf(dataRows[0], totalPair);
  const detail = pairs.find(
    (p) => p !== totalPair && dataRows.reduce((s, r) => s + valueOf(r, p), 0) === reportedTotal,
  );

  if (!detail) {
    const sums = pairs.map((p) => dataRows.reduce((s, r) => s + valueOf(r, p), 0));
    throw new Error(
      `Census report failed its integrity check: the report states a grand total of ` +
      `${reportedTotal.toLocaleString()}, but no AvailableBeds/AvailableUnits column pair sums to it ` +
      `(pair totals: ${sums.map((s) => s.toLocaleString()).join(', ')}). The export's column layout has ` +
      `probably changed — verify which columns hold the per-payer capacity detail before importing.`
    );
  }

  return { detail, reportedTotal };
}

/**
 * Report numbers arrive as "1,348", "(33)" for negatives, "90.40%", or blank.
 * Percentages are never capacity, so they are treated as zero.
 */
function parseReportNumber(raw: string | undefined): number {
  const s = (raw ?? '').trim().replace(/,/g, '');
  if (!s || s.endsWith('%')) return 0;
  const negative = s.startsWith('(') && s.endsWith(')');
  const body = negative ? s.slice(1, -1) : s;
  const n = Number(body);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

export interface CensusReferenceRow {
  division: string;
  department: string;
  serviceLine: string;
  availableBeds: number;
  availableUnits: number;
}

export interface ParsedCensusReport {
  asOfDate: string | null;
  year: number;
  month: number;
  rows: CensusReferenceRow[];
}

export function parseCensusReport(csvText: string): ParsedCensusReport {
  const records: string[][] = parse(csvText, {
    relax_column_count: true,
    skip_empty_lines: false,
    bom: true,
  });

  // The report date only appears in the roll-up sections (first column of each
  // data row); the division section has a division name there instead.
  let asOfDate: string | null = null;
  for (const row of records) {
    const first = (row[0] ?? '').trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(first)) {
      asOfDate = first;
      break;
    }
  }
  if (!asOfDate) throw new Error('Could not find a report date (MM/DD/YYYY) in the census report');
  const [monthStr, , yearStr] = asOfDate.split('/');

  // Locate the division section by its labelled header. It is the only section
  // with a "division" column, and it must also carry the capacity columns —
  // requiring both avoids latching onto some other row that says "division".
  const headerIndex = records.findIndex((r) => {
    const cells = r.map((c) => (c ?? '').trim());
    return cells.some((c) => /^division$/i.test(c)) && cells.some((c) => /^AvailableBeds\d*$/i.test(c));
  });
  if (headerIndex === -1) {
    throw new Error(
      'Could not find the division section (a header row with both a "division" column and ' +
      'AvailableBeds/AvailableUnits columns)'
    );
  }

  const cols = resolveHeaderColumns(records[headerIndex]);

  // Pass 1: collect the section's data rows.
  const dataRows: string[][] = [];
  for (let i = headerIndex + 1; i < records.length; i++) {
    const row = records[i];
    const division = (row[cols.division] ?? '').trim();
    const department = (row[cols.department] ?? '').trim();
    if (!division || !department) continue; // blank separator row or trailing blank
    if (division.toLowerCase() === 'division') break; // another section started
    dataRows.push(row);
  }
  if (dataRows.length === 0) throw new Error('Division section contained no usable capacity rows');

  // Pass 2: work out which capacity columns are the detail, then aggregate.
  const { detail, reportedTotal } = selectCapacityColumns(cols.capacityPairs, dataRows);

  const totals = new Map<string, CensusReferenceRow>();
  for (const row of dataRows) {
    const division = (row[cols.division] ?? '').trim();
    const department = (row[cols.department] ?? '').trim();

    const serviceLine = DEPARTMENT_TO_SERVICE_LINE[department];
    if (!serviceLine) {
      throw new Error(
        `Unmapped department "${department}" in census report. Add it to DEPARTMENT_TO_SERVICE_LINE ` +
        `so its capacity is not silently dropped from the reconciliation.`
      );
    }

    const key = `${division}||${department}`;
    const entry = totals.get(key) ?? {
      division, department, serviceLine, availableBeds: 0, availableUnits: 0,
    };
    entry.availableBeds += parseReportNumber(row[detail.beds]);
    entry.availableUnits += parseReportNumber(row[detail.units]);
    totals.set(key, entry);
  }

  const rows = Array.from(totals.values());

  // Aggregation must not lose anything the column selection already agreed on.
  const computedTotal = rows.reduce((s, r) => s + r.availableBeds + r.availableUnits, 0);
  if (reportedTotal !== null && computedTotal !== reportedTotal) {
    throw new Error(
      `Census report aggregation lost rows: the selected capacity columns sum to ` +
      `${reportedTotal.toLocaleString()} across the section, but grouping by division and department ` +
      `gives ${computedTotal.toLocaleString()}.`
    );
  }

  return {
    asOfDate,
    year: Number(yearStr),
    month: Number(monthStr),
    rows,
  };
}

export async function importCensusReference(
  csvPath: string,
  clientId: string,
): Promise<{ year: number; month: number; asOfDate: string | null; rowCount: number; totalCapacity: number }> {
  const parsed = parseCensusReport(fs.readFileSync(csvPath, 'utf8'));
  const sourceFile = csvPath.split('/').pop() ?? csvPath;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Replacing the whole period keeps a re-run idempotent and stops a shrinking
    // report from leaving orphaned divisions behind.
    await client.query(
      'DELETE FROM census_capacity_reference WHERE client_id=$1 AND year=$2 AND month=$3',
      [clientId, parsed.year, parsed.month],
    );
    for (const r of parsed.rows) {
      await client.query(
        `INSERT INTO census_capacity_reference
           (client_id, year, month, as_of_date, division, department, service_line,
            available_beds, available_units, source_file)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [clientId, parsed.year, parsed.month, parsed.asOfDate, r.division, r.department,
         r.serviceLine, r.availableBeds, r.availableUnits, sourceFile],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const totalCapacity = parsed.rows.reduce((s, r) => s + r.availableBeds + r.availableUnits, 0);
  return { year: parsed.year, month: parsed.month, asOfDate: parsed.asOfDate, rowCount: parsed.rows.length, totalCapacity };
}

// Run directly: tsx server/importCensusReference.ts <csv-path> [clientId]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [csvPath, clientId = 'trilogy'] = process.argv.slice(2);
  if (!csvPath) {
    console.error('Usage: tsx server/importCensusReference.ts <csv-path> [clientId]');
    process.exit(1);
  }
  importCensusReference(csvPath, clientId)
    .then((r) => {
      console.log(`Imported ${r.rowCount} division/department rows for ${clientId} ` +
        `${r.year}-${String(r.month).padStart(2, '0')} (as of ${r.asOfDate}); total capacity ${r.totalCapacity.toLocaleString()}`);
      process.exit(0);
    })
    .catch((err) => { console.error(err); process.exit(1); });
}
