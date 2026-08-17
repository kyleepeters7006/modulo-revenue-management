/**
 * Data Import Service
 *
 * Registry-driven validation, period detection, template generation, and
 * transaction-safe period-upsert imports for all dataset types.
 */
import { createHash } from "crypto";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  importRuns,
  importNotifications,
  rentRollData,
  competitiveSurveyData,
  inquiryMetrics,
  roomTypeOccupancyHistory,
  locations,
  type ImportRun,
} from "@shared/schema";
import { IMPORT_DATASETS, getDataset, type DatasetDefinition, type RegistryField } from "@shared/importRegistry";
import { normalizeRoomType } from "@shared/roomTypes";

// Infer a service-line family string from a raw room-type name prefix
// ("AL Companion" → "AL", "HC Companion" → "HC").  Mirrors the same helper in
// routes.ts so both import paths apply identical SL-disambiguation logic.
function inferSlFamilyFromRoomType(rawRoomType: string): string {
  const upper = rawRoomType.toUpperCase().trim();
  if (upper.startsWith('HC/MC ') || upper.startsWith('HC/MC-')) return 'HC/MC';
  if (upper.startsWith('AL/MC ') || upper.startsWith('AL/MC-')) return 'AL/MC';
  if (upper.startsWith('HC ') || upper.startsWith('HC-')) return 'HC';
  if (upper.startsWith('AL ') || upper.startsWith('AL-')) return 'AL';
  if (upper.startsWith('VIL ') || upper.startsWith('VIL-')) return 'VIL';
  if (upper.startsWith('SL ') || upper.startsWith('SL-')) return 'SL';
  if (upper.startsWith('MC ') || upper.startsWith('MC-')) return 'AL/MC';
  if (upper.startsWith('IL ') || upper.startsWith('IL-')) return 'VIL';
  return '';
}

// ── Types ────────────────────────────────────────────────────────────

export interface ColumnIssue {
  column: string;
  issue: "unknown_column" | "missing_required";
  message: string;
}

export interface RowError {
  row: number; // 1-based data row number (excluding header)
  field: string;
  value: string;
  message: string;
}

export interface ValidationResult {
  datasetType: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  columnIssues: ColumnIssue[];
  rowErrors: RowError[]; // capped at 200
  warnings: string[];
  headerMapping: Record<string, string>; // source header -> field key
  detectedPeriod: string | null;
  periodSource: "column" | "filename" | null;
  periods: string[]; // all distinct periods found in data
  records: Record<string, any>[]; // normalized valid records
}

const ROW_ERROR_CAP = 200;

// ── File parsing ─────────────────────────────────────────────────────

export function parseImportFile(buffer: Buffer, fileName: string): { headers: string[]; rows: Record<string, any>[] } {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { headers, rows };
  }
  // CSV / TSV
  const text = buffer.toString("utf-8");
  const parsed = Papa.parse<Record<string, any>>(text, { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields || [];
  return { headers, rows: parsed.data };
}

export function hashFile(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// ── Header mapping ───────────────────────────────────────────────────

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function mapHeaders(dataset: DatasetDefinition, headers: string[]): { mapping: Record<string, string>; columnIssues: ColumnIssue[] } {
  const mapping: Record<string, string> = {};
  const columnIssues: ColumnIssue[] = [];
  const lookup = new Map<string, string>(); // normalized header -> field key
  for (const f of dataset.fields) {
    lookup.set(normHeader(f.label), f.key);
    lookup.set(normHeader(f.key), f.key);
    for (const a of f.aliases || []) lookup.set(normHeader(a), f.key);
  }
  const mappedKeys = new Set<string>();
  for (const h of headers) {
    if (!h || !h.trim()) continue;
    const key = lookup.get(normHeader(h));
    if (key && !mappedKeys.has(key)) {
      mapping[h] = key;
      mappedKeys.add(key);
    } else if (!key) {
      columnIssues.push({ column: h, issue: "unknown_column", message: `Column "${h}" is not in the ${dataset.name} field registry and will be ignored` });
    }
  }
  for (const f of dataset.fields) {
    if (f.required && !mappedKeys.has(f.key)) {
      columnIssues.push({ column: f.label, issue: "missing_required", message: `Required column "${f.label}" was not found in the file` });
    }
  }
  return { mapping, columnIssues };
}

// ── Value coercion / validation ──────────────────────────────────────

const TRUE_VALUES = new Set(["y", "yes", "true", "1", "occupied"]);
const FALSE_VALUES = new Set(["n", "no", "false", "0", "vacant", ""]);

/** Convert an Excel date serial number (days since 1899-12-30) to a JS Date. */
function excelSerialToDate(serial: number): Date | null {
  if (serial < 20000 || serial > 80000) return null; // ~1954..2119, sanity range
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

function coerceValue(field: RegistryField, raw: any): { value: any; error?: string } {
  // Excel stores dates as numeric serials; convert before string handling
  if ((field.type === "date" || field.type === "month") && typeof raw === "number") {
    const d = excelSerialToDate(raw);
    if (d) return { value: field.type === "month" ? d.toISOString().substring(0, 7) : d.toISOString().substring(0, 10) };
    return { value: null, error: `${field.label} has an unrecognized date value ("${raw}")` };
  }
  const s = raw === null || raw === undefined ? "" : String(raw).trim();
  if (s === "") {
    if (field.required) return { value: null, error: `${field.label} is required` };
    return { value: null };
  }
  switch (field.type) {
    case "string":
      return { value: s };
    case "number":
    case "percent": {
      const n = parseFloat(s.replace(/[$,%\s]/g, ""));
      if (isNaN(n)) return { value: null, error: `${field.label} must be a number (got "${s}")` };
      return { value: n };
    }
    case "integer": {
      const n = parseFloat(s.replace(/[$,\s]/g, ""));
      if (isNaN(n)) return { value: null, error: `${field.label} must be a whole number (got "${s}")` };
      return { value: Math.round(n) };
    }
    case "boolean": {
      const l = s.toLowerCase();
      if (TRUE_VALUES.has(l)) return { value: true };
      if (FALSE_VALUES.has(l)) return { value: false };
      return { value: null, error: `${field.label} must be Y/N, TRUE/FALSE or 1/0 (got "${s}")` };
    }
    case "month": {
      // Accept YYYY-MM, YYYY/MM, MM/YYYY, Excel dates
      let m = s.match(/^(20\d{2})[-\/](0?[1-9]|1[0-2])$/);
      if (m) return { value: `${m[1]}-${m[2].padStart(2, "0")}` };
      m = s.match(/^(0?[1-9]|1[0-2])[-\/](20\d{2})$/);
      if (m) return { value: `${m[2]}-${m[1].padStart(2, "0")}` };
      const d = new Date(s);
      if (!isNaN(d.getTime())) return { value: d.toISOString().substring(0, 7) };
      return { value: null, error: `${field.label} must be in YYYY-MM format (got "${s}")` };
    }
    case "date": {
      const d = new Date(s);
      if (isNaN(d.getTime())) return { value: null, error: `${field.label} must be a valid date (got "${s}")` };
      return { value: d.toISOString().substring(0, 10) };
    }
    case "enum": {
      const match = (field.allowedValues || []).find((v) => v.toLowerCase() === s.toLowerCase());
      if (!match) return { value: null, error: `${field.label} must be one of: ${(field.allowedValues || []).join(", ")} (got "${s}")` };
      return { value: match };
    }
    default:
      return { value: s };
  }
}

// ── Period detection ─────────────────────────────────────────────────

export function detectPeriodFromFilename(dataset: DatasetDefinition, fileName: string): string | null {
  const m = fileName.match(new RegExp(dataset.filenamePeriodPattern));
  if (m) return `${m[1]}-${m[2]}`;
  return null;
}

// ── Validation ───────────────────────────────────────────────────────

export function validateData(
  datasetId: string,
  headers: string[],
  rows: Record<string, any>[],
  fileName: string,
): ValidationResult {
  const dataset = getDataset(datasetId);
  if (!dataset) throw new Error(`Unknown dataset type: ${datasetId}`);

  const { mapping, columnIssues } = mapHeaders(dataset, headers);
  const rowErrors: RowError[] = [];
  const warnings: string[] = [];
  const records: Record<string, any>[] = [];
  const periods = new Set<string>();
  let errorRowCount = 0;

  const hasMissingRequired = columnIssues.some((c) => c.issue === "missing_required");

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rec: Record<string, any> = {};
    let rowHasError = false;
    for (const [header, key] of Object.entries(mapping)) {
      const field = dataset.fields.find((f) => f.key === key)!;
      const { value, error } = coerceValue(field, raw[header]);
      if (error) {
        rowHasError = true;
        if (rowErrors.length < ROW_ERROR_CAP) {
          rowErrors.push({ row: i + 1, field: field.label, value: String(raw[header] ?? ""), message: error });
        }
      }
      rec[key] = value;
    }
    // required fields not present as columns already flagged at column level
    if (rowHasError) {
      errorRowCount++;
    } else {
      records.push(rec);
      if (dataset.periodField && rec[dataset.periodField]) periods.add(rec[dataset.periodField]);
    }
  }

  let detectedPeriod: string | null = null;
  let periodSource: "column" | "filename" | null = null;
  if (periods.size === 1) {
    detectedPeriod = Array.from(periods)[0];
    periodSource = "column";
  } else if (periods.size > 1) {
    warnings.push(`File contains ${periods.size} different periods (${Array.from(periods).sort().join(", ")}). Each period will be replaced separately.`);
    detectedPeriod = Array.from(periods).sort().pop()!;
    periodSource = "column";
  } else {
    const fromName = detectPeriodFromFilename(dataset, fileName);
    if (fromName) {
      detectedPeriod = fromName;
      periodSource = "filename";
    }
  }

  if (hasMissingRequired) {
    warnings.push("Required columns are missing — the file cannot be imported until they are added.");
  }

  return {
    datasetType: datasetId,
    totalRows: rows.length,
    validRows: records.length,
    errorRows: errorRowCount,
    columnIssues,
    rowErrors,
    warnings,
    headerMapping: mapping,
    detectedPeriod,
    periodSource,
    periods: Array.from(periods).sort(),
    records,
  };
}

// ── Template generation ──────────────────────────────────────────────

export function buildTemplate(datasetId: string, format: "xlsx" | "csv"): { buffer: Buffer; fileName: string; contentType: string } {
  const dataset = getDataset(datasetId);
  if (!dataset) throw new Error(`Unknown dataset type: ${datasetId}`);

  const headers = dataset.fields.map((f) => f.label);
  const sampleRow = dataset.fields.map((f) => f.sample);

  if (format === "csv") {
    const csv = Papa.unparse({ fields: headers, data: [sampleRow] });
    return {
      buffer: Buffer.from(csv, "utf-8"),
      fileName: `${dataset.id}_template.csv`,
      contentType: "text/csv",
    };
  }

  const wb = XLSX.utils.book_new();
  const dataSheet = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  dataSheet["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
  XLSX.utils.book_append_sheet(wb, dataSheet, "Data");

  // Legend sheet: field name, required, type, format, allowed values, description
  const legendRows = [
    ["Column", "Required", "Type", "Format", "Allowed Values", "Description"],
    ...dataset.fields.map((f) => [
      f.label,
      f.required ? "YES" : "no",
      f.type,
      f.format || "",
      (f.allowedValues || []).join(", "),
      f.description,
    ]),
    [],
    ["Dataset", dataset.name],
    ["Import behavior", dataset.replacesPeriod ? "Importing a period replaces all existing data for that period" : "Rows are appended"],
    ["Period detection", `Taken from the "${dataset.fields.find((f) => f.key === dataset.periodField)?.label || "period"}" column, or the filename (e.g. ${dataset.id}_2026-06.csv), or chosen at upload time`],
  ];
  const legendSheet = XLSX.utils.aoa_to_sheet(legendRows);
  legendSheet["!cols"] = [{ wch: 26 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 30 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, legendSheet, "Legend");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return {
    buffer,
    fileName: `${dataset.id}_template.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

// ── Import execution ─────────────────────────────────────────────────

export interface ImportParams {
  clientId: string;
  datasetId: string;
  fileName: string;
  fileHash: string | null;
  source: "manual" | "sftp";
  scheduledImportId?: string | null;
  triggeredBy?: string | null; // account that initiated the import
  period: string | null; // YYYY-MM (final, possibly user-picked); null for non-periodic datasets
  periodSource: "column" | "filename" | "user" | null;
  mode: "replace_period" | "append";
  validation: ValidationResult;
}

async function resolveLocationIds(clientId: string): Promise<Map<string, string>> {
  const locs = await db.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.clientId, clientId));
  const map = new Map<string, string>();
  for (const l of locs) map.set(l.name.trim().toLowerCase(), l.id);
  return map;
}

export async function isDuplicateFile(clientId: string, datasetId: string, fileHash: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: importRuns.id })
    .from(importRuns)
    .where(and(
      eq(importRuns.clientId, clientId),
      eq(importRuns.datasetType, datasetId),
      eq(importRuns.fileHash, fileHash),
      eq(importRuns.status, "imported"),
    ))
    .limit(1);
  return !!existing;
}

export async function executeImport(params: ImportParams): Promise<ImportRun> {
  const { clientId, datasetId, validation, period, mode } = params;
  const dataset = getDataset(datasetId);
  if (!dataset) throw new Error(`Unknown dataset type: ${datasetId}`);
  if (validation.columnIssues.some((c) => c.issue === "missing_required")) {
    throw new Error("Cannot import: required columns are missing");
  }
  if (validation.records.length === 0) {
    throw new Error("Cannot import: no valid rows");
  }

  // When the user explicitly picked a period, it is authoritative: override
  // any per-row period values so the delete/replace set matches exactly.
  if (params.periodSource === "user" && dataset.periodField) {
    for (const r of validation.records) {
      r[dataset.periodField] = period;
    }
  }

  // Street-rate plausibility guard (warn-only, mirrors the competitor-rate
  // sanitizer's philosophy): flag campuses whose incoming median street rate
  // moved ~an order of magnitude vs the previous month already in the DB —
  // the signature of a monthly<->daily unit change in the export.
  if (datasetId === "rent_roll") {
    try {
      const { computeStreetRateShiftWarnings } = await import("./streetRateQualityService");
      const byMonth = new Map<string, any[]>();
      for (const r of validation.records) {
        const m = r.uploadMonth || period;
        if (!m) continue;
        const arr = byMonth.get(m) || [];
        arr.push(r);
        byMonth.set(m, arr);
      }
      for (const [m, rows] of Array.from(byMonth.entries())) {
        const warns = await computeStreetRateShiftWarnings(clientId, m, rows);
        for (const w of warns) {
          validation.warnings.push(w);
          console.warn(`[DataImport] ⚠️ ${w}`);
        }
      }
    } catch (err) {
      console.error("[DataImport] street-rate shift guard failed:", err);
    }
  }

  // Create the audit run record up front
  const [run] = await db.insert(importRuns).values({
    clientId,
    datasetType: datasetId,
    source: params.source,
    scheduledImportId: params.scheduledImportId || null,
    triggeredBy: params.triggeredBy || (params.source === "sftp" ? "scheduler" : null),
    fileName: params.fileName,
    fileHash: params.fileHash,
    period,
    periodSource: params.periodSource,
    mode,
    status: "pending",
    totalRows: validation.totalRows,
    validRows: validation.validRows,
    errorRows: validation.errorRows,
    validationReport: {
      columnIssues: validation.columnIssues,
      rowErrors: validation.rowErrors,
      warnings: validation.warnings,
    },
  }).returning();

  try {
    let inserted = 0;
    let deleted = 0;
    const locMap = await resolveLocationIds(clientId);

    await db.transaction(async (tx) => {
      if (datasetId === "rent_roll") {
        const recs = validation.records.map((r) => ({
          uploadMonth: r.uploadMonth || period,
          date: r.date || `${period}-01`,
          location: r.location,
          locationId: locMap.get((r.location || "").trim().toLowerCase()) || null,
          roomNumber: r.roomNumber,
          sourceRoomType: r.roomType,
          roomType: normalizeRoomType(r.roomType),
          serviceLine: r.serviceLine,
          occupiedYN: r.occupiedYN === true,
          daysVacant: r.daysVacant ?? 0,
          preferredLocation: r.preferredLocation,
          size: r.size,
          view: r.view,
          renovated: r.renovated === true,
          otherPremiumFeature: r.otherPremiumFeature,
          locationRating: r.locationRating,
          sizeRating: r.sizeRating,
          viewRating: r.viewRating,
          renovationRating: r.renovationRating,
          amenityRating: r.amenityRating,
          streetRate: r.streetRate,
          inHouseRate: r.inHouseRate,
          careLevel: r.careLevel,
          careRate: r.careRate,
          rentAndCareRate: r.rentAndCareRate,
          promotionAllowance: r.promotionAllowance,
          residentId: r.residentId,
          residentName: r.residentName,
          moveInDate: r.moveInDate,
          moveOutDate: r.moveOutDate,
          payorType: r.payorType,
          clientId,
        }));
        const periodsToReplace = mode === "replace_period" ? Array.from(new Set(recs.map((r) => r.uploadMonth))) : [];
        for (const p of periodsToReplace) {
          const del = await tx.delete(rentRollData).where(and(eq(rentRollData.uploadMonth, p), eq(rentRollData.clientId, clientId))).returning({ id: rentRollData.id });
          deleted += del.length;
        }
        for (let i = 0; i < recs.length; i += 500) {
          await tx.insert(rentRollData).values(recs.slice(i, i + 500));
        }
        inserted = recs.length;
      } else if (datasetId === "competitive_survey") {
        const recs = validation.records.map((r) => ({
          surveyMonth: r.surveyMonth || period,
          keyStatsLocation: r.keyStatsLocation,
          competitorName: r.competitorName,
          competitorAddress: r.competitorAddress,
          distanceMiles: r.distanceMiles,
          competitorType: r.competitorType,
          roomType: r.roomType,
          squareFootage: r.squareFootage,
          monthlyRateLow: r.monthlyRateLow,
          monthlyRateHigh: r.monthlyRateHigh,
          monthlyRateAvg: r.monthlyRateAvg,
          careLevel1Rate: r.careLevel1Rate,
          careLevel2Rate: r.careLevel2Rate,
          careLevel3Rate: r.careLevel3Rate,
          careLevel4Rate: r.careLevel4Rate,
          medicationManagementFee: r.medicationManagementFee,
          communityFee: r.communityFee,
          petFee: r.petFee,
          incentives: r.incentives,
          totalUnits: r.totalUnits,
          occupancyRate: r.occupancyRate,
          yearBuilt: r.yearBuilt,
          notes: r.notes,
          clientId,
        }));
        const periodsToReplace = mode === "replace_period" ? Array.from(new Set(recs.map((r) => r.surveyMonth))) : [];
        for (const p of periodsToReplace) {
          const del = await tx.delete(competitiveSurveyData).where(and(eq(competitiveSurveyData.surveyMonth, p), eq(competitiveSurveyData.clientId, clientId))).returning({ id: competitiveSurveyData.id });
          deleted += del.length;
        }
        for (let i = 0; i < recs.length; i += 500) {
          await tx.insert(competitiveSurveyData).values(recs.slice(i, i + 500));
        }
        inserted = recs.length;
      } else if (datasetId === "inquiry") {
        const recs = validation.records.map((r) => ({
          uploadMonth: r.uploadMonth || period,
          date: r.date || `${period}-01`,
          region: r.region,
          division: r.division,
          location: r.location,
          locationId: locMap.get((r.location || "").trim().toLowerCase()) || null,
          serviceLine: r.serviceLine,
          leadSource: r.leadSource,
          inquiryCount: r.inquiryCount ?? 0,
          tourCount: r.tourCount ?? 0,
          conversionCount: r.conversionCount ?? 0,
          conversionRate: r.conversionRate,
          daysToTour: r.daysToTour,
          daysToMoveIn: r.daysToMoveIn,
          clientId,
        }));
        const periodsToReplace = mode === "replace_period" ? Array.from(new Set(recs.map((r) => r.uploadMonth))) : [];
        for (const p of periodsToReplace) {
          const del = await tx.delete(inquiryMetrics).where(and(eq(inquiryMetrics.uploadMonth, p), eq(inquiryMetrics.clientId, clientId))).returning({ id: inquiryMetrics.id });
          deleted += del.length;
        }
        for (let i = 0; i < recs.length; i += 500) {
          await tx.insert(inquiryMetrics).values(recs.slice(i, i + 500));
        }
        inserted = recs.length;
      } else if (datasetId === "campus_location") {
        // Upsert by unique location name (no period concept)
        const existing = await tx.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.clientId, clientId));
        const byName = new Map(existing.map((l) => [l.name.trim().toLowerCase(), l.id]));
        const updatable = ["locationCode", "region", "division", "locationClass", "address", "city", "state", "zipCode", "totalUnits", "sameStore", "matrixCareNameHC", "matrixCareNameAL", "matrixCareNameIL", "customerFacilityIdHC", "customerFacilityIdAL", "customerFacilityIdIL"] as const;
        for (const r of validation.records) {
          const nameKey = (r.name || "").trim().toLowerCase();
          if (!nameKey) continue;
          const set: Record<string, any> = {};
          for (const k of updatable) {
            if (r[k] !== null && r[k] !== undefined && r[k] !== "") set[k] = r[k];
          }
          const existingId = byName.get(nameKey);
          if (existingId) {
            if (Object.keys(set).length > 0) {
              await tx.update(locations).set({ ...set, updatedAt: new Date() }).where(eq(locations.id, existingId));
            }
            deleted += 1; // counted as "replaced/updated" in audit
          } else {
            await tx.insert(locations).values({ name: r.name.trim(), ...set, clientId });
          }
          inserted += 1;
        }
      } else if (datasetId === "room_type_occupancy") {
        let slInferredCount = 0;
        let slMissingCount = 0;
        const recs = validation.records.map((r) => {
          const [yearStr, monthStr] = String(r.month || period).split("-");
          const occUnits = r.occUnits ?? 0;
          const availableUnits = r.availableUnits ?? 0;
          // When the uploaded file omits a Service Line column, infer the SL
          // family from the room type name prefix ("AL Companion" → "AL",
          // "HC Companion" → "HC"). Without this, rows for different SL
          // families that normalise to the same room type collapse into a single
          // history record, preventing the rtoRTMap collapse loop from separating
          // AL from HC occupancy at read time.
          let serviceLine = r.serviceLine || '';
          if (!serviceLine) {
            const inferred = inferSlFamilyFromRoomType(r.rawRoomType || '');
            if (inferred) {
              serviceLine = inferred;
              slInferredCount++;
            } else {
              slMissingCount++;
            }
          }
          return {
            clientId,
            locationId: locMap.get((r.locationName || "").trim().toLowerCase()) || null,
            locationName: r.locationName,
            division: r.division,
            serviceLine,
            rawRoomType: r.rawRoomType,
            normalizedRoomType: normalizeRoomType(r.rawRoomType),
            month: parseInt(monthStr, 10),
            year: parseInt(yearStr, 10),
            occUnits,
            availableUnits,
            occPercent: r.occPercent ?? (availableUnits > 0 ? (occUnits / availableUnits) * 100 : null),
          };
        });
        if (slInferredCount > 0) {
          console.warn(`[rto-import] ${slInferredCount} row(s) had no Service Line column — SL inferred from room type name prefix.`);
        }
        if (slMissingCount > 0) {
          console.warn(`[rto-import] ${slMissingCount} row(s) had no Service Line and no recognisable room type prefix — stored with blank service line. These rows may not match RT-level occupancy lookups.`);
        }
        const periodsToReplace = mode === "replace_period"
          ? Array.from(new Set(recs.map((r) => `${r.year}-${r.month}`)))
          : [];
        for (const p of periodsToReplace) {
          const [y, m] = p.split("-").map(Number);
          const del = await tx.delete(roomTypeOccupancyHistory).where(and(
            eq(roomTypeOccupancyHistory.clientId, clientId),
            eq(roomTypeOccupancyHistory.year, y),
            eq(roomTypeOccupancyHistory.month, m),
          )).returning({ id: roomTypeOccupancyHistory.id });
          deleted += del.length;
        }
        // Dedupe against unique index (client, location, sl, normalized rt, month, year): keep last occurrence
        const dedup = new Map<string, typeof recs[number]>();
        for (const r of recs) {
          dedup.set(`${r.locationName}|${r.serviceLine}|${r.normalizedRoomType}|${r.month}|${r.year}`.toLowerCase(), r);
        }
        const finalRecs = Array.from(dedup.values());
        for (let i = 0; i < finalRecs.length; i += 500) {
          await tx.insert(roomTypeOccupancyHistory)
            .values(finalRecs.slice(i, i + 500))
            .onConflictDoNothing();
        }
        inserted = finalRecs.length;
      } else {
        throw new Error(`Import not implemented for dataset: ${datasetId}`);
      }
    });

    const status = validation.errorRows > 0 ? "partial" : "imported";
    const [updated] = await db.update(importRuns).set({
      status,
      insertedRows: inserted,
      deletedRows: deleted,
      completedAt: new Date(),
    }).where(eq(importRuns.id, run.id)).returning();

    await createImportNotification(clientId, run.id,
      validation.errorRows > 0 ? "warning" : "info",
      `${dataset.name} import ${validation.errorRows > 0 ? "partially " : ""}completed`,
      `${params.fileName}: ${inserted} rows imported${period ? ` — period ${period} ${deleted > 0 ? `replaced (${deleted} prior rows removed)` : "added"}` : deleted > 0 ? ` (${deleted} existing records updated)` : ""}${validation.errorRows > 0 ? `; ${validation.errorRows} rows had errors and were skipped` : ""}.`,
    );

    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const [failed] = await db.update(importRuns).set({
      status: "failed",
      errorMessage: message,
      completedAt: new Date(),
    }).where(eq(importRuns.id, run.id)).returning();
    await createImportNotification(clientId, run.id, "error", `${dataset.name} import failed`, `${params.fileName}: ${message}`);
    return failed;
  }
}

export async function createImportNotification(clientId: string, importRunId: string | null, severity: string, title: string, message: string): Promise<void> {
  try {
    await db.insert(importNotifications).values({ clientId, importRunId, severity, title, message });
  } catch (err) {
    console.error("[dataImport] Failed to create notification:", err);
  }
}

export async function recordSkippedRun(params: {
  clientId: string;
  datasetId: string;
  fileName: string;
  fileHash: string | null;
  source: "manual" | "sftp";
  scheduledImportId?: string | null;
  status: "skipped_duplicate" | "failed";
  errorMessage?: string;
}): Promise<ImportRun> {
  const [run] = await db.insert(importRuns).values({
    clientId: params.clientId,
    datasetType: params.datasetId,
    source: params.source,
    scheduledImportId: params.scheduledImportId || null,
    fileName: params.fileName,
    fileHash: params.fileHash,
    status: params.status,
    errorMessage: params.errorMessage || null,
    completedAt: new Date(),
  }).returning();
  return run;
}

export async function getImportRuns(clientId: string, limit = 50): Promise<ImportRun[]> {
  return db.select().from(importRuns)
    .where(eq(importRuns.clientId, clientId))
    .orderBy(desc(importRuns.startedAt))
    .limit(limit);
}

export { IMPORT_DATASETS };
