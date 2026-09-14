// @ts-nocheck
import ExcelJS from "exceljs";
import path from "node:path";

export type NicMapPropertyType = "Majority IL" | "Majority AL";

export type NicMapRateTierPoint = {
  month: string;
  top: number | null;
  p75: number | null;
  middle: number | null;
  p25: number | null;
  bottom: number | null;
};

export type NicMapRateTierBenchmark = {
  key: string;
  label: string;
  geography: string;
  propertyType: NicMapPropertyType;
  display: "middle" | "tiers";
  appliesToKey?: string;
  matchMethod: "combined_markets" | "exact_city" | "nearby_metro";
  sourceName: "NIC MAP®";
  sourceUrl: string;
  asOf: "2Q2026";
  points: NicMapRateTierPoint[];
};

type WorkbookRow = NicMapRateTierPoint & {
  geography: string;
  propertyType: NicMapPropertyType;
};

type CampusLocation = {
  city?: string | null;
  state?: string | null;
  lat?: number | null;
  lng?: number | null;
};

const SOURCE_FILE = path.resolve(
  process.cwd(),
  "attached_assets/NIC_MAP_RateTiers_All_Metros_2Q2026_1789243681563.xlsx",
);
const SOURCE_URL = "https://www.nicmap.com/data-attribution-requirements/";
const COMBINED_MARKETS = "Primary and Secondary Markets";
const METROS = [
  { geography: "Cincinnati, OH", city: "cincinnati", state: "OH", lat: 39.1031, lng: -84.512, radiusMiles: 55 },
  { geography: "Cleveland, OH", city: "cleveland", state: "OH", lat: 41.4993, lng: -81.6944, radiusMiles: 55 },
  { geography: "Detroit, MI", city: "detroit", state: "MI", lat: 42.3314, lng: -83.0458, radiusMiles: 55 },
] as const;

let workbookRowsPromise: Promise<WorkbookRow[]> | null = null;

function text(value: ExcelJS.CellValue): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function numeric(value: ExcelJS.CellValue): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function quarterToMonth(quarter: string): string | null {
  const match = /^([1-4])Q(\d{4})$/.exec(quarter.trim());
  if (!match) return null;
  return `${match[2]}-${String(Number(match[1]) * 3).padStart(2, "0")}`;
}

async function readWorkbookRows(): Promise<WorkbookRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(SOURCE_FILE);
  const worksheet = workbook.getWorksheet("Rate Tiers");
  if (!worksheet) throw new Error("NIC MAP rate-tier workbook is missing the Rate Tiers sheet");

  const rows: WorkbookRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber < 4) return;
    const geography = text(row.getCell(1).value);
    const propertyType = text(row.getCell(2).value);
    const month = quarterToMonth(text(row.getCell(3).value));
    if (!month || (propertyType !== "Majority IL" && propertyType !== "Majority AL")) return;
    if (geography !== COMBINED_MARKETS && !METROS.some((metro) => metro.geography === geography)) return;
    rows.push({
      geography,
      propertyType,
      month,
      top: numeric(row.getCell(7).value),
      p75: numeric(row.getCell(8).value),
      middle: numeric(row.getCell(9).value),
      p25: numeric(row.getCell(10).value),
      bottom: numeric(row.getCell(11).value),
    });
  });
  if (!rows.length) throw new Error("NIC MAP rate-tier workbook contains no usable rows");
  return rows;
}

async function workbookRows(): Promise<WorkbookRow[]> {
  if (!workbookRowsPromise) {
    workbookRowsPromise = readWorkbookRows().catch((error) => {
      workbookRowsPromise = null;
      throw error;
    });
  }
  return workbookRowsPromise;
}

function distanceMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(bLat - aLat);
  const dLng = radians(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

export function matchNicMapGeography(location?: CampusLocation | null): {
  geography: string;
  matchMethod: NicMapRateTierBenchmark["matchMethod"];
} {
  if (!location) return { geography: COMBINED_MARKETS, matchMethod: "combined_markets" };
  const city = location.city?.trim().toLowerCase();
  const state = location.state?.trim().toUpperCase();
  const exact = METROS.find((metro) => metro.city === city && metro.state === state);
  if (exact) return { geography: exact.geography, matchMethod: "exact_city" };

  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && state) {
    const nearby = METROS
      .filter((metro) => metro.state === state)
      .map((metro) => ({ metro, distance: distanceMiles(lat, lng, metro.lat, metro.lng) }))
      .filter(({ metro, distance }) => distance <= metro.radiusMiles)
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearby) return { geography: nearby.metro.geography, matchMethod: "nearby_metro" };
  }
  return { geography: COMBINED_MARKETS, matchMethod: "combined_markets" };
}

function propertyTypes(serviceLine?: string): NicMapPropertyType[] {
  if (serviceLine === "VIL") return ["Majority IL"];
  if (serviceLine && ["AL", "AL/MC", "SL"].includes(serviceLine)) return ["Majority AL"];
  return ["Majority IL", "Majority AL"];
}

export async function getNicMapRateTierBenchmarks(options: {
  group?: string;
  serviceLine?: string;
  location?: CampusLocation | null;
}): Promise<NicMapRateTierBenchmark[]> {
  if (options.group === "SNF" || options.serviceLine === "HC" || options.serviceLine === "HC/MC") {
    return [];
  }
  const rows = await workbookRows();
  const matched = matchNicMapGeography(options.location);
  const types = propertyTypes(options.serviceLine);
  return types.map((propertyType) => {
    const points = rows
      .filter((row) => row.geography === matched.geography && row.propertyType === propertyType)
      .map(({ month, top, p75, middle, p25, bottom }) => ({ month, top, p75, middle, p25, bottom }))
      .sort((a, b) => a.month.localeCompare(b.month));
    const profile = propertyType === "Majority IL" ? "IL" : "AL";
    return {
      key: `nic-${matched.geography}-${profile}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      label: `${matched.geography} · ${profile}`,
      geography: matched.geography,
      propertyType,
      display: options.serviceLine ? "tiers" : "middle",
      appliesToKey: options.group ? undefined : "Senior Housing",
      matchMethod: matched.matchMethod,
      sourceName: "NIC MAP®",
      sourceUrl: SOURCE_URL,
      asOf: "2Q2026",
      points,
    };
  }).filter((benchmark) => benchmark.points.length > 0);
}