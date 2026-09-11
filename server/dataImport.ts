import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { db } from './db';
import {
  rentRollHistory,
  enquireData,
  locationMappings,
  competitiveSurveyData,
  rentRollData,
  locations,
  careLevelRates,
  type InsertRentRollHistory,
  type InsertEnquireData,
  type InsertLocationMapping,
  type InsertCompetitiveSurveyData,
} from '@shared/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { normalizeRoomType } from '@shared/roomTypes';
import { isMalformedMoveInDate } from './services/inhouseRatePlanning/historicalTurnover';

export interface ImportStats {
  totalRecords: number;
  successfulImports: number;
  failedImports: number;
  mappedRecords: number;
  unmappedRecords: number;
  errors: string[];
  warning?: string;
  columnWarning?: string;
  moveInDateValidation?: MoveInDateValidation;
}

export interface MoveInDateValidation {
  clientId: string | null;
  uploadMonth: string;
  malformedCount: number;
  sampleValues: string[];
}

const MOVE_IN_DATE_SAMPLE_LIMIT = 5;

function newMoveInDateValidation(
  clientId: string | undefined,
  uploadMonth: string,
): MoveInDateValidation {
  return {
    clientId: clientId ?? null,
    uploadMonth,
    malformedCount: 0,
    sampleValues: [],
  };
}

function recordMoveInDateValidation(
  validation: MoveInDateValidation,
  value: unknown,
): void {
  if (!isMalformedMoveInDate(value)) return;
  validation.malformedCount++;
  const raw = String(value).trim();
  if (
    validation.sampleValues.length < MOVE_IN_DATE_SAMPLE_LIMIT &&
    !validation.sampleValues.includes(raw)
  ) {
    validation.sampleValues.push(raw);
  }
}

function logMoveInDateValidation(validation: MoveInDateValidation): void {
  if (validation.malformedCount === 0) return;
  console.warn(
    `[rent-roll-import] malformed or unsupported move-in dates: ` +
    `client=${validation.clientId ?? 'unknown'} uploadMonth=${validation.uploadMonth} ` +
    `count=${validation.malformedCount} samples=${validation.sampleValues.join(', ')}`,
  );
}

/**
 * Verify the final table that quarterly planning reads.  The legacy importer
 * stages rows in rent_roll_history first, so callers must run this after the
 * history-to-current promotion rather than treating a successful staging
 * transaction as proof that the month is usable.
 */
export async function countPersistedRentRollRows(uploadMonth: string, clientId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(rentRollData)
    .where(and(
      eq(rentRollData.uploadMonth, uploadMonth),
      eq(rentRollData.clientId, clientId),
    ));
  return Number(result?.count ?? 0);
}

async function warnIfLegacyRentRollMonthIsEmpty(stats: ImportStats, uploadMonth: string, fileName: string): Promise<void> {
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(rentRollHistory)
    .where(eq(rentRollHistory.uploadMonth, uploadMonth));
  if (stats.successfulImports === 0 || Number(result?.count ?? 0) === 0) {
    stats.warning = `Rent-roll import warning: ${fileName} produced 0 staged rows for ${uploadMonth}. The month was not promoted into quarterly planning data; verify the source file and mappings, then re-upload it.`;
    console.warn(`[rent-roll-import] ${stats.warning}`);
  }
}

export interface MatrixCareRateProductLabelRow {
  line: number;
  location: string;
  serviceLine: string;
  roomNumber: string;
  levelOfCare1: string | null;
  actualLevel1: string | null;
  bedSpecialization1: string | null;
}

export interface RateProductLabelBackfillResult {
  clientId: string;
  uploadMonth: string;
  dryRun: boolean;
  sourceRows: number;
  matchedSourceRows: number;
  updatedRows: number;
  updatedFields: number;
  alreadyCompleteRows: number;
  unresolvedRows: number;
  unresolved: Array<{
    line?: number;
    location?: string;
    serviceLine?: string;
    roomNumber?: string;
    reason: string;
    tables?: string[];
  }>;
}

function sourceText(value: unknown): string | null {
  const text = value == null ? '' : String(value).trim();
  return text || null;
}

function matrixCareServiceLine(value: unknown): string {
  const service = String(value ?? '').trim().toUpperCase();
  if (service === 'HC/MC' || service.includes('HC/MC')) return 'HC/MC';
  if (service === 'HC/TCU' || service.includes('HC/TCU') || service.includes('TCU')) return 'HC';
  if (service === 'AL/MC' || service.includes('AL/MC') || (service.includes('AL') && service.includes('MC'))) return 'AL/MC';
  if (service.includes('HC') && /\bMC\b/.test(service)) return 'HC/MC';
  if (service === 'MC' || /\bMC\b/.test(service)) return 'AL/MC';
  if (service === 'HC' || service.includes('HC') || service.includes('SKILLED') || service.includes('SNF')) return 'HC';
  if (service === 'AL' || service.includes('AL')) return 'AL';
  if (service === 'VIL' || service.includes('VIL') || service.includes('VILLA') || service.includes('VILLAGE')) return 'VIL';
  if (service === 'SL' || service === 'IL' || service.includes('IL_')) return 'SL';
  if (service.includes('SL')) return 'SL';
  if (service.includes('PATIO')) return 'Patio Homes';
  return service || 'AL';
}

function matrixCareRowValue(row: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') {
      return row[name];
    }
  }
  return null;
}

/**
 * Read the original MatrixCare export without changing the database. Keeping
 * this parser separate lets the repair endpoint support both the CSV files
 * used by the legacy importer and the original XLS/XLSX workbook when one is
 * still available.
 */
export function parseMatrixCareRateProductLabelRows(
  fileBuffer: Buffer,
  fileName = '',
): MatrixCareRateProductLabelRow[] {
  const isWorkbook = /\.(xlsx?|xlsm)$/i.test(fileName) ||
    fileBuffer.subarray(0, 2).toString('latin1') === 'PK';
  let rows: Array<Record<string, unknown>>;

  if (isWorkbook) {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }) : [];
  } else {
    const parsed = Papa.parse<Record<string, unknown>>(fileBuffer.toString('utf8'), {
      header: true,
      skipEmptyLines: true,
    });
    if (parsed.errors.length > 0) {
      throw new Error(`CSV parsing failed: ${parsed.errors[0].message}`);
    }
    rows = parsed.data;
  }

  return rows.map((row, index) => ({
    line: index + 2,
    location: String(matrixCareRowValue(row, 'location', 'Location') ?? '').trim(),
    serviceLine: matrixCareServiceLine(matrixCareRowValue(row, 'Service1', 'Service Line', 'service_line')),
    roomNumber: String(matrixCareRowValue(row, 'Room_Bed', 'Room Number', 'room_number') ?? '').trim(),
    levelOfCare1: sourceText(matrixCareRowValue(row, 'LevelOfCare1', 'Level of Care', 'level_of_care')),
    actualLevel1: sourceText(matrixCareRowValue(row, 'ActualLevel1', 'Actual Level', 'actual_level')),
    bedSpecialization1: sourceText(matrixCareRowValue(row, 'BedSpecialization1', 'Bed Specialization', 'bed_specialization')),
  }));
}

function rateProductLabelKey(location: string, serviceLine: string, roomNumber: string): string {
  return `${location.trim().toLowerCase()}|${serviceLine.trim().toUpperCase()}|${roomNumber.trim().toUpperCase()}`;
}

function legacyRateProductLabelKey(location: string, serviceLine: string, roomNumber: string): string {
  const legacyRoomNumber = roomNumber.split('/')[0]?.trim() || roomNumber.trim();
  return rateProductLabelKey(location, serviceLine, legacyRoomNumber);
}

function sameSourceLabels(a: MatrixCareRateProductLabelRow, b: MatrixCareRateProductLabelRow): boolean {
  return a.levelOfCare1 === b.levelOfCare1 &&
    a.actualLevel1 === b.actualLevel1 &&
    a.bedSpecialization1 === b.bedSpecialization1;
}

/**
 * Restore labels that were present in the MatrixCare source but lost during
 * older imports. A source row is only applied when its location/service-line/
 * room identity resolves to one row in each tenant-owned table. Existing
 * values are fill-only: this repair never replaces a value already recorded.
 */
export async function backfillMatrixCareRateProductLabels(
  fileBuffer: Buffer,
  uploadMonth: string,
  clientId: string,
  options: { fileName?: string; dryRun?: boolean } = {},
): Promise<RateProductLabelBackfillResult> {
  const sourceRows = parseMatrixCareRateProductLabelRows(fileBuffer, options.fileName);
  const dryRun = options.dryRun !== false;
  const unresolved: RateProductLabelBackfillResult['unresolved'] = [];
  const grouped = new Map<string, MatrixCareRateProductLabelRow[]>();

  for (const row of sourceRows) {
    if (!row.location || !row.roomNumber) {
      unresolved.push({
        line: row.line,
        location: row.location,
        serviceLine: row.serviceLine,
        roomNumber: row.roomNumber,
        reason: 'source_row_missing_location_or_room_identity',
      });
      continue;
    }
    const key = rateProductLabelKey(row.location, row.serviceLine, row.roomNumber);
    const group = grouped.get(key) || [];
    group.push(row);
    grouped.set(key, group);
  }

  return await db.transaction(async (tx) => {
    const currentRows = await tx
      .select({
        id: rentRollData.id,
        location: rentRollData.location,
        serviceLine: rentRollData.serviceLine,
        roomNumber: rentRollData.roomNumber,
        levelOfCare: rentRollData.levelOfCare,
        careLevel: rentRollData.careLevel,
        otherPremiumFeature: rentRollData.otherPremiumFeature,
      })
      .from(rentRollData)
      .where(and(
        eq(rentRollData.clientId, clientId),
        eq(rentRollData.uploadMonth, uploadMonth),
      ));

    // rent_roll_history predates tenant ownership. Only rows whose location
    // is currently owned by this client are eligible for a repair.
    const historyRows = await tx
      .select({
        id: rentRollHistory.id,
        location: rentRollHistory.location,
        serviceLine: rentRollHistory.serviceLine,
        roomNumber: rentRollHistory.roomNumber,
        levelOfCare: rentRollHistory.levelOfCare,
        careLevel: rentRollHistory.careLevel,
        otherPremiumFeature: rentRollHistory.otherPremiumFeature,
      })
      .from(rentRollHistory)
      .innerJoin(locations, eq(rentRollHistory.locationId, locations.id))
      .where(and(
        eq(rentRollHistory.uploadMonth, uploadMonth),
        eq(locations.clientId, clientId),
      ));

    const currentByKey = new Map<string, typeof currentRows>();
    const historyByKey = new Map<string, typeof historyRows>();
    const currentByLegacyKey = new Map<string, typeof currentRows>();
    const historyByLegacyKey = new Map<string, typeof historyRows>();
    for (const row of currentRows) {
      const key = rateProductLabelKey(row.location, row.serviceLine, row.roomNumber);
      currentByKey.set(key, [...(currentByKey.get(key) || []), row]);
      const legacyKey = legacyRateProductLabelKey(row.location, row.serviceLine, row.roomNumber);
      currentByLegacyKey.set(legacyKey, [...(currentByLegacyKey.get(legacyKey) || []), row]);
    }
    for (const row of historyRows) {
      const key = rateProductLabelKey(row.location, row.serviceLine, row.roomNumber);
      historyByKey.set(key, [...(historyByKey.get(key) || []), row]);
      const legacyKey = legacyRateProductLabelKey(row.location, row.serviceLine, row.roomNumber);
      historyByLegacyKey.set(legacyKey, [...(historyByLegacyKey.get(legacyKey) || []), row]);
    }
    const sourceByLegacyKey = new Map<string, MatrixCareRateProductLabelRow[]>();
    for (const row of sourceRows) {
      if (!row.location || !row.roomNumber) continue;
      const legacyKey = legacyRateProductLabelKey(row.location, row.serviceLine, row.roomNumber);
      sourceByLegacyKey.set(legacyKey, [...(sourceByLegacyKey.get(legacyKey) || []), row]);
    }

    let matchedSourceRows = 0;
    let updatedRows = 0;
    let updatedFields = 0;
    let alreadyCompleteRows = 0;
    const pendingUpdates: Array<{
      table: 'rent_roll_data' | 'rent_roll_history';
      id: string;
      levelOfCare: string | null;
      careLevel: string | null;
      otherPremiumFeature: string | null;
    }> = [];

    for (const [key, candidates] of Array.from(grouped.entries())) {
      const source = candidates[0];
      const legacyKey = legacyRateProductLabelKey(source.location, source.serviceLine, source.roomNumber);
      const legacySources = sourceByLegacyKey.get(legacyKey) || [];

      if (candidates.some((candidate: MatrixCareRateProductLabelRow) => !sameSourceLabels(candidate, source))) {
        unresolved.push({
          line: source.line,
          location: source.location,
          serviceLine: source.serviceLine,
          roomNumber: source.roomNumber,
          reason: 'conflicting_source_rows_for_same_unit',
        });
        continue;
      }
      if (!source.levelOfCare1 && !source.actualLevel1 && !source.bedSpecialization1) {
        unresolved.push({
          line: source.line,
          location: source.location,
          serviceLine: source.serviceLine,
          roomNumber: source.roomNumber,
          reason: 'source_row_has_no_recoverable_rate_product_labels',
        });
        continue;
      }

      const canUseLegacyRoomIdentity = source.roomNumber.includes('/');
      const tables: Array<{
        name: 'rent_roll_data' | 'rent_roll_history';
        rows: any[];
        usingLegacyRoomIdentity: boolean;
      }> = [
        {
          name: 'rent_roll_data',
          rows: currentByKey.get(key) || [],
          usingLegacyRoomIdentity: false,
        },
        {
          name: 'rent_roll_history',
          rows: historyByKey.get(key) || [],
          usingLegacyRoomIdentity: false,
        },
      ];

      // Resolve exact-vs-legacy identities independently for each destination
      // table. A promoted current row can retain "101/A" while its historical
      // counterpart still stores "101", and both must be considered.
      for (const table of tables) {
        if (table.rows.length === 0 && canUseLegacyRoomIdentity) {
          table.rows = table.name === 'rent_roll_data'
            ? currentByLegacyKey.get(legacyKey) || []
            : historyByLegacyKey.get(legacyKey) || [];
          table.usingLegacyRoomIdentity = table.rows.length > 0;
        }
      }

      const missingTables = tables.filter((table) => table.rows.length === 0);
      if (missingTables.length > 0) {
        unresolved.push({
          line: source.line,
          location: source.location,
          serviceLine: source.serviceLine,
          roomNumber: source.roomNumber,
          reason: 'no_tenant_owned_row_for_upload_month',
          tables: missingTables.map((table) => table.name),
        });
      }

      let matchedThisSource = false;
      for (const table of tables.filter((candidate) => candidate.rows.length > 0)) {
        if (table.usingLegacyRoomIdentity &&
          legacySources.some((candidate) => !sameSourceLabels(candidate, legacySources[0]))) {
          unresolved.push({
            line: source.line,
            location: source.location,
            serviceLine: source.serviceLine,
            roomNumber: source.roomNumber,
            reason: 'conflicting_source_rows_for_legacy_room_identity',
            tables: [table.name],
          });
          continue;
        }
        if (table.usingLegacyRoomIdentity && legacySources[0] !== source) {
          // Identical A/B source rows resolve to one legacy target. Process
          // the fallback target once so the write batch has no duplicate IDs.
          continue;
        }
        if (table.rows.length > 1) {
          unresolved.push({
            line: source.line,
            location: source.location,
            serviceLine: source.serviceLine,
            roomNumber: source.roomNumber,
            reason: 'multiple_tenant_rows_match_source_identity',
            tables: [table.name],
          });
          continue;
        }

        matchedThisSource = true;
        const target = table.rows[0];
        const patch: Record<string, string> = {};
        if (!target.levelOfCare && (source.levelOfCare1 || source.actualLevel1)) {
          patch.levelOfCare = source.levelOfCare1 || source.actualLevel1!;
        }
        if (!target.careLevel && (source.actualLevel1 || source.levelOfCare1)) {
          patch.careLevel = source.actualLevel1 || source.levelOfCare1!;
        }
        if (!target.otherPremiumFeature && source.bedSpecialization1) {
          patch.otherPremiumFeature = source.bedSpecialization1;
        }

        if (Object.keys(patch).length === 0) {
          alreadyCompleteRows++;
          continue;
        }
        updatedRows++;
        updatedFields += Object.keys(patch).length;
        if (!dryRun) {
          pendingUpdates.push({
            table: table.name,
            id: target.id,
            levelOfCare: patch.levelOfCare || null,
            careLevel: patch.careLevel || null,
            otherPremiumFeature: patch.otherPremiumFeature || null,
          });
        }
      }
      if (matchedThisSource) matchedSourceRows++;
    }

    if (!dryRun && pendingUpdates.length > 0) {
      for (const tableName of ['rent_roll_data', 'rent_roll_history'] as const) {
        const values = pendingUpdates
          .filter((update) => update.table === tableName)
          .map((update) => sql`(
            ${update.id},
            ${update.levelOfCare},
            ${update.careLevel},
            ${update.otherPremiumFeature}
          )`);
        const table = tableName === 'rent_roll_data'
          ? sql.raw('rent_roll_data')
          : sql.raw('rent_roll_history');
        for (let offset = 0; offset < values.length; offset += 5000) {
          const chunk = values.slice(offset, offset + 5000);
          await tx.execute(sql`
            UPDATE ${table} AS target
            SET
              level_of_care = CASE
                WHEN NULLIF(BTRIM(target.level_of_care), '') IS NULL
                  THEN COALESCE(source.level_of_care, target.level_of_care)
                ELSE target.level_of_care
              END,
              care_level = CASE
                WHEN NULLIF(BTRIM(target.care_level), '') IS NULL
                  THEN COALESCE(source.care_level, target.care_level)
                ELSE target.care_level
              END,
              other_premium_feature = CASE
                WHEN NULLIF(BTRIM(target.other_premium_feature), '') IS NULL
                  THEN COALESCE(source.other_premium_feature, target.other_premium_feature)
                ELSE target.other_premium_feature
              END
            FROM (VALUES ${sql.join(chunk, sql`, `)})
              AS source(id, level_of_care, care_level, other_premium_feature)
            WHERE target.id = source.id
          `);
        }
      }
    }

    return {
      clientId,
      uploadMonth,
      dryRun,
      sourceRows: sourceRows.length,
      matchedSourceRows,
      updatedRows,
      updatedFields,
      alreadyCompleteRows,
      unresolvedRows: unresolved.length,
      unresolved,
    };
  });
}

interface SurveyRoomType {
  name: string;
  rate: any;
  careLevel: any;
  otherAdj: any;
  weight: any;
}

interface SurveyServiceLine {
  type: string;
  targetServiceLine?: string;
  flag: any;
  careLevel1?: number | null;
  careLevel2?: number | null;
  careLevel3?: number | null;
  careLevel4?: number | null;
  medicationManagement?: number | null;
  roomTypes: SurveyRoomType[];
  occupancy: any;
  totalUnits: any;
}

export async function importRentRollCSV(
  fileBuffer: Buffer,
  uploadMonth: string,
  fileName: string,
  clientId?: string
): Promise<ImportStats> {
  const stats: ImportStats = {
    totalRecords: 0,
    successfulImports: 0,
    failedImports: 0,
    mappedRecords: 0,
    unmappedRecords: 0,
    errors: [],
    moveInDateValidation: newMoveInDateValidation(clientId, uploadMonth),
  };

  return new Promise((resolve) => {
    const fileContent = fileBuffer.toString('utf-8');

    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      complete: async (results: Papa.ParseResult<any>) => {
        stats.totalRecords = results.data.length;

        try {
          await db.transaction(async (tx) => {
            await tx.delete(rentRollHistory).where(eq(rentRollHistory.uploadMonth, uploadMonth));

            const allLocations = await tx.select().from(locations);
            const locationMap = new Map(allLocations.map(loc => [loc.name.toLowerCase(), loc.id]));

            for (const row of results.data as any[]) {
              try {
                const locationName = row['Location'] || row['location'] || '';
                const locationId = locationMap.get(locationName.toLowerCase());

                const moveInDate = row['Move In Date'] || row['move_in_date'] || null;
                recordMoveInDateValidation(stats.moveInDateValidation!, moveInDate);

                const record: InsertRentRollHistory = {
                  uploadMonth,
                  date: row['Date'] || row['date'] || uploadMonth,
                  location: locationName,
                  locationId: locationId || null,
                  roomNumber: row['Room Number'] || row['room_number'] || '',
                  roomType: normalizeRoomType(row['Room Type'] || row['room_type'] || ''),
                  serviceLine: row['Service Line'] || row['service_line'] || '',
                  occupiedYN: parseBoolean(row['Occupied Y/N'] || row['occupied_yn']),
                  daysVacant: parseInt(row['Days Vacant'] || row['days_vacant']) || 0,
                  preferredLocation: row['Preferred Location'] || row['preferred_location'] || null,
                  size: row['Size'] || row['size'] || '',
                  view: row['View'] || row['view'] || null,
                  renovated: parseBoolean(row['Renovated'] || row['renovated']),
                  otherPremiumFeature: row['Other Premium Feature'] || row['other_premium_feature'] || null,
                  locationRating: row['Location Rating'] || row['location_rating'] || null,
                  sizeRating: row['Size Rating'] || row['size_rating'] || null,
                  viewRating: row['View Rating'] || row['view_rating'] || null,
                  renovationRating: row['Renovation Rating'] || row['renovation_rating'] || null,
                  amenityRating: row['Amenity Rating'] || row['amenity_rating'] || null,
                  streetRate: parseFloat(row['Street Rate'] || row['street_rate']) || 0,
                  inHouseRate: parseFloat(row['In-House Rate'] || row['in_house_rate']) || 0,
                  discountToStreetRate: parseFloat(row['Discount to Street Rate'] || row['discount_to_street_rate']) || null,
                  careLevel: row['Care Level'] || row['care_level'] || null,
                  careRate: parseFloat(row['Care Rate'] || row['care_rate']) || null,
                  rentAndCareRate: parseFloat(row['Rent and Care Rate'] || row['rent_and_care_rate']) || null,
                  competitorRate: parseFloat(row['Competitor Rate'] || row['competitor_rate']) || null,
                  competitorAvgCareRate: parseFloat(row['Competitor Avg Care Rate'] || row['competitor_avg_care_rate']) || null,
                  competitorFinalRate: parseFloat(row['Competitor Final Rate'] || row['competitor_final_rate']) || null,
                  residentId: row['Resident ID'] || row['resident_id'] || null,
                  residentName: row['Resident Name'] || row['resident_name'] || null,
                  moveInDate,
                  moveOutDate: (() => {
                    const dv = parseInt(row['Days Vacant'] || row['days_vacant']) || 0;
                    const occupied = parseBoolean(row['Occupied Y/N'] || row['occupied_yn']);
                    if (!occupied && dv > 0) {
                      const refDate = new Date(row['Date'] || row['date'] || uploadMonth);
                      refDate.setDate(refDate.getDate() - dv);
                      return refDate.toISOString().split('T')[0];
                    }
                    return null;
                  })(),
                  payorType: row['DisplayPayer'] || row['PayerName'] || row['Payor Type'] || row['payor_type'] || row['Payer'] || row['payer'] || row['Payor'] || row['payor'] || null,
                  admissionStatus: row['Admission Status'] || row['admission_status'] || null,
                  levelOfCare: row['Level of Care'] || row['level_of_care'] || null,
                  medicaidRate: parseFloat(row['Medicaid Rate'] || row['medicaid_rate']) || null,
                  medicareRate: parseFloat(row['Medicare Rate'] || row['medicare_rate']) || null,
                  assessmentDate: row['Assessment Date'] || row['assessment_date'] || null,
                  marketingSource: row['Marketing Source'] || row['marketing_source'] || null,
                };

                await tx.insert(rentRollHistory).values(record);
                stats.successfulImports++;
                if (locationId) {
                  stats.mappedRecords++;
                } else {
                  stats.unmappedRecords++;
                }
              } catch (error: any) {
                stats.failedImports++;
                stats.errors.push(`Row ${stats.successfulImports + stats.failedImports}: ${error.message}`);
              }
            }
          });
        } catch (txError: any) {
          stats.errors.push(`Transaction error: ${txError.message}`);
        }

        logMoveInDateValidation(stats.moveInDateValidation!);
        await warnIfLegacyRentRollMonthIsEmpty(stats, uploadMonth, fileName);
        resolve(stats);
      },
      error: (error: Error) => {
        stats.errors.push(`CSV parsing error: ${error.message}`);
        resolve(stats);
      },
    });
  });
}

export async function importEnquireCSV(
  fileBuffer: Buffer,
  dataSource: 'Senior Housing' | 'Post Acute'
): Promise<ImportStats> {
  const stats: ImportStats = {
    totalRecords: 0,
    successfulImports: 0,
    failedImports: 0,
    mappedRecords: 0,
    unmappedRecords: 0,
    errors: [],
  };

  return new Promise((resolve) => {
    // Try UTF-8 first, fallback to latin1 if needed
    let fileContent: string;
    try {
      fileContent = fileBuffer.toString('utf-8');
      // Test if it's valid by checking for replacement characters
      if (fileContent.includes('�')) {
        throw new Error('Invalid UTF-8');
      }
    } catch (e) {
      fileContent = fileBuffer.toString('latin1');
    }

    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      complete: async (results: Papa.ParseResult<any>) => {
        stats.totalRecords = results.data.length;
        console.log(`Parsing ${stats.totalRecords} records from Enquire CSV`);

        try {
          await db.transaction(async (tx) => {
            const existingMappings = await tx.select().from(locationMappings).where(eq(locationMappings.sourceSystem, 'enquire'));
            const mappingMap = new Map(existingMappings.map(m => [m.sourceLocation.toLowerCase(), m]));

            const existingInquiryIds = new Set(
              (await tx.selectDistinct({ id: enquireData.inquiryId }).from(enquireData).where(eq(enquireData.dataSource, dataSource)))
                .map(r => r.id)
                .filter((id): id is string => id !== null)
            );

            for (const row of results.data as any[]) {
              try {
                // Handle new CSV format from Enquire export
                const enquireLocation = row['Location'] || row['location'] || row['Facility'] || row['facility'] || '';
                const mapping = mappingMap.get(enquireLocation.toLowerCase());

                // Extract inquiry ID from Link URL if available
                let inquiryId = null;
                const linkUrl = row['Link'] || '';
                const idMatch = linkUrl.match(/details\/(\d+)/);
                if (idMatch) {
                  inquiryId = idMatch[1];
                }

                const record: InsertEnquireData = {
                  dataSource,
                  enquireLocation,
                  mappedLocationId: mapping?.targetLocationId || null,
                  mappedServiceLine: mapping?.defaultServiceLine || null,
                  inquiryId: inquiryId || row['Inquiry ID'] || row['inquiry_id'] || row['ID'] || row['id'] || null,
                  inquiryDate: row['Inquiry Date'] || row['inquiry_date'] || row['Date'] || row['date'] || null,
                  tourDate: row['Tour Date'] || row['tour_date'] || row['UserLocalActivityStartDate'] || null,
                  moveInDate: row['Move In Date'] || row['move_in_date'] || row['UserLocalActivityCompletedDate'] || null,
                  leadSource: row['Individual Market Source'] || row['Lead Source'] || row['lead_source'] || row['Source'] || row['source'] || null,
                  leadStatus: row['SaleStage'] || row['Lead Status'] || row['lead_status'] || row['Status'] || row['status'] || null,
                  prospectName: row['Prospect Name'] || row['prospect_name'] || row['Name'] || row['name'] || null,
                  careNeeds: row['Individual Care'] || row['Care Needs'] || row['care_needs'] || null,
                  budgetRange: row['Budget Range'] || row['budget_range'] || null,
                  desiredMoveInDate: row['Desired Move In Date'] || row['desired_move_in_date'] || null,
                  roomTypePreference: row['Room Type'] || row['room_type'] || null,
                  notes: row['Activity Name'] || row['Notes'] || row['notes'] || null,
                  rawData: row,
                };

                if (record.inquiryId && !existingInquiryIds.has(record.inquiryId)) {
                  await tx.insert(enquireData).values(record);
                  stats.successfulImports++;
                  if (mapping) {
                    stats.mappedRecords++;
                  } else {
                    stats.unmappedRecords++;
                  }
                } else if (!record.inquiryId) {
                  await tx.insert(enquireData).values(record);
                  stats.successfulImports++;
                  if (mapping) {
                    stats.mappedRecords++;
                  } else {
                    stats.unmappedRecords++;
                  }
                } else {
                  stats.errors.push(`Duplicate inquiry ID: ${record.inquiryId}`);
                }
              } catch (error: any) {
                stats.failedImports++;
                stats.errors.push(`Row ${stats.successfulImports + stats.failedImports}: ${error.message}`);
              }
            }
          });
        } catch (txError: any) {
          stats.errors.push(`Transaction error: ${txError.message}`);
        }

        resolve(stats);
      },
      error: (error: Error) => {
        stats.errors.push(`CSV parsing error: ${error.message}`);
        resolve(stats);
      },
    });
  });
}

export async function importCompetitiveSurveyCSV(fileBuffer: Buffer, surveyMonth: string, clientId: string = 'demo'): Promise<ImportStats> {
  const stats: ImportStats = {
    totalRecords: 0,
    successfulImports: 0,
    failedImports: 0,
    mappedRecords: 0,
    unmappedRecords: 0,
    errors: [],
  };

  return new Promise((resolve) => {
    // Try UTF-8 first, fallback to latin1 if needed
    let fileContent: string;
    try {
      fileContent = fileBuffer.toString('utf-8');
    } catch (e) {
      fileContent = fileBuffer.toString('latin1');
    }

    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      complete: async (results: Papa.ParseResult<any>) => {
        stats.totalRecords = results.data.length;
        console.log(`Parsed ${stats.totalRecords} rows from CSV`);

        const insertCounts = { AL: 0, HC: 0, SMC: 0, MC: 0, IL: 0, IL_Villa: 0, IL_IL: 0, 'AL/MC': 0, 'HC/MC': 0 };
        const allRecords: InsertCompetitiveSurveyData[] = [];

        try {
          // First, collect all records (no database operations yet)
          for (const row of results.data) {
            try {
                const trilogyCampus = row['TrilogyCampusName'] || '';
                const competitorName = row['CompetitorFacilityName'] || '';
                const address = row['Address'] || null;
                const latitude = row['Latitude'] || null;
                const longitude = row['Longitude'] || null;

                // Parse driving time
                let distanceMiles: number | null = null;
                if (row['DrivingTime']) {
                  const timeMatch = String(row['DrivingTime']).match(/(\d+)/);
                  if (timeMatch) {
                    distanceMiles = parseInt(timeMatch[1]);
                  }
                }

                // Helper to check boolean flags
                const isFlagTrue = (value: any): boolean => {
                  if (value === true || value === 1) return true;
                  if (typeof value === 'string') {
                    const lower = value.toLowerCase().trim();
                    return lower === 'true' || lower === '1' || lower === 'yes';
                  }
                  return false;
                };

                // Returns the first column value that parses to a finite non-zero number, or null.
                // Avoids the JS truthy pitfall where "0" is truthy but represents no rate,
                // and guards against non-numeric strings like "N/A" where parseFloat yields NaN.
                const getFirstNonZeroRate = (...cols: any[]): string | null => {
                  for (const col of cols) {
                    const n = parseFloat(col);
                    if (Number.isFinite(n) && n !== 0) return String(col);
                  }
                  return null;
                };

                // Helper to parse numeric values safely
                // Non-numeric strings (e.g. "yes") are treated as 0, not null,
                // so they don't accidentally carry through as a non-zero care rate.
                const parseNumeric = (value: any): number | null => {
                  if (value === null || value === undefined || value === '') return null;
                  const cleaned = String(value).trim().replace(/[\$,\s]/g, '');
                  if (!cleaned) return null;
                  const parsed = parseFloat(cleaned);
                  return isNaN(parsed) ? 0 : parsed;
                };

                // Helper to get first non-null value from multiple column names
                const getColumn = (...names: string[]): any => {
                  for (const name of names) {
                    if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
                      return row[name];
                    }
                  }
                  return null;
                };

                // Service line definitions
                // IL data is split: "IL_Villa" prefix for VIL service line, "IL_IL" prefix for SL service line
                // Both use the same IL flag to indicate if competitor has Independent Living
                const serviceLines: SurveyServiceLine[] = [
                  {
                    type: 'IL_Villa',
                    targetServiceLine: 'VIL',
                    flag: getColumn('IL flag', 'IL'),  // Check IL flag (common for both Villa and SL)
                    careLevel1: parseNumeric(getColumn('IL_Level1')),
                    careLevel2: parseNumeric(getColumn('IL_Level2')),
                    careLevel3: parseNumeric(getColumn('IL_Level3')),
                    careLevel4: parseNumeric(getColumn('IL_Level4')),
                    medicationManagement: parseNumeric(getColumn('IL_MedicationManagement')),
                    roomTypes: [
                      { name: 'Studio', rate: getColumn('IL_VillaStudioPrivateRoomRate', 'IL_Villa_StudioRate'), careLevel: getColumn('IL_Comp_Care_Adj'), otherAdj: getColumn('IL_Comp_Other_Adj'), weight: getColumn('IL_Comp_Weight') },
                      { name: 'Companion', rate: getColumn('IL_VillaStudioCompanionRoomRate', 'IL_Villa_CompanionRate'), careLevel: getColumn('IL_Comp_Care_Adj'), otherAdj: getColumn('IL_Comp_Other_Adj'), weight: getColumn('IL_Comp_Weight') },
                      { name: 'One Bedroom', rate: getColumn('IL_Villa1BRPrivateRoomRate', 'IL_Villa_1BRRate'), careLevel: getColumn('IL_Comp_Care_Adj'), otherAdj: getColumn('IL_Comp_Other_Adj'), weight: getColumn('IL_Comp_Weight') },
                      { name: 'Two Bedroom', rate: getColumn('IL_Villa2BRPrivateRoomRate', 'IL_Villa_2BRRate'), careLevel: getColumn('IL_Comp_Care_Adj'), otherAdj: getColumn('IL_Comp_Other_Adj'), weight: getColumn('IL_Comp_Weight') },
                    ],
                    occupancy: getColumn('IL_Occupancy'),
                    totalUnits: getColumn('IL_TotalUnits'),
                  },
                  {
                    type: 'IL_IL',
                    targetServiceLine: 'SL',
                    flag: getColumn('IL flag', 'IL'),  // Check IL flag (common for both Villa and SL)
                    careLevel1: parseNumeric(getColumn('IL_Level1')),
                    careLevel2: parseNumeric(getColumn('IL_Level2')),
                    careLevel3: parseNumeric(getColumn('IL_Level3')),
                    careLevel4: parseNumeric(getColumn('IL_Level4')),
                    medicationManagement: parseNumeric(getColumn('IL_MedicationManagement')),
                    roomTypes: [
                      { name: 'Studio', rate: getColumn('IL_ILStudioRoomRate', 'IL_IL_StudioRate'), careLevel: getColumn('IL_Comp_Care_Adj'), otherAdj: getColumn('IL_Comp_Other_Adj'), weight: getColumn('IL_Comp_Weight') },
                      { name: 'One Bedroom', rate: getColumn('IL_IL1BRRoomRate', 'IL_IL_1BRRate'), careLevel: getColumn('IL_Comp_Care_Adj'), otherAdj: getColumn('IL_Comp_Other_Adj'), weight: getColumn('IL_Comp_Weight') },
                      { name: 'Two Bedroom', rate: getColumn('IL_IL2BRRoomRate', 'IL_IL_2BRRate'), careLevel: getColumn('IL_Comp_Care_Adj'), otherAdj: getColumn('IL_Comp_Other_Adj'), weight: getColumn('IL_Comp_Weight') },
                    ],
                    occupancy: getColumn('IL_Occupancy'),
                    totalUnits: getColumn('IL_TotalUnits'),
                  },
                  {
                    type: 'AL',
                    flag: row['AL flag'] || row['AL'],
                    careLevel1: parseNumeric(row['AL_Level1']),
                    careLevel2: parseNumeric(row['AL_Level2']),
                    careLevel3: parseNumeric(row['AL_Level3']),
                    careLevel4: parseNumeric(row['AL_Level4']),
                    medicationManagement: parseNumeric(row['AL_MedicationManagement']),
                    roomTypes: [
                      { name: 'Studio', rate: row['AL_StudioRate'] || row['AL_StudioPrivateRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                      { name: 'Studio Dlx', rate: row['AL_StudioDeluxePrivateRoomRate'] || row['AL_StudioDlxRate'] || row['AL_StudioDeluxeRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                      { name: 'One Bedroom', rate: row['AL_OneBedRate'] || row['AL_1BRPrivateRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                      { name: 'Two Bedroom', rate: row['AL_TwoBedRate'] || row['AL_2BRPrivateRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                      { name: 'Companion', rate: row['AL_StudioCompanionRoomRate'] || row['AL_StudioCompanionRate'] || null, careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                      { name: 'One Bedroom Companion', rate: row['AL_1BRCompanionRoomRate'] || null, careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                      { name: 'Two Bedroom Companion', rate: row['AL_2BRCompanionRoomRate'] || null, careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                    ],
                    occupancy: row['AL_Occupancy'],
                    totalUnits: row['AL_TotalUnits'],
                  },
                  {
                    type: 'HC',
                    flag: row['HC flag'] || row['HC'],
                    careLevel1: parseNumeric(row['HC_Level1']),
                    careLevel2: parseNumeric(row['HC_Level2']),
                    careLevel3: parseNumeric(row['HC_Level3']),
                    careLevel4: parseNumeric(row['HC_Level4']),
                    medicationManagement: parseNumeric(row['HC_MedicationManagement']),
                    roomTypes: [
                      { name: 'Studio', rate: row['HC_PrivateRoomRate'], careLevel: row['HC_Comp_Care_Adj'], otherAdj: row['HC_Comp_Other_Adj'], weight: row['HC_Comp_Weight'] },
                      { name: 'Studio Dlx', rate: row['HC_PrivateDeluxeRoomRate'] || row['HC_PrivateDlxRoomRate'], careLevel: row['HC_Comp_Care_Adj'], otherAdj: row['HC_Comp_Other_Adj'], weight: row['HC_Comp_Weight'] },
                      { name: 'Companion', rate: row['HC_CompanionSemiPrivateRoomRate'] || null, careLevel: row['HC_Comp_Care_Adj'], otherAdj: row['HC_Comp_Other_Adj'], weight: row['HC_Comp_Weight'] },
                    ],
                    occupancy: row['HC_Occupancy'],
                    totalUnits: row['HC_TotalUnits'],
                  },
                  {
                    type: 'SMC',
                    flag: row['SMC flag'] || row['SMC'],
                    careLevel1: parseNumeric(row['SMC_Level1']),
                    careLevel2: parseNumeric(row['SMC_Level2']),
                    careLevel3: parseNumeric(row['SMC_Level3']),
                    careLevel4: parseNumeric(row['SMC_Level4']),
                    medicationManagement: parseNumeric(row['SMC_MedicationManagement']),
                    roomTypes: [
                      { name: 'Studio', rate: row['SMC_PrivateRoomRate'], careLevel: row['SMC_Comp_Care_Adj'], otherAdj: row['SMC_Comp_Other_Adj'], weight: row['SMC_Comp_Weight'] },
                      { name: 'Companion', rate: row['SMC_CompanionRoomRate'], careLevel: row['SMC_Comp_Care_Adj'], otherAdj: row['SMC_Comp_Other_Adj'], weight: row['SMC_Comp_Weight'] },
                    ],
                    occupancy: row['SMC_Occupancy'],
                    totalUnits: row['SMC_TotalUnits'],
                  },
                  {
                    type: 'MC',
                    flag: row['MC flag'] || row['MC'],
                    careLevel1: parseNumeric(row['MC_Level1']),
                    careLevel2: parseNumeric(row['MC_Level2']),
                    careLevel3: parseNumeric(row['MC_Level3']),
                    careLevel4: parseNumeric(row['MC_Level4']),
                    medicationManagement: parseNumeric(row['MC_MedicationManagement']),
                    roomTypes: [
                      { name: 'Studio', rate: row['MC_PrivateRate'], careLevel: row['MC_Comp_Care_Adj'], otherAdj: row['MC_Comp_Other_Adj'], weight: row['MC_Comp_Weight'] },
                      { name: 'Companion', rate: row['MC_CompanionRate'], careLevel: row['MC_Comp_Care_Adj'], otherAdj: row['MC_Comp_Other_Adj'], weight: row['MC_Comp_Weight'] },
                    ],
                    occupancy: null,
                    totalUnits: null,
                  },
                  {
                    type: 'AL/MC',
                    // Use isFlagTrue with both possible column names; fall back to rate-presence detection
                    flag: isFlagTrue(row['MC flag'] || row['MC']) || getFirstNonZeroRate(row['MC_ALStudioRoomRate'], row['AL/MC_PrivateRate'], row['AL/MC_StudioRate'], row['MC_ALCompanionRoomRate'], row['AL/MC_CompanionRate']) ? 'True' : 'False',
                    careLevel1: parseNumeric(row['AL/MC_Level1'] ?? row['AL_Level1']),
                    careLevel2: parseNumeric(row['MC_Level2'] ?? row['AL/MC_Level2'] ?? 0),
                    careLevel3: parseNumeric(row['AL/MC_Level3'] ?? row['AL_Level3']),
                    careLevel4: parseNumeric(row['AL/MC_Level4'] ?? row['AL_Level4']),
                    medicationManagement: parseNumeric(row['MC_MedicationManagement']),
                    roomTypes: [
                      { name: 'Studio', rate: getFirstNonZeroRate(row['AL/MC_PrivateRate'], row['AL/MC_StudioRate'], row['MC_ALStudioRoomRate']), careLevel: row['AL/MC_Comp_Care_Adj'], otherAdj: row['AL/MC_Comp_Other_Adj'], weight: row['AL/MC_Comp_Weight'] },
                      { name: 'Companion', rate: getFirstNonZeroRate(row['MC_ALCompanionRoomRate'], row['AL/MC_CompanionRate']), careLevel: row['AL/MC_Comp_Care_Adj'], otherAdj: row['AL/MC_Comp_Other_Adj'], weight: row['AL/MC_Comp_Weight'] },
                    ],
                    occupancy: null,
                    totalUnits: null,
                  },
                  {
                    type: 'HC/MC',
                    // Use isFlagTrue with both possible column names; fall back to rate-presence detection
                    flag: isFlagTrue(row['SMC flag'] || row['SMC']) || getFirstNonZeroRate(row['HC/MC_PrivateRate'], row['SMC_PrivateRoomRate'], row['HC/MC_CompanionRate'], row['SMC_CompanionRoomRate']) ? 'True' : 'False',
                    careLevel1: parseNumeric(row['HC/MC_Level1'] ?? row['HC_Level1']),
                    careLevel2: parseNumeric(row['SMC_Level2'] ?? row['HC/MC_Level2'] ?? 0),
                    careLevel3: parseNumeric(row['HC/MC_Level3'] ?? row['HC_Level3']),
                    careLevel4: parseNumeric(row['HC/MC_Level4'] ?? row['HC_Level4']),
                    medicationManagement: parseNumeric(row['HC/MC_MedicationManagement'] ?? row['SMC_MedicationManagement']),
                    roomTypes: [
                      { name: 'Studio', rate: getFirstNonZeroRate(row['HC/MC_PrivateRate'], row['SMC_PrivateRoomRate']), careLevel: row['HC/MC_Comp_Care_Adj'], otherAdj: row['HC/MC_Comp_Other_Adj'], weight: row['HC/MC_Comp_Weight'] },
                      { name: 'Companion', rate: getFirstNonZeroRate(row['HC/MC_CompanionRate'], row['SMC_CompanionRoomRate']), careLevel: row['HC/MC_Comp_Care_Adj'], otherAdj: row['HC/MC_Comp_Other_Adj'], weight: row['HC/MC_Comp_Weight'] },
                    ],
                    occupancy: null,
                    totalUnits: null,
                  },
                ];

                // Process each service line
                for (const serviceLine of serviceLines) {
                  if (!isFlagTrue(serviceLine.flag)) continue;

                  for (const roomType of serviceLine.roomTypes) {
                    if (!roomType.rate || parseFloat(roomType.rate) === 0) continue;

                    const dbType = serviceLine.targetServiceLine === 'VIL' ? 'IL_Villa' 
                                 : serviceLine.targetServiceLine === 'SL' ? 'IL_IL' 
                                 : serviceLine.type;
                    const record: InsertCompetitiveSurveyData = {
                      surveyMonth,
                      keyStatsLocation: trilogyCampus,
                      competitorName,
                      competitorAddress: address,
                      distanceMiles,
                      competitorType: dbType,
                      roomType: roomType.name,
                      squareFootage: null,
                      monthlyRateLow: null,
                      monthlyRateHigh: null,
                      monthlyRateAvg: parseFloat(roomType.rate) || null,
                      careFeesLow: null,
                      careFeesHigh: null,
                      careFeesAvg: null,
                      careLevel1Rate: serviceLine.careLevel1 ?? null,
                      careLevel2Rate: serviceLine.careLevel2 ?? null,
                      careLevel3Rate: serviceLine.careLevel3 ?? null,
                      careLevel4Rate: serviceLine.careLevel4 ?? null,
                      totalMonthlyLow: null,
                      totalMonthlyHigh: null,
                      totalMonthlyAvg: null,
                      communityFee: null,
                      petFee: null,
                      otherFees: parseFloat(roomType.otherAdj) || null,
                      incentives: null,
                      totalUnits: serviceLine.totalUnits ? parseInt(serviceLine.totalUnits) : null,
                      occupancyRate: serviceLine.occupancy ? parseFloat(serviceLine.occupancy) : null,
                      yearBuilt: row['Age'] ? parseInt(row['Age']) : null,
                      lastRenovation: null,
                      amenities: null,
                      lat: latitude ? parseFloat(latitude) : null,
                      lng: longitude ? parseFloat(longitude) : null,
                      medicationManagementFee: serviceLine.medicationManagement ?? null,
                      clientId,
                      notes: JSON.stringify({
                        weight: roomType.weight || 0,
                        latitude,
                        longitude,
                        providerId: row['ID'],
                        providerNumber: row['Provider Number'],
                        // Net care-adjustment override from the survey's *_Comp_Care_Adj
                        // columns. When non-zero this is used directly as the ADJ figure
                        // in the Competitor Management panel, bypassing the
                        // (their L2 − our L2) formula. Stored as a monthly dollar amount.
                        ...(parseFloat(roomType.careLevel) ? { careAdjOverride: parseFloat(roomType.careLevel) } : {}),
                      }),
                    };

                    allRecords.push(record);
                    insertCounts[serviceLine.type as keyof typeof insertCounts] = (insertCounts[serviceLine.type as keyof typeof insertCounts] || 0) + 1;
                  }
                }
              } catch (error: any) {
                stats.failedImports++;
                stats.errors.push(`Row ${stats.successfulImports + stats.failedImports}: ${error.message}`);
              }
            }

          console.log(`\nPrepared ${allRecords.length} records for insertion`);
          console.log('Starting database transaction...');

          // Now do a single batch insert in a transaction
          await db.transaction(async (tx) => {
            await tx.delete(competitiveSurveyData).where(and(eq(competitiveSurveyData.surveyMonth, surveyMonth), eq(competitiveSurveyData.clientId, clientId)));
            console.log('Deleted old survey data');

            // Insert in batches of 1000 to avoid memory issues
            const batchSize = 1000;
            for (let i = 0; i < allRecords.length; i += batchSize) {
              const batch = allRecords.slice(i, i + batchSize);
              await tx.insert(competitiveSurveyData).values(batch);
              console.log(`Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allRecords.length / batchSize)}`);
            }
          });

          stats.successfulImports = allRecords.length;
          stats.mappedRecords = allRecords.length;

          // Log summary (all service lines shown, including zeros, to surface future regressions)
          console.log('\n=== CSV Import Summary ===');
          console.log(`Records inserted by type:`);
          Object.entries(insertCounts).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
          });
        } catch (txError: any) {
          stats.errors.push(`Transaction error: ${txError.message}`);
        }

        resolve(stats);
      },
      error: (error: Error) => {
        stats.errors.push(`CSV parsing error: ${error.message}`);
        resolve(stats);
      },
    });
  });
}

export async function importCompetitiveSurveyExcel(fileBuffer: Buffer, surveyMonth: string, clientId: string = 'demo'): Promise<ImportStats> {
  const stats: ImportStats = {
    totalRecords: 0,
    successfulImports: 0,
    failedImports: 0,
    mappedRecords: 0,
    unmappedRecords: 0,
    errors: [],
  };

  try {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const data: any[] = XLSX.utils.sheet_to_json(worksheet);

    stats.totalRecords = data.length;

    // Log column headers for diagnosing format mismatches
    if (data.length > 0) {
      const cols = Object.keys(data[0]);
      console.log(`[CompetitiveSurvey] File columns (${cols.length}): ${cols.join(', ')}`);
      const hasExpectedCols = cols.some(c => ['TrilogyCampusName', 'CompetitorFacilityName', 'AL', 'HC'].includes(c));
      if (!hasExpectedCols) {
        console.warn('[CompetitiveSurvey] WARNING: File does not contain expected column names (TrilogyCampusName, AL, HC, etc). Import will likely produce 0 records.');
        stats.columnWarning = `Unexpected columns. Expected: TrilogyCampusName, CompetitorFacilityName, AL, HC, AL_StudioRate, etc. Got: ${cols.slice(0, 10).join(', ')}${cols.length > 10 ? '...' : ''}`;
      }
    }

    const insertCounts = { AL: 0, HC: 0, SMC: 0, MC: 0, IL: 0, IL_Villa: 0, IL_IL: 0, 'AL/MC': 0, 'HC/MC': 0 };
    
    await db.transaction(async (tx) => {
      await tx.delete(competitiveSurveyData).where(and(eq(competitiveSurveyData.surveyMonth, surveyMonth), eq(competitiveSurveyData.clientId, clientId)));

      for (const row of data) {
        try {
          const trilogyCampus = row['TrilogyCampusName'] || '';
          const competitorName = row['CompetitorFacilityName'] || '';
          const address = row['Address'] || null;
          const latitude = row['Latitude'] || null;
          const longitude = row['Longitude'] || null;
          
          // Parse driving time to estimate distance (rough conversion: 1 min ≈ 1 mile at 60mph)
          let distanceMiles: number | null = null;
          if (row['DrivingTime']) {
            const timeMatch = String(row['DrivingTime']).match(/(\d+)/);
            if (timeMatch) {
              distanceMiles = parseInt(timeMatch[1]);
            }
          }

          // Helper to get first non-null/undefined value from multiple possible column names
          const getColumn = (...names: string[]): any => {
            for (const name of names) {
              if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
                return row[name];
              }
            }
            return null;
          };

          // parseNumeric: strips currency symbols / commas so "$1,000" → 1000, non-numerics → 0
          const parseNumericExcel = (value: any): number | null => {
            if (value === null || value === undefined || value === '') return null;
            const cleaned = String(value).replace(/[$,\s]/g, '');
            const parsed = parseFloat(cleaned);
            return isNaN(parsed) ? 0 : parsed;
          };

          // Helper function to check if a flag is "true" (handles string, boolean, number formats)
          const isFlagTrue = (flag: any): boolean => {
            if (flag === 'True' || flag === 'TRUE' || flag === true || flag === 1 || flag === '1') {
              return true;
            }
            return false;
          };

          // Returns the first column value that parses to a finite non-zero number, or null.
          // Avoids the JS truthy pitfall where "0" is truthy but represents no rate,
          // and guards against non-numeric strings like "N/A" where parseFloat yields NaN.
          const getFirstNonZeroRate = (...cols: any[]): string | null => {
            for (const col of cols) {
              const n = parseFloat(col);
              if (Number.isFinite(n) && n !== 0) return String(col);
            }
            return null;
          };

          // Service line definitions with their room type mappings
          // IL data is split: "IL_Villa" prefix for VIL service line, "IL_IL" prefix for SL service line
          // Both use the same IL flag to indicate if competitor has Independent Living
          const serviceLines: SurveyServiceLine[] = [
            {
              type: 'IL_Villa',
              targetServiceLine: 'VIL',
              flag: getColumn('IL', 'IL flag'),  // Check IL flag (common for both Villa and SL)
              careLevel1: parseNumericExcel(getColumn('IL_Level1')),
              careLevel2: parseNumericExcel(getColumn('IL_Level2')),
              careLevel3: parseNumericExcel(getColumn('IL_Level3')),
              careLevel4: parseNumericExcel(getColumn('IL_Level4')),
              medicationManagement: parseNumericExcel(getColumn('IL_MedicationManagement')),
              roomTypes: [
                { 
                  name: 'Studio', 
                  rate: getColumn('IL_VillaStudioPrivateRoomRate', 'IL_Villa_StudioRate'),
                  careLevel: getColumn('IL_Comp_Care_Adj'),
                  otherAdj: getColumn('IL_Comp_Other_Adj'),
                  weight: getColumn('IL_Comp_Weight')
                },
                { 
                  name: 'Companion', 
                  rate: getColumn('IL_VillaStudioCompanionRoomRate', 'IL_Villa_CompanionRate'),
                  careLevel: getColumn('IL_Comp_Care_Adj'),
                  otherAdj: getColumn('IL_Comp_Other_Adj'),
                  weight: getColumn('IL_Comp_Weight')
                },
                { 
                  name: 'One Bedroom', 
                  rate: getColumn('IL_Villa1BRPrivateRoomRate', 'IL_Villa_1BRRate'),
                  careLevel: getColumn('IL_Comp_Care_Adj'),
                  otherAdj: getColumn('IL_Comp_Other_Adj'),
                  weight: getColumn('IL_Comp_Weight')
                },
                { 
                  name: 'Two Bedroom', 
                  rate: getColumn('IL_Villa2BRPrivateRoomRate', 'IL_Villa_2BRRate'),
                  careLevel: getColumn('IL_Comp_Care_Adj'),
                  otherAdj: getColumn('IL_Comp_Other_Adj'),
                  weight: getColumn('IL_Comp_Weight')
                },
              ],
              occupancy: getColumn('IL_Occupancy'),
              totalUnits: getColumn('IL_TotalUnits'),
            },
            {
              type: 'IL_IL',
              targetServiceLine: 'SL',
              flag: getColumn('IL', 'IL flag'),  // Check IL flag (common for both Villa and SL)
              careLevel1: parseNumericExcel(getColumn('IL_Level1')),
              careLevel2: parseNumericExcel(getColumn('IL_Level2')),
              careLevel3: parseNumericExcel(getColumn('IL_Level3')),
              careLevel4: parseNumericExcel(getColumn('IL_Level4')),
              medicationManagement: parseNumericExcel(getColumn('IL_MedicationManagement')),
              roomTypes: [
                { 
                  name: 'Studio', 
                  rate: getColumn('IL_ILStudioRoomRate', 'IL_IL_StudioRate'),
                  careLevel: getColumn('IL_Comp_Care_Adj'),
                  otherAdj: getColumn('IL_Comp_Other_Adj'),
                  weight: getColumn('IL_Comp_Weight')
                },
                { 
                  name: 'One Bedroom', 
                  rate: getColumn('IL_IL1BRRoomRate', 'IL_IL_1BRRate'),
                  careLevel: getColumn('IL_Comp_Care_Adj'),
                  otherAdj: getColumn('IL_Comp_Other_Adj'),
                  weight: getColumn('IL_Comp_Weight')
                },
                { 
                  name: 'Two Bedroom', 
                  rate: getColumn('IL_IL2BRRoomRate', 'IL_IL_2BRRate'),
                  careLevel: getColumn('IL_Comp_Care_Adj'),
                  otherAdj: getColumn('IL_Comp_Other_Adj'),
                  weight: getColumn('IL_Comp_Weight')
                },
              ],
              occupancy: getColumn('IL_Occupancy'),
              totalUnits: getColumn('IL_TotalUnits'),
            },
            {
              type: 'AL',
              flag: row['AL'],
              careLevel1: parseNumericExcel(row['AL_Level1']),
              careLevel2: parseNumericExcel(row['AL_Level2']),
              careLevel3: parseNumericExcel(row['AL_Level3']),
              careLevel4: parseNumericExcel(row['AL_Level4']),
              medicationManagement: parseNumericExcel(row['AL_MedicationManagement']),
              roomTypes: [
                // Support both old and new column name formats
                { name: 'Studio', rate: row['AL_StudioRate'] || row['AL_StudioPrivateRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                { name: 'Studio Dlx', rate: row['AL_StudioDeluxePrivateRoomRate'] || row['AL_StudioDlxRate'] || row['AL_StudioDeluxeRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                { name: 'One Bedroom', rate: row['AL_OneBedRate'] || row['AL_1BRPrivateRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                { name: 'Two Bedroom', rate: row['AL_TwoBedRate'] || row['AL_2BRPrivateRoomRate'], careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
                { name: 'Companion', rate: (() => { const a = parseNumericExcel(row['AL_StudioDeluxePrivateRoomRate']) || 0; const b = parseNumericExcel(row['AL_StudioCompanionRoomRate']) || 0; return (a === 0 && b === 0) ? null : String(Math.max(a, b)); })(), careLevel: row['AL_Comp_Care_Adj'], otherAdj: row['AL_Comp_Other_Adj'], weight: row['AL_Comp_Weight'] },
              ],
              occupancy: row['AL_Occupancy'],
              totalUnits: row['AL_TotalUnits'],
            },
            {
              type: 'HC',
              flag: row['HC'],
              careLevel1: parseNumericExcel(row['HC_Level1']),
              careLevel2: parseNumericExcel(row['HC_Level2']),
              careLevel3: parseNumericExcel(row['HC_Level3']),
              careLevel4: parseNumericExcel(row['HC_Level4']),
              medicationManagement: parseNumericExcel(row['HC_MedicationManagement']),
              roomTypes: [
                // Support both old and new column name formats
                { name: 'Studio', rate: row['HC_PrivateRoomRate'], careLevel: row['HC_Comp_Care_Adj'], otherAdj: row['HC_Comp_Other_Adj'], weight: row['HC_Comp_Weight'] },
                { name: 'Studio Dlx', rate: row['HC_PrivateDeluxeRoomRate'] || row['HC_PrivateDlxRoomRate'], careLevel: row['HC_Comp_Care_Adj'], otherAdj: row['HC_Comp_Other_Adj'], weight: row['HC_Comp_Weight'] },
                { name: 'Companion', rate: row['HC_CompanionSemiPrivateRoomRate'] || null, careLevel: row['HC_Comp_Care_Adj'], otherAdj: row['HC_Comp_Other_Adj'], weight: row['HC_Comp_Weight'] },
              ],
              occupancy: row['HC_Occupancy'],
              totalUnits: row['HC_TotalUnits'],
            },
            {
              type: 'SMC',
              flag: row['SMC'],
              careLevel1: parseNumericExcel(row['SMC_Level1']),
              careLevel2: parseNumericExcel(row['SMC_Level2']),
              careLevel3: parseNumericExcel(row['SMC_Level3']),
              careLevel4: parseNumericExcel(row['SMC_Level4']),
              medicationManagement: parseNumericExcel(row['SMC_MedicationManagement']),
              roomTypes: [
                { name: 'Studio', rate: row['SMC_PrivateRoomRate'], careLevel: row['SMC_Comp_Care_Adj'], otherAdj: row['SMC_Comp_Other_Adj'], weight: row['SMC_Comp_Weight'] },
                { name: 'Companion', rate: row['SMC_CompanionRoomRate'], careLevel: row['SMC_Comp_Care_Adj'], otherAdj: row['SMC_Comp_Other_Adj'], weight: row['SMC_Comp_Weight'] },
              ],
              occupancy: row['SMC_Occupancy'],
              totalUnits: row['SMC_TotalUnits'],
            },
            {
              type: 'MC',
              flag: row['MC'],
              careLevel1: parseNumericExcel(row['MC_Level1']),
              careLevel2: parseNumericExcel(row['MC_Level2']),
              careLevel3: parseNumericExcel(row['MC_Level3']),
              careLevel4: parseNumericExcel(row['MC_Level4']),
              medicationManagement: parseNumericExcel(row['MC_MedicationManagement']),
              roomTypes: [
                { name: 'Studio', rate: row['MC_StudioRate'], careLevel: row['MC_Comp_Care_Adj'], otherAdj: row['MC_Comp_Other_Adj'], weight: row['MC_Comp_Weight'] },
                { name: 'Companion', rate: row['MC_CompanionRate'], careLevel: row['MC_Comp_Care_Adj'], otherAdj: row['MC_Comp_Other_Adj'], weight: row['MC_Comp_Weight'] },
              ],
              occupancy: row['MC_Occupancy'],
              totalUnits: row['MC_TotalUnits'],
            },
            {
              type: 'AL/MC',
              // Use isFlagTrue with both possible column names; fall back to rate-presence detection
              flag: isFlagTrue(row['MC flag'] || row['MC']) || getFirstNonZeroRate(row['MC_ALStudioRoomRate'], row['AL/MC_PrivateRate'], row['AL/MC_StudioRate'], row['MC_ALCompanionRoomRate'], row['AL/MC_CompanionRate']) ? 'True' : 'False',
              careLevel1: parseNumericExcel(row['AL/MC_Level1'] ?? row['AL_Level1']),
              careLevel2: parseNumericExcel(row['MC_Level2'] ?? row['AL/MC_Level2'] ?? 0),
              careLevel3: parseNumericExcel(row['AL/MC_Level3'] ?? row['AL_Level3']),
              careLevel4: parseNumericExcel(row['AL/MC_Level4'] ?? row['AL_Level4']),
              medicationManagement: parseNumericExcel(row['MC_MedicationManagement']),
              roomTypes: [
                { name: 'Studio', rate: getFirstNonZeroRate(row['AL/MC_StudioRate'], row['AL/MC_PrivateRate'], row['MC_ALStudioRoomRate']), careLevel: row['AL/MC_Comp_Care_Adj'], otherAdj: row['AL/MC_Comp_Other_Adj'], weight: row['AL/MC_Comp_Weight'] },
                { name: 'Companion', rate: getFirstNonZeroRate(row['MC_ALCompanionRoomRate'], row['AL/MC_CompanionRate']), careLevel: row['AL/MC_Comp_Care_Adj'], otherAdj: row['AL/MC_Comp_Other_Adj'], weight: row['AL/MC_Comp_Weight'] },
              ],
              occupancy: null,
              totalUnits: null,
            },
            {
              type: 'HC/MC',
              // Use isFlagTrue with both possible column names; fall back to rate-presence detection
              flag: isFlagTrue(row['SMC flag'] || row['SMC']) || getFirstNonZeroRate(row['HC/MC_PrivateRate'], row['SMC_PrivateRoomRate'], row['HC/MC_CompanionRate'], row['SMC_CompanionRoomRate']) ? 'True' : 'False',
              careLevel1: parseNumericExcel(row['HC/MC_Level1'] ?? row['HC_Level1']),
              careLevel2: parseNumericExcel(row['SMC_Level2'] ?? row['HC/MC_Level2'] ?? 0),
              careLevel3: parseNumericExcel(row['HC/MC_Level3'] ?? row['HC_Level3']),
              careLevel4: parseNumericExcel(row['HC/MC_Level4'] ?? row['HC_Level4']),
              medicationManagement: parseNumericExcel(row['HC/MC_MedicationManagement'] ?? row['SMC_MedicationManagement']),
              roomTypes: [
                { name: 'Studio', rate: getFirstNonZeroRate(row['HC/MC_PrivateRate'], row['SMC_PrivateRoomRate']), careLevel: row['HC/MC_Comp_Care_Adj'], otherAdj: row['HC/MC_Comp_Other_Adj'], weight: row['HC/MC_Comp_Weight'] },
                { name: 'Companion', rate: getFirstNonZeroRate(row['HC/MC_CompanionRate'], row['SMC_CompanionRoomRate']), careLevel: row['HC/MC_Comp_Care_Adj'], otherAdj: row['HC/MC_Comp_Other_Adj'], weight: row['HC/MC_Comp_Weight'] },
              ],
              occupancy: null,
              totalUnits: null,
            },
          ];

          // For each service line, create rows for each room type with a rate
          for (const serviceLine of serviceLines) {
            if (!isFlagTrue(serviceLine.flag)) {
              continue;
            }

            for (const roomType of serviceLine.roomTypes) {
              // Only create a row if there's a rate
              if (!roomType.rate || parseFloat(roomType.rate) === 0) {
                continue;
              }

              const dbType = serviceLine.targetServiceLine === 'VIL' ? 'IL_Villa' 
                           : serviceLine.targetServiceLine === 'SL' ? 'IL_IL' 
                           : serviceLine.type;
              const record: InsertCompetitiveSurveyData = {
                surveyMonth,
                keyStatsLocation: trilogyCampus,
                competitorName,
                competitorAddress: address,
                distanceMiles,
                competitorType: dbType,
                roomType: roomType.name,
                squareFootage: null,
                monthlyRateLow: null,
                monthlyRateHigh: null,
                monthlyRateAvg: parseFloat(roomType.rate) || null,
                careFeesLow: null,
                careFeesHigh: null,
                careFeesAvg: null,
                careLevel1Rate: serviceLine.careLevel1 ?? null,
                careLevel2Rate: serviceLine.careLevel2 ?? null,
                careLevel3Rate: serviceLine.careLevel3 ?? null,
                careLevel4Rate: serviceLine.careLevel4 ?? null,
                totalMonthlyLow: null,
                totalMonthlyHigh: null,
                totalMonthlyAvg: null,
                communityFee: null,
                petFee: null,
                otherFees: parseFloat(roomType.otherAdj) || null,
                incentives: null,
                totalUnits: serviceLine.totalUnits ? parseInt(serviceLine.totalUnits) : null,
                occupancyRate: serviceLine.occupancy ? parseFloat(serviceLine.occupancy) : null,
                yearBuilt: row['Age'] ? parseInt(row['Age']) : null,
                lastRenovation: null,
                amenities: null,
                lat: latitude ? parseFloat(latitude) : null,
                lng: longitude ? parseFloat(longitude) : null,
                clientId,
                medicationManagementFee: serviceLine.medicationManagement ?? null,
                notes: JSON.stringify({
                  weight: roomType.weight || 0,
                  latitude,
                  longitude,
                  providerId: row['ID'],
                  providerNumber: row['Provider Number'],
                }),
              };

              await tx.insert(competitiveSurveyData).values(record);
              stats.successfulImports++;
              stats.mappedRecords++;
              insertCounts[dbType as keyof typeof insertCounts] = (insertCounts[dbType as keyof typeof insertCounts] || 0) + 1;
            }
          }
        } catch (error: any) {
          stats.failedImports++;
          stats.errors.push(`Row ${stats.successfulImports + stats.failedImports}: ${error.message}`);
        }
      }
    });
    
    // Log summary (all service lines shown, including zeros, to surface future regressions)
    console.log('\n=== Excel Import Summary ===');
    console.log(`Total rows processed: ${data.length}`);
    console.log(`Records inserted by type:`);
    Object.entries(insertCounts).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    if (stats.successfulImports === 0 && data.length > 0) {
      console.warn('[CompetitiveSurvey] 0 records inserted from', data.length, 'rows. Check that service line flags (AL, HC, etc.) are set to "True" and rate columns match expected names.');
      stats.warning = `0 records were imported from ${data.length} rows in the file. The file format may not match the expected competitive survey template. Check that service line flags (AL, HC, etc.) are "True" and column names match the template.`;
    }
    
  } catch (error: any) {
    stats.errors.push(`Excel parsing error: ${error.message}`);
  }

  return stats;
}

export async function autoMapLocations(): Promise<{ created: number; suggested: Array<{ source: string; targets: string[] }> }> {
  const enquireLocations = await db
    .selectDistinct({ location: enquireData.enquireLocation })
    .from(enquireData)
    .where(sql`${enquireData.mappedLocationId} IS NULL`);

  const allLocations = await db.select().from(locations);
  const created = 0;
  const suggested: Array<{ source: string; targets: string[] }> = [];

  for (const { location: enquireLoc } of enquireLocations) {
    const matches = fuzzyMatchLocation(enquireLoc, allLocations.map(l => l.name));
    
    if (matches.length > 0) {
      suggested.push({
        source: enquireLoc,
        targets: matches.slice(0, 3),
      });
    }
  }

  return { created, suggested };
}

function fuzzyMatchLocation(source: string, targets: string[]): string[] {
  const sourceLower = source.toLowerCase().trim();
  const scores: Array<{ target: string; score: number }> = [];

  for (const target of targets) {
    const targetLower = target.toLowerCase().trim();
    let score = 0;

    if (sourceLower === targetLower) {
      score = 100;
    } else if (sourceLower.includes(targetLower) || targetLower.includes(sourceLower)) {
      score = 80;
    } else {
      const sourceWords = sourceLower.split(/[\s-]+/);
      const targetWords = targetLower.split(/[\s-]+/);
      const matchingWords = sourceWords.filter(sw => targetWords.some(tw => tw.includes(sw) || sw.includes(tw)));
      score = (matchingWords.length / Math.max(sourceWords.length, targetWords.length)) * 70;
    }

    if (score > 30) {
      scores.push({ target, score });
    }
  }

  return scores.sort((a, b) => b.score - a.score).map(s => s.target);
}

function parseBoolean(value: any): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    return lower === 'true' || lower === 'yes' || lower === 'y' || lower === '1';
  }
  return false;
}

export async function importMatrixCareRentRollCSV(
  fileBuffer: Buffer,
  uploadMonth: string,
  fileName: string,
  clientId?: string
): Promise<ImportStats> {
  const stats: ImportStats = {
    totalRecords: 0,
    successfulImports: 0,
    failedImports: 0,
    mappedRecords: 0,
    unmappedRecords: 0,
    errors: [],
  };

  // Helper function to parse BedTypeDesc (e.g., "Studio;A Vw;A Loc;B Sz", "Companion;A Vw;B Loc")
  const parseBedTypeDesc = (bedTypeDesc: string) => {
    const parts = (bedTypeDesc || '').split(';').map(p => p.trim());
    let size = '';
    let viewRating = null;
    let locationRating = null;
    let sizeRating = null;
    let view = null;

    for (const part of parts) {
      if (part.includes('Studio') || part.includes('Bedroom') || /compan/i.test(part)) {
        size = part;
      } else if (part.includes(' Vw')) {
        viewRating = part.charAt(0); // Extract A, B, or C
        if (part.includes('A Vw')) view = 'Garden View';
        else if (part.includes('B Vw')) view = 'Courtyard View';
        else if (part.includes('C Vw')) view = 'Street View';
      } else if (part.includes(' Loc')) {
        locationRating = part.charAt(0); // Extract A, B, or C
      } else if (part.includes(' Sz')) {
        sizeRating = part.charAt(0); // Extract A, B, or C
      }
    }

    return { size: normalizeRoomType(size), view, viewRating, locationRating, sizeRating };
  };

  // Helper function to clean currency strings (e.g., "$329 " -> 329)
  const parseCurrency = (value: any): number => {
    if (!value) return 0;
    const cleaned = String(value).replace(/[\$,\s]/g, '');
    return parseFloat(cleaned) || 0;
  };

  // Helper function to map Service1 to service line (IL maps to SL per requirement)
  const mapServiceLine = (service1: string): string => {
    return matrixCareServiceLine(service1);
  };

  return new Promise((resolve) => {
    const fileContent = fileBuffer.toString('utf-8');

    Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
      complete: async (results: Papa.ParseResult<any>) => {
        stats.totalRecords = results.data.length;

        try {
          await db.transaction(async (tx) => {
            // Clear existing data for this month
            await tx.delete(rentRollHistory).where(eq(rentRollHistory.uploadMonth, uploadMonth));

            // Get all locations for mapping
            const allLocations = await tx.select().from(locations);
            const locationMap = new Map(allLocations.map(loc => [loc.name.toLowerCase(), loc.id]));

            // Track duplicates using location + serviceLine + roomNumber
            const seenUnits = new Set<string>();

            // Harvest Level 2 care rates for care_level_rates table.
            // Key: "locationId|serviceLine", Value: { locationId, serviceLine, clientId, rate }
            const level2Harvested = new Map<string, { locationId: string; serviceLine: string; rate: number }>();

            for (const row of results.data as any[]) {
              try {
                // Extract core fields
                const locationName = (row['location'] || '').trim();
                const locationId = locationMap.get(locationName.toLowerCase());
                const serviceLine = mapServiceLine(row['Service1']);
                const roomBed = row['Room_Bed'] || '';
                const roomNumber = roomBed.split('/')[0] || roomBed; // "101/A" -> "101"
                const moveInDate = row['MoveInDate'] || null;
                recordMoveInDateValidation(stats.moveInDateValidation!, moveInDate);
                
                // Check for duplicates - use locationName as fallback to prevent cross-campus collisions
                const locationKey = locationId || locationName || 'unknown';
                const unitKey = `${locationKey}|${serviceLine}|${roomNumber}`;
                if (seenUnits.has(unitKey)) {
                  // Before skipping, check if this is a LOC (Level of Care) row carrying Level 2 data.
                  // The MatrixCare export emits a separate row for each care charge on the same room.
                  // We want to capture the care_level and care_rate from the Level 2 LOC row.
                  const locDescription = (row['LOCDescription'] || '').trim();
                  const locRate = parseCurrency(row['LOC_Rate']);
                  const isLevel2 = locDescription &&
                    (locDescription.toLowerCase().includes('level 2') ||
                     locDescription.toLowerCase().includes('lvl 2') ||
                     locDescription === '2');
                  if (isLevel2 && locRate > 0) {
                    try {
                      const locUpdateWhere = and(
                        eq(rentRollHistory.uploadMonth, uploadMonth),
                        eq(rentRollHistory.location, locationName),
                        eq(rentRollHistory.serviceLine, serviceLine),
                        eq(rentRollHistory.roomNumber, roomNumber)
                      );
                      await tx.update(rentRollHistory)
                        .set({ careLevel: locDescription, careRate: locRate })
                        .where(locUpdateWhere);
                      // Also update rentRollData so getTrilogyCareLevel2Rate finds it immediately.
                      // Scope to the same uploadMonth to avoid touching other months' rows.
                      await tx.update(rentRollData)
                        .set({ careLevel: locDescription, careRate: locRate })
                        .where(and(
                          eq(rentRollData.uploadMonth, uploadMonth),
                          eq(rentRollData.location, locationName),
                          eq(rentRollData.serviceLine, serviceLine),
                          eq(rentRollData.roomNumber, roomNumber)
                        ));
                    } catch (updateErr) {
                      const msg = `LOC level-2 update failed for ${unitKey}: ${updateErr}`;
                      console.warn(`[rent-roll-import] ${msg}`);
                      stats.errors.push(msg);
                    }
                    // Also harvest into level2Harvested map (take max rate per location+SL)
                    if (locationId) {
                      const harvestKey = `${locationId}|${serviceLine}`;
                      const existing = level2Harvested.get(harvestKey);
                      if (!existing || locRate > existing.rate) {
                        level2Harvested.set(harvestKey, { locationId, serviceLine, rate: locRate });
                      }
                    }
                  }
                  console.log(`Skipping duplicate: ${unitKey}`);
                  continue;
                }
                seenUnits.add(unitKey);

                // Harvest Level 2 care rates from this row's LOCDescription + LOC_Rate
                {
                  const locDescMain = (row['LOCDescription'] || '').trim();
                  const locRateMain = parseCurrency(row['LOC_Rate']);
                  const isL2Main = locDescMain && (
                    locDescMain.toLowerCase().includes('level 2') ||
                    locDescMain.toLowerCase().includes('lvl 2') ||
                    locDescMain === '2'
                  );
                  if (isL2Main && locRateMain > 0 && locationId) {
                    const harvestKey = `${locationId}|${serviceLine}`;
                    const existing = level2Harvested.get(harvestKey);
                    if (!existing || locRateMain > existing.rate) {
                      level2Harvested.set(harvestKey, { locationId, serviceLine, rate: locRateMain });
                    }
                  }
                }

                // Determine occupancy
                const patientId = row['PatientID1'] || '';
                const bedSpecialization = row['BedSpecialization1'] || '';
                const isOccupied = patientId && patientId.trim() !== '' && bedSpecialization !== 'Available';

                // Parse BedTypeDesc
                const { size, view, viewRating, locationRating, sizeRating } = parseBedTypeDesc(row['BedTypeDesc']);

                // Parse rates - HC/HC-MC are daily, others are monthly
                // Store as-is without conversion (mixed storage model)
                const baseRate1 = parseCurrency(row['BaseRate1']);
                const roomRate = parseCurrency(row['Room_Rate']);
                const locRate = parseCurrency(row['LOC_Rate']);
                const finalRate = parseCurrency(row['FinalRate']);
                const billedRate = parseCurrency(row['BilledRate']);

                const normalizedRoomType = normalizeRoomType(size);

                const record: InsertRentRollHistory = {
                  uploadMonth,
                  date: uploadMonth,
                  location: locationName,
                  locationId: locationId || null,
                  roomNumber,
                  roomType: normalizedRoomType,
                  serviceLine,
                  occupiedYN: isOccupied,
                  daysVacant: isOccupied ? 0 : 30, // Default to 30 days if vacant
                  preferredLocation: locationRating === 'A' ? 'Yes' : null,
                  size: normalizedRoomType,
                  view,
                  renovated: false, // Not available in MatrixCare export
                  otherPremiumFeature: row['BedSpecialization1'] || null,
                  locationRating,
                  sizeRating,
                  viewRating,
                  renovationRating: null,
                  amenityRating: null,
                  streetRate: baseRate1 || roomRate,
                  inHouseRate: finalRate || billedRate || roomRate,
                  discountToStreetRate: null,
                  careLevel: (() => {
                    // Prefer LOCDescription if it identifies Level 2 (covers the case where the
                    // LOC row arrives before the room row and is inserted as the primary record).
                    const locDesc = (row['LOCDescription'] || '').trim();
                    const isL2 = locDesc && (
                      locDesc.toLowerCase().includes('level 2') ||
                      locDesc.toLowerCase().includes('lvl 2') ||
                      locDesc === '2'
                    );
                    return isL2 ? locDesc : (row['ActualLevel1'] || row['LevelOfCare1'] || null);
                  })(),
                  careRate: locRate,
                  rentAndCareRate: finalRate || (roomRate + locRate),
                  competitorRate: null,
                  competitorAvgCareRate: null,
                  competitorFinalRate: null,
                  residentId: patientId || null,
                  residentName: null, // Not available in this export
                  moveInDate,
                  moveOutDate: row['MoveOutDate'] || null,
                  payorType: row['PayerName'] || row['DisplayPayer'] || null,
                  admissionStatus: null,
                  levelOfCare: row['LevelOfCare1'] || row['ActualLevel1'] || null,
                  medicaidRate: null,
                  medicareRate: null,
                  assessmentDate: null,
                  marketingSource: null,
                };

                await tx.insert(rentRollHistory).values(record);
                stats.successfulImports++;
                if (locationId) {
                  stats.mappedRecords++;
                } else {
                  stats.unmappedRecords++;
                }
              } catch (error: any) {
                stats.failedImports++;
                stats.errors.push(`Row ${stats.successfulImports + stats.failedImports}: ${error.message}`);
              }
            }

            // Upsert harvested Level 2 care rates into care_level_rates.
            // Only insert when no existing entry exists (DO NOTHING preserves admin values).
            if (clientId && level2Harvested.size > 0) {
              for (const { locationId, serviceLine, rate } of level2Harvested.values()) {
                try {
                  await tx
                    .insert(careLevelRates)
                    .values({ locationId, serviceLine, level2Rate: rate, clientId })
                    .onConflictDoNothing();
                } catch (insertErr) {
                  console.warn(`[rent-roll-import] care_level_rates insert failed for ${locationId}/${serviceLine}: ${insertErr}`);
                }
              }
              console.log(`[rent-roll-import] Harvested ${level2Harvested.size} Level 2 care rate(s) into care_level_rates for client ${clientId}`);
            }
          });
        } catch (txError: any) {
          stats.errors.push(`Transaction error: ${txError.message}`);
        }

        logMoveInDateValidation(stats.moveInDateValidation!);
        await warnIfLegacyRentRollMonthIsEmpty(stats, uploadMonth, fileName);
        resolve(stats);
      },
      error: (error: Error) => {
        stats.errors.push(`CSV parsing error: ${error.message}`);
        resolve(stats);
      },
    });
  });
}

export async function syncHistoryToCurrentRentRoll(uploadMonth: string, clientId?: string): Promise<{ synced: number }> {
  return await db.transaction(async (tx) => {
    const historyRecords = await tx
      .select()
      .from(rentRollHistory)
      .where(eq(rentRollHistory.uploadMonth, uploadMonth));

    const monthFilter = clientId
      ? and(eq(rentRollData.uploadMonth, uploadMonth), eq(rentRollData.clientId, clientId))
      : eq(rentRollData.uploadMonth, uploadMonth);
    await tx.delete(rentRollData).where(monthFilter);

    let synced = 0;
    for (const record of historyRecords) {
      await tx.insert(rentRollData).values({
        uploadMonth: record.uploadMonth,
        clientId: clientId || null,
        date: record.date,
        location: record.location,
        locationId: record.locationId,
        roomNumber: record.roomNumber,
        roomType: record.roomType,
        serviceLine: record.serviceLine,
        occupiedYN: record.occupiedYN,
        daysVacant: record.daysVacant,
        preferredLocation: record.preferredLocation,
        size: record.size,
        view: record.view,
        renovated: record.renovated,
        otherPremiumFeature: record.otherPremiumFeature,
        locationRating: record.locationRating,
        sizeRating: record.sizeRating,
        viewRating: record.viewRating,
        renovationRating: record.renovationRating,
        amenityRating: record.amenityRating,
        streetRate: record.streetRate,
        inHouseRate: record.inHouseRate,
        discountToStreetRate: record.discountToStreetRate,
        careLevel: record.careLevel,
        careRate: record.careRate,
        rentAndCareRate: record.rentAndCareRate,
        competitorRate: record.competitorRate,
        competitorAvgCareRate: record.competitorAvgCareRate,
        competitorFinalRate: record.competitorFinalRate,
        moduloSuggestedRate: null,
        moduloCalculationDetails: null,
        aiSuggestedRate: null,
        aiCalculationDetails: null,
        promotionAllowance: null,
        residentId: record.residentId,
        residentName: record.residentName,
        moveInDate: record.moveInDate,
        moveOutDate: record.moveOutDate,
        payorType: record.payorType,
        admissionStatus: record.admissionStatus,
        levelOfCare: record.levelOfCare,
        medicaidRate: record.medicaidRate,
        medicareRate: record.medicareRate,
        assessmentDate: record.assessmentDate,
        marketingSource: record.marketingSource,
        inquiryCount: 0,
        tourCount: 0,
      });
      synced++;
    }

    return { synced };
  });
}
