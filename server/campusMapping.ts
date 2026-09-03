import path from "node:path";
import XLSX from "xlsx";

// Campus name mapping between KeyStats (display names) and MatrixCare (export names)
export interface CampusMapping {
  keyStatsName: string;
  aliases?: string[];
  matrixCareNameHC?: string;
  matrixCareNameAL?: string;
  matrixCareNameIL?: string;
  matrixCareNameSL?: string;
  customerFacilityIdHC?: string;
  customerFacilityIdAL?: string;
  customerFacilityIdIL?: string;
  customerFacilityIdSL?: string;
  locationCode: string;
}

type MatrixCareServiceLine = 'HC' | 'AL' | 'IL' | 'SL';
const exactMappingsByName = new Map<string, CampusMapping>();

const AUTHORITATIVE_WORKBOOK = path.resolve(
  process.cwd(),
  "attached_assets/0_Matrix_Location_vs_KeyStats_Location_1788464152590.xlsx",
);

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function serviceLineFor(customerFacilityId: string, facilityName: string): MatrixCareServiceLine {
  const idMatch = customerFacilityId.match(/-(HC|AL|IL|SL)$/i);
  if (idMatch) return idMatch[1].toUpperCase() as MatrixCareServiceLine;

  // Two legacy Crete rows use a shared numeric facility id. Their authoritative
  // names still identify which service-line slot they belong to.
  const nameMatch = facilityName.match(/ (HC|AL|IL|SL)$/i);
  if (nameMatch) return nameMatch[1].toUpperCase() as MatrixCareServiceLine;

  throw new Error(
    `Cannot classify MatrixCare mapping "${facilityName}" (${customerFacilityId}).`,
  );
}

function locationCodeFor(row: unknown[], customerFacilityId: string): string {
  const explicit = text(row[6]) || text(row[2]);
  if (explicit) return explicit.padStart(4, "0");
  const idCode = customerFacilityId.match(/-(\d+)-(?:HC|AL|IL|SL)$/i)?.[1];
  return (idCode || customerFacilityId).padStart(4, "0");
}

function loadAuthoritativeCampusMappings(): CampusMapping[] {
  const workbook = XLSX.readFile(AUTHORITATIVE_WORKBOOK);
  const sourceSheet = workbook.Sheets["Sheet1"];
  const aliasSheet = workbook.Sheets["Map w Spaces"];
  if (!sourceSheet || !aliasSheet) {
    throw new Error("Authoritative MatrixCare workbook is missing a required mapping sheet.");
  }

  const aliasesByKey = new Map<string, Set<string>>();
  const aliasRows = XLSX.utils.sheet_to_json<unknown[]>(aliasSheet, { header: 1, raw: true });
  for (const row of aliasRows.slice(3)) {
    const sourceName = text(row[0]);
    const alias = text(row[1]);
    if (!sourceName || !alias || alias === "-") continue;
    const aliases = aliasesByKey.get(sourceName) ?? new Set<string>();
    aliases.add(alias);
    aliasesByKey.set(sourceName, aliases);
  }

  const byKeyStatsName = new Map<string, CampusMapping>();
  const primaryByLocationCode = new Map<string, CampusMapping>();
  const keyStatsNamesByLocationCode = new Map<string, Set<string>>();
  const sourceRows = XLSX.utils.sheet_to_json<unknown[]>(sourceSheet, { header: 1, raw: true });

  for (const row of sourceRows.slice(1)) {
    const customerFacilityId = text(row[1]);
    const keyStatsName = text(row[3]);
    const matrixCareName = text(row[4]);
    if (!customerFacilityId || !keyStatsName || !matrixCareName) continue;

    const serviceLine = serviceLineFor(customerFacilityId, matrixCareName);
    const locationCode = locationCodeFor(row, customerFacilityId);
    let mapping = byKeyStatsName.get(keyStatsName);
    if (!mapping) {
      mapping = {
        keyStatsName,
        aliases: Array.from(aliasesByKey.get(keyStatsName) ?? []),
        locationCode,
      };
      byKeyStatsName.set(keyStatsName, mapping);
    }

    const linkedNames = keyStatsNamesByLocationCode.get(locationCode) ?? new Set<string>();
    linkedNames.add(keyStatsName);
    keyStatsNamesByLocationCode.set(locationCode, linkedNames);

    const nameField = `matrixCareName${serviceLine}` as const;
    const idField = `customerFacilityId${serviceLine}` as const;
    const existingName = mapping[nameField];
    const existingId = mapping[idField];
    if ((existingName && existingName !== matrixCareName) ||
        (existingId && existingId !== customerFacilityId)) {
      throw new Error(`Conflicting ${serviceLine} MatrixCare mappings for "${keyStatsName}".`);
    }
    mapping[nameField] = matrixCareName;
    mapping[idField] = customerFacilityId;

    // The first occurrence of a service line for a stable campus code is the
    // base identity inherited by aliases that do not carry their own record.
    // Alias-specific rows (for example, a separate Legacy AL or Villas IL)
    // remain on their exact KeyStats mapping and override this inherited pair.
    let primary = primaryByLocationCode.get(locationCode);
    if (!primary) {
      primary = { keyStatsName, aliases: [], locationCode };
      primaryByLocationCode.set(locationCode, primary);
    }
    if (!primary[nameField] && !primary[idField]) {
      primary[nameField] = matrixCareName;
      primary[idField] = customerFacilityId;
    }
  }

  exactMappingsByName.clear();
  for (const mapping of byKeyStatsName.values()) {
    exactMappingsByName.set(mapping.keyStatsName.trim().toLowerCase(), mapping);
    for (const alias of mapping.aliases ?? []) {
      const aliasKey = alias.trim().toLowerCase();
      if (!exactMappingsByName.has(aliasKey)) exactMappingsByName.set(aliasKey, mapping);
    }
  }

  for (const [locationCode, primary] of primaryByLocationCode) {
    const mergedAliases = new Set<string>();
    for (const linkedName of keyStatsNamesByLocationCode.get(locationCode) ?? []) {
      if (linkedName !== primary.keyStatsName) mergedAliases.add(linkedName);
      for (const alias of aliasesByKey.get(linkedName) ?? []) {
        if (alias !== primary.keyStatsName) mergedAliases.add(alias);
      }
    }
    primary.aliases = Array.from(mergedAliases);
  }

  return Array.from(primaryByLocationCode.values());
}

/** Every complete facility row in the current authoritative MatrixCare workbook. */
export const campusMapping: CampusMapping[] = loadAuthoritativeCampusMappings();

// Helper functions to convert between naming conventions
function normalizeKeyStatsName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findCampusMapping(keyStatsName: string): CampusMapping | undefined {
  const exact = keyStatsName.trim().toLowerCase();
  const exactPrimary = campusMapping.find(c => c.keyStatsName.trim().toLowerCase() === exact);
  if (exactPrimary) return exactPrimary;

  const exactAlias = campusMapping.find(c =>
    c.aliases?.some(alias => alias.trim().toLowerCase() === exact),
  );
  if (exactAlias) return exactAlias;

  const normalized = normalizeKeyStatsName(keyStatsName);
  return campusMapping.find(c => normalizeKeyStatsName(c.keyStatsName) === normalized)
    ?? campusMapping.find(c => c.aliases?.some(alias => normalizeKeyStatsName(alias) === normalized));
}

export function getMatrixCareNameFromKeyStats(keyStatsName: string, serviceLine: MatrixCareServiceLine): string | undefined {
  const exactMapping = exactMappingsByName.get(keyStatsName.trim().toLowerCase());
  const exactValue = exactMapping?.[`matrixCareName${serviceLine}`];
  if (exactValue) return exactValue;

  const mapping = findCampusMapping(keyStatsName);
  if (!mapping) return undefined;
  
  switch (serviceLine) {
    case 'HC': return mapping.matrixCareNameHC;
    case 'AL': return mapping.matrixCareNameAL;
    case 'IL': return mapping.matrixCareNameIL;
    case 'SL': return mapping.matrixCareNameSL;
  }
}

export function getKeyStatsNameFromMatrixCare(matrixCareName: string): string | undefined {
  // Remove service line suffix if present
  const nameWithoutSuffix = matrixCareName.replace(/ (HC|AL|IL|SL)$/, '');
  
  const mapping = campusMapping.find(c => 
    c.matrixCareNameHC?.includes(nameWithoutSuffix) ||
    c.matrixCareNameAL?.includes(nameWithoutSuffix) ||
    c.matrixCareNameIL?.includes(nameWithoutSuffix) ||
    c.matrixCareNameSL?.includes(nameWithoutSuffix)
  );
  
  return mapping?.keyStatsName;
}

export function getCustomerFacilityId(keyStatsName: string, serviceLine: MatrixCareServiceLine): string | undefined {
  const exactMapping = exactMappingsByName.get(keyStatsName.trim().toLowerCase());
  const exactValue = exactMapping?.[`customerFacilityId${serviceLine}`];
  if (exactValue) return exactValue;

  const mapping = findCampusMapping(keyStatsName);
  if (!mapping) return undefined;
  
  switch (serviceLine) {
    case 'HC': return mapping.customerFacilityIdHC;
    case 'AL': return mapping.customerFacilityIdAL;
    case 'IL': return mapping.customerFacilityIdIL;
    case 'SL': return mapping.customerFacilityIdSL;
  }
}

export function getAllKeyStatsCampuses(): string[] {
  return campusMapping.map(c => c.keyStatsName).sort();
}

export function getAllMatrixCareFacilities(): string[] {
  const facilities = new Set<string>();
  campusMapping.forEach(c => {
    if (c.matrixCareNameHC) facilities.add(c.matrixCareNameHC);
    if (c.matrixCareNameAL) facilities.add(c.matrixCareNameAL);
    if (c.matrixCareNameIL) facilities.add(c.matrixCareNameIL);
    if (c.matrixCareNameSL) facilities.add(c.matrixCareNameSL);
  });
  return Array.from(facilities).sort();
}