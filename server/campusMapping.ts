// Campus name mapping between KeyStats (display names) and MatrixCare (export names)
export interface CampusMapping {
  keyStatsName: string;
  matrixCareNameHC?: string;
  matrixCareNameAL?: string;
  matrixCareNameIL?: string;
  customerFacilityIdHC?: string;
  customerFacilityIdAL?: string;
  customerFacilityIdIL?: string;
  locationCode: string;
}

export const campusMapping: CampusMapping[] = [
  { keyStatsName: "Kokomo-106", matrixCareNameHC: "Waterford Health Campus HC", matrixCareNameAL: "Waterford Health Campus AL", customerFacilityIdHC: "18-0106-HC", customerFacilityIdAL: "18-0106-AL", locationCode: "0106" },
  { keyStatsName: "Springfield-401", matrixCareNameHC: "Forest Glen Health Campus HC", matrixCareNameAL: "Forest Glen Health Campus AL", matrixCareNameIL: "Forest Glen Health Campus IL", customerFacilityIdHC: "14-0401-HC", customerFacilityIdAL: "14-0401-AL", customerFacilityIdIL: "14-0401-IL", locationCode: "0401" },
  { keyStatsName: "LexingtonWC-2148", matrixCareNameHC: "The Willows at Citation HC", matrixCareNameAL: "The Willows at Citation AL", customerFacilityIdHC: "14-0148-HC", customerFacilityIdAL: "14-0148-AL", locationCode: "0148" },
  { keyStatsName: "IndianapolisAP-5160", matrixCareNameHC: "Arlington Place Health Campus HC", matrixCareNameAL: "Arlington Place Health Campus AL", customerFacilityIdHC: "18-0160-HC", customerFacilityIdAL: "18-0160-AL", locationCode: "0160" },
  { keyStatsName: "Bloomington-149", matrixCareNameHC: "Hearthstone Health Campus HC", matrixCareNameAL: "Hearthstone Health Campus AL", customerFacilityIdHC: "18-0149-HC", customerFacilityIdAL: "18-0149-AL", locationCode: "0149" },
  { keyStatsName: "Cynthiana-114", matrixCareNameHC: "Cedar Ridge Health Campus HC", matrixCareNameAL: "Cedar Ridge Health Campus AL", customerFacilityIdHC: "14-0114-HC", customerFacilityIdAL: "14-0114-AL", locationCode: "0114" },
  { keyStatsName: "LouisvillePT-127", matrixCareNameHC: "Park Terrace Health Campus HC", customerFacilityIdHC: "14-0127-HC", locationCode: "0127" },
  { keyStatsName: "LouisvilleGR-126", matrixCareNameHC: "Glen Ridge Health Campus HC", customerFacilityIdHC: "14-0126-HC", locationCode: "0126" },
  { keyStatsName: "Georgetown-2146", matrixCareNameHC: "The Willows at Harrodsburg HC", matrixCareNameAL: "The Willows at Harrodsburg AL", customerFacilityIdHC: "14-0146-HC", customerFacilityIdAL: "14-0146-AL", locationCode: "0146" },
  { keyStatsName: "Lexington-3151", matrixCareNameHC: "The Willows at Hamburg HC", matrixCareNameAL: "The Willows at Hamburg AL", customerFacilityIdHC: "14-0151-HC", customerFacilityIdAL: "14-0151-AL", locationCode: "0151" },
  { keyStatsName: "Rensselaer-156", matrixCareNameHC: "Oak Grove Healthcare HC", matrixCareNameAL: "Oak Grove Healthcare AL", customerFacilityIdHC: "18-0156-HC", customerFacilityIdAL: "18-0156-AL", locationCode: "0156" },
  { keyStatsName: "Columbus-110", matrixCareNameHC: "Five Star Residences of Columbus HC", matrixCareNameAL: "Five Star Residences of Columbus AL", customerFacilityIdHC: "18-0110-HC", customerFacilityIdAL: "18-0110-AL", locationCode: "0110" },
  { keyStatsName: "Batesville-120", matrixCareNameHC: "St. Andrews Health Campus HC", matrixCareNameAL: "St. Andrews Health Campus AL", customerFacilityIdHC: "18-0120-HC", customerFacilityIdAL: "18-0120-AL", locationCode: "0120" },
  { keyStatsName: "Lawrenceburg-143", matrixCareNameHC: "RidgeWood Health Campus HC", matrixCareNameAL: "RidgeWood Health Campus AL", customerFacilityIdHC: "18-0143-HC", customerFacilityIdAL: "18-0143-AL", locationCode: "0143" },
  { keyStatsName: "Greensburg-150", matrixCareNameHC: "Aspen Place Health Campus HC", matrixCareNameAL: "Aspen Place Health Campus AL", customerFacilityIdHC: "18-0150-HC", customerFacilityIdAL: "18-0150-AL", locationCode: "0150" },
  { keyStatsName: "Ashland-117", matrixCareNameHC: "Ashland Place Health Campus HC", matrixCareNameAL: "Ashland Place Health Campus AL", customerFacilityIdHC: "11-0117-HC", customerFacilityIdAL: "11-0117-AL", locationCode: "0117" },
  { keyStatsName: "IndianapolisCS-116", matrixCareNameHC: "College Street Health Campus HC", matrixCareNameAL: "College Street Health Campus AL", customerFacilityIdHC: "18-0116-HC", customerFacilityIdAL: "18-0116-AL", locationCode: "0116" },
  { keyStatsName: "Canton-121", matrixCareNameHC: "Ravenwood Health Campus HC", matrixCareNameAL: "Ravenwood Health Campus AL", customerFacilityIdHC: "11-0121-HC", customerFacilityIdAL: "11-0121-AL", locationCode: "0121" },
  { keyStatsName: "Marion-111", matrixCareNameHC: "Glen Oaks Health Campus HC", matrixCareNameAL: "Glen Oaks Health Campus AL", customerFacilityIdHC: "18-0111-HC", customerFacilityIdAL: "18-0111-AL", locationCode: "0111" },
  { keyStatsName: "Delaware-135", matrixCareNameHC: "Peleton Healthcare HC", matrixCareNameAL: "Peleton Healthcare AL", customerFacilityIdHC: "11-0135-HC", customerFacilityIdAL: "11-0135-AL", locationCode: "0135" },
  { keyStatsName: "Mansfield-125", matrixCareNameHC: "Lexington Court Care Center HC", matrixCareNameAL: "Lexington Court Care Center AL", customerFacilityIdHC: "11-0125-HC", customerFacilityIdAL: "11-0125-AL", locationCode: "0125" },
  { keyStatsName: "Sandusky-133", matrixCareNameHC: "Parkvue Healthcare HC", matrixCareNameAL: "Parkvue Healthcare AL", customerFacilityIdHC: "11-0133-HC", customerFacilityIdAL: "11-0133-AL", locationCode: "0133" },
  { keyStatsName: "Ontario-132", matrixCareNameHC: "Ontario Point HC", matrixCareNameAL: "Ontario Point AL", customerFacilityIdHC: "11-0132-HC", customerFacilityIdAL: "11-0132-AL", locationCode: "0132" },
  { keyStatsName: "Findlay-147", matrixCareNameHC: "Ashford Place Health Campus HC", matrixCareNameAL: "Ashford Place Health Campus AL", customerFacilityIdHC: "11-0147-HC", customerFacilityIdAL: "11-0147-AL", locationCode: "0147" },
  { keyStatsName: "Shelbyville-118", matrixCareNameHC: "Harrison Terrace HC", matrixCareNameAL: "Harrison Terrace AL", customerFacilityIdHC: "18-0118-HC", customerFacilityIdAL: "18-0118-AL", locationCode: "0118" },
  { keyStatsName: "Madison-131", matrixCareNameHC: "Heritage Manor Health Campus HC", matrixCareNameAL: "Heritage Manor Health Campus AL", customerFacilityIdHC: "18-0131-HC", customerFacilityIdAL: "18-0131-AL", locationCode: "0131" },
  { keyStatsName: "Mansfield-123", matrixCareNameHC: "Wedgewood Estates HC", matrixCareNameAL: "Wedgewood Estates AL", customerFacilityIdHC: "11-0123-HC", customerFacilityIdAL: "11-0123-AL", locationCode: "0123" },
  { keyStatsName: "Mount Vernon-124", matrixCareNameHC: "Country Club Retirement Campus HC", matrixCareNameAL: "Country Club Retirement Campus AL", customerFacilityIdHC: "11-0124-HC", customerFacilityIdAL: "11-0124-AL", locationCode: "0124" },
  { keyStatsName: "Greensburg-7153", matrixCareNameHC: "Amber Manor Care Center HC", matrixCareNameAL: "Amber Manor Care Center AL", customerFacilityIdHC: "18-0304-HC", customerFacilityIdAL: "18-0304-AL", locationCode: "0304" },
  { keyStatsName: "LexingtonCA-8137", matrixCareNameHC: "Citation Pointe HC", matrixCareNameAL: "Citation Pointe AL", customerFacilityIdHC: "14-0137-HC", customerFacilityIdAL: "14-0137-AL", locationCode: "0137" },
  { keyStatsName: "Hamilton-138", matrixCareNameHC: "West Ridge HC", matrixCareNameAL: "West Ridge AL", customerFacilityIdHC: "11-0138-HC", customerFacilityIdAL: "11-0138-AL", locationCode: "0138" },
];

// Helper functions to convert between naming conventions
export function getMatrixCareNameFromKeyStats(keyStatsName: string, serviceLine: 'HC' | 'AL' | 'IL'): string | undefined {
  const mapping = campusMapping.find(c => c.keyStatsName === keyStatsName);
  if (!mapping) return undefined;
  
  switch (serviceLine) {
    case 'HC': return mapping.matrixCareNameHC;
    case 'AL': return mapping.matrixCareNameAL;
    case 'IL': return mapping.matrixCareNameIL;
  }
}

export function getKeyStatsNameFromMatrixCare(matrixCareName: string): string | undefined {
  // Remove service line suffix if present
  const nameWithoutSuffix = matrixCareName.replace(/ (HC|AL|IL)$/, '');
  
  const mapping = campusMapping.find(c => 
    c.matrixCareNameHC?.includes(nameWithoutSuffix) ||
    c.matrixCareNameAL?.includes(nameWithoutSuffix) ||
    c.matrixCareNameIL?.includes(nameWithoutSuffix)
  );
  
  return mapping?.keyStatsName;
}

export function getCustomerFacilityId(keyStatsName: string, serviceLine: 'HC' | 'AL' | 'IL'): string | undefined {
  const mapping = campusMapping.find(c => c.keyStatsName === keyStatsName);
  if (!mapping) return undefined;
  
  switch (serviceLine) {
    case 'HC': return mapping.customerFacilityIdHC;
    case 'AL': return mapping.customerFacilityIdAL;
    case 'IL': return mapping.customerFacilityIdIL;
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
  });
  return Array.from(facilities).sort();
}