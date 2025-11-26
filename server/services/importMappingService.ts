import { db } from "../db";
import { importMappingProfiles, type ImportMappingProfile, type InsertImportMappingProfile } from "@shared/schema";
import { eq, and, desc, isNull } from "drizzle-orm";

export interface ColumnMapping {
  sourceColumn: string;
  targetField: string;
  isRequired: boolean;
  transform?: string;
}

export interface FieldAlias {
  targetField: string;
  aliases: string[];
}

export interface MappingProfile {
  id: string;
  name: string;
  description?: string;
  isBuiltIn: boolean;
  isDefault: boolean;
  columnMappings: Record<string, string>;
  fieldAliases: FieldAlias[];
  dataTransformations?: Record<string, string>;
}

export interface DetectedMapping {
  sourceColumn: string;
  targetField: string | null;
  confidence: number;
  matchType: 'exact' | 'alias' | 'fuzzy' | 'none';
  isRequired: boolean;
}

export interface MappingPreview {
  detectedMappings: DetectedMapping[];
  unmappedSourceColumns: string[];
  unmappedRequiredFields: string[];
  suggestedProfile: string | null;
  confidenceScore: number;
}

const REQUIRED_FIELDS = [
  'uploadMonth', 'date', 'location', 'roomNumber', 'roomType', 
  'serviceLine', 'occupiedYN', 'size', 'streetRate', 'inHouseRate'
];

const OPTIONAL_FIELDS = [
  'daysVacant', 'preferredLocation', 'view', 'renovated', 'otherPremiumFeature',
  'locationRating', 'sizeRating', 'viewRating', 'renovationRating', 'amenityRating',
  'discountToStreetRate', 'careLevel', 'careRate', 'rentAndCareRate',
  'competitorRate', 'competitorAvgCareRate', 'competitorFinalRate',
  'moduloSuggestedRate', 'aiSuggestedRate', 'promotionAllowance',
  'residentId', 'residentName', 'moveInDate', 'moveOutDate', 'payorType',
  'admissionStatus', 'levelOfCare', 'medicaidRate', 'medicareRate',
  'assessmentDate', 'marketingSource', 'inquiryCount', 'tourCount'
];

const BUILT_IN_PROFILES: Omit<MappingProfile, 'id'>[] = [
  {
    name: 'Trilogy Format',
    description: 'Default format for Trilogy Health Services data exports',
    isBuiltIn: true,
    isDefault: true,
    columnMappings: {
      'Upload Month': 'uploadMonth',
      'Date': 'date',
      'Location': 'location',
      'Room Number': 'roomNumber',
      'Room Type': 'roomType',
      'Service Line': 'serviceLine',
      'Occupied Y/N': 'occupiedYN',
      'Days Vacant': 'daysVacant',
      'Preferred Location': 'preferredLocation',
      'Size': 'size',
      'View': 'view',
      'Renovated': 'renovated',
      'Other Premium Feature': 'otherPremiumFeature',
      'Location Rating': 'locationRating',
      'Size Rating': 'sizeRating',
      'View Rating': 'viewRating',
      'Renovation Rating': 'renovationRating',
      'Amenity Rating': 'amenityRating',
      'Street Rate': 'streetRate',
      'In-House Rate': 'inHouseRate',
      'Discount to Street Rate': 'discountToStreetRate',
      'Care Level': 'careLevel',
      'Care Rate': 'careRate',
      'Rent and Care Rate': 'rentAndCareRate',
      'Competitor Rate': 'competitorRate',
      'Competitor Average Care Rate': 'competitorAvgCareRate',
      'Competitor Final Rate': 'competitorFinalRate',
      'Modulo Suggested Rate': 'moduloSuggestedRate',
      'AI Suggested Rate': 'aiSuggestedRate',
      'Promotion Allowance': 'promotionAllowance'
    },
    fieldAliases: [
      { targetField: 'uploadMonth', aliases: ['Upload_Month', 'upload_month', 'Month', 'Period', 'Report Month'] },
      { targetField: 'date', aliases: ['Date', 'Report_Date', 'report_date', 'As Of Date'] },
      { targetField: 'location', aliases: ['Location', 'Campus', 'Facility', 'Community', 'Property', 'location_name'] },
      { targetField: 'roomNumber', aliases: ['Room Number', 'Room_Number', 'room_number', 'Unit_ID', 'Unit ID', 'Unit', 'unit_id', 'Room', 'Room #', 'Apt', 'Apartment'] },
      { targetField: 'roomType', aliases: ['Room Type', 'Room_Type', 'room_type', 'Unit Type', 'Unit_Type', 'Type', 'Bed Type', 'Bed_Type'] },
      { targetField: 'serviceLine', aliases: ['Service Line', 'Service_Line', 'service_line', 'Level of Care', 'Care Type', 'LOC'] },
      { targetField: 'occupiedYN', aliases: ['Occupied Y/N', 'Occupied_YN', 'occupied_yn', 'Occupied', 'Is Occupied', 'Occupancy', 'Status'] },
      { targetField: 'daysVacant', aliases: ['Days Vacant', 'Days_Vacant', 'days_vacant', 'Vacant Days', 'Days Empty'] },
      { targetField: 'size', aliases: ['Size', 'Unit Size', 'Sq Ft', 'Square Feet', 'Bedroom', 'Bedrooms', 'BR'] },
      { targetField: 'streetRate', aliases: ['Street Rate', 'Street_Rate', 'street_rate', 'Base Rent', 'Base_Rent', 'Market Rate', 'List Rate', 'Asking Rate'] },
      { targetField: 'inHouseRate', aliases: ['In-House Rate', 'In_House_Rate', 'in_house_rate', 'Current Rate', 'Actual Rate', 'Resident Rate'] },
      { targetField: 'careLevel', aliases: ['Care Level', 'Care_Level', 'care_level', 'Level', 'LOC Level'] },
      { targetField: 'careRate', aliases: ['Care Rate', 'Care_Rate', 'care_rate', 'Care Fee', 'Care_Fee', 'Care Charge'] },
      { targetField: 'view', aliases: ['View', 'Unit View', 'Room View'] },
      { targetField: 'renovated', aliases: ['Renovated', 'Is Renovated', 'Recently Renovated', 'Updated'] },
      { targetField: 'preferredLocation', aliases: ['Preferred Location', 'Preferred_Location', 'Premium Location', 'Premium'] }
    ]
  },
  {
    name: 'Standard Industry Format',
    description: 'Generic format used by most senior living software systems',
    isBuiltIn: true,
    isDefault: false,
    columnMappings: {
      'Period': 'uploadMonth',
      'Report_Date': 'date',
      'Property_Name': 'location',
      'Unit_Number': 'roomNumber',
      'Unit_Type': 'roomType',
      'Care_Level': 'serviceLine',
      'Occupied': 'occupiedYN',
      'Days_Empty': 'daysVacant',
      'Floor_Plan': 'size',
      'Market_Rate': 'streetRate',
      'Actual_Rate': 'inHouseRate',
      'Care_Type': 'careLevel',
      'Care_Charge': 'careRate'
    },
    fieldAliases: [
      { targetField: 'uploadMonth', aliases: ['Period', 'Report_Period', 'Month', 'As_Of_Date'] },
      { targetField: 'date', aliases: ['Report_Date', 'As_Of', 'Date', 'Reporting_Date'] },
      { targetField: 'location', aliases: ['Property_Name', 'Property', 'Community_Name', 'Facility_Name', 'Site'] },
      { targetField: 'roomNumber', aliases: ['Unit_Number', 'Unit_No', 'Room_No', 'Apt_Number', 'Space_ID'] },
      { targetField: 'roomType', aliases: ['Unit_Type', 'Apartment_Type', 'Space_Type', 'Room_Category'] },
      { targetField: 'serviceLine', aliases: ['Care_Level', 'Service_Type', 'Level_Of_Care', 'Care_Category'] },
      { targetField: 'occupiedYN', aliases: ['Occupied', 'Is_Occupied', 'Occupancy_Status', 'Vacancy_Status'] },
      { targetField: 'daysVacant', aliases: ['Days_Empty', 'Vacant_Days', 'Days_Unoccupied'] },
      { targetField: 'size', aliases: ['Floor_Plan', 'Unit_Size', 'Square_Footage', 'Bedroom_Count'] },
      { targetField: 'streetRate', aliases: ['Market_Rate', 'List_Price', 'Asking_Rate', 'Posted_Rate'] },
      { targetField: 'inHouseRate', aliases: ['Actual_Rate', 'Current_Rate', 'Charged_Rate', 'Monthly_Rent'] },
      { targetField: 'careLevel', aliases: ['Care_Type', 'Level', 'Care_Tier'] },
      { targetField: 'careRate', aliases: ['Care_Charge', 'Care_Amount', 'Care_Fee', 'Level_Fee'] }
    ]
  },
  {
    name: 'MatrixCare Export',
    description: 'Format for MatrixCare system data exports',
    isBuiltIn: true,
    isDefault: false,
    columnMappings: {
      'Report Month': 'uploadMonth',
      'As Of Date': 'date',
      'Facility': 'location',
      'Room': 'roomNumber',
      'Bed Type': 'roomType',
      'Level of Care': 'serviceLine',
      'Status': 'occupiedYN',
      'Days Since Last Occupancy': 'daysVacant',
      'Bedroom': 'size',
      'Base Rate': 'streetRate',
      'Current Charge': 'inHouseRate',
      'Care Tier': 'careLevel',
      'Care Amount': 'careRate',
      'Resident ID': 'residentId',
      'Resident Name': 'residentName',
      'Admission Date': 'moveInDate',
      'Discharge Date': 'moveOutDate',
      'Payor': 'payorType'
    },
    fieldAliases: [
      { targetField: 'uploadMonth', aliases: ['Report Month', 'Reporting Period'] },
      { targetField: 'date', aliases: ['As Of Date', 'Report Date'] },
      { targetField: 'location', aliases: ['Facility', 'Facility Name', 'Campus Name'] },
      { targetField: 'roomNumber', aliases: ['Room', 'Room Number', 'Bed', 'Unit'] },
      { targetField: 'roomType', aliases: ['Bed Type', 'Room Type', 'Accommodation Type'] },
      { targetField: 'serviceLine', aliases: ['Level of Care', 'LOC', 'Care Level'] },
      { targetField: 'occupiedYN', aliases: ['Status', 'Occupancy', 'Bed Status'] },
      { targetField: 'daysVacant', aliases: ['Days Since Last Occupancy', 'Days Vacant', 'Empty Days'] },
      { targetField: 'size', aliases: ['Bedroom', 'Bedrooms', 'Unit Size'] },
      { targetField: 'streetRate', aliases: ['Base Rate', 'Room Rate', 'Daily Rate'] },
      { targetField: 'inHouseRate', aliases: ['Current Charge', 'Actual Charge', 'Billed Rate'] },
      { targetField: 'careLevel', aliases: ['Care Tier', 'Assessment Level', 'Care Category'] },
      { targetField: 'careRate', aliases: ['Care Amount', 'Care Charge', 'Level Fee'] },
      { targetField: 'residentId', aliases: ['Resident ID', 'Patient ID', 'Client ID'] },
      { targetField: 'residentName', aliases: ['Resident Name', 'Patient Name', 'Client Name'] },
      { targetField: 'moveInDate', aliases: ['Admission Date', 'Move In', 'Admit Date'] },
      { targetField: 'moveOutDate', aliases: ['Discharge Date', 'Move Out', 'Discharge'] },
      { targetField: 'payorType', aliases: ['Payor', 'Payer', 'Payment Source', 'Payer Type'] }
    ]
  }
];

function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[_\-\s]+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function calculateSimilarity(str1: string, str2: string): number {
  const s1 = normalizeString(str1);
  const s2 = normalizeString(str2);
  
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  
  const len1 = s1.length;
  const len2 = s2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  return maxLen === 0 ? 1.0 : 1 - distance / maxLen;
}

export class ImportMappingService {
  private builtInProfiles: Map<string, MappingProfile> = new Map();

  constructor() {
    BUILT_IN_PROFILES.forEach((profile, index) => {
      const id = `builtin-${index}`;
      this.builtInProfiles.set(id, { ...profile, id });
    });
  }

  async getAllProfiles(): Promise<MappingProfile[]> {
    const dbProfiles = await db.select().from(importMappingProfiles).orderBy(desc(importMappingProfiles.createdAt));
    
    const profiles: MappingProfile[] = [
      ...Array.from(this.builtInProfiles.values()),
      ...dbProfiles.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description || undefined,
        isBuiltIn: p.isBuiltIn || false,
        isDefault: p.isDefault || false,
        columnMappings: (p.columnMappings as Record<string, string>) || {},
        fieldAliases: (p.fieldAliases as FieldAlias[]) || [],
        dataTransformations: p.dataTransformations as Record<string, string> | undefined
      }))
    ];

    return profiles;
  }

  async getProfileById(id: string): Promise<MappingProfile | null> {
    if (this.builtInProfiles.has(id)) {
      return this.builtInProfiles.get(id)!;
    }

    const [profile] = await db.select().from(importMappingProfiles).where(eq(importMappingProfiles.id, id));
    if (!profile) return null;

    return {
      id: profile.id,
      name: profile.name,
      description: profile.description || undefined,
      isBuiltIn: profile.isBuiltIn || false,
      isDefault: profile.isDefault || false,
      columnMappings: (profile.columnMappings as Record<string, string>) || {},
      fieldAliases: (profile.fieldAliases as FieldAlias[]) || [],
      dataTransformations: profile.dataTransformations as Record<string, string> | undefined
    };
  }

  async getDefaultProfile(): Promise<MappingProfile> {
    const [dbDefault] = await db.select()
      .from(importMappingProfiles)
      .where(eq(importMappingProfiles.isDefault, true))
      .limit(1);

    if (dbDefault) {
      return {
        id: dbDefault.id,
        name: dbDefault.name,
        description: dbDefault.description || undefined,
        isBuiltIn: dbDefault.isBuiltIn || false,
        isDefault: true,
        columnMappings: (dbDefault.columnMappings as Record<string, string>) || {},
        fieldAliases: (dbDefault.fieldAliases as FieldAlias[]) || [],
        dataTransformations: dbDefault.dataTransformations as Record<string, string> | undefined
      };
    }

    return Array.from(this.builtInProfiles.values()).find(p => p.isDefault) || 
           Array.from(this.builtInProfiles.values())[0];
  }

  async createProfile(data: Omit<InsertImportMappingProfile, 'isBuiltIn'>): Promise<MappingProfile> {
    const [created] = await db.insert(importMappingProfiles)
      .values({ ...data, isBuiltIn: false })
      .returning();

    return {
      id: created.id,
      name: created.name,
      description: created.description || undefined,
      isBuiltIn: false,
      isDefault: created.isDefault || false,
      columnMappings: (created.columnMappings as Record<string, string>) || {},
      fieldAliases: (created.fieldAliases as FieldAlias[]) || [],
      dataTransformations: created.dataTransformations as Record<string, string> | undefined
    };
  }

  async updateProfile(id: string, data: Partial<InsertImportMappingProfile>): Promise<MappingProfile | null> {
    if (this.builtInProfiles.has(id)) {
      throw new Error('Cannot modify built-in profiles');
    }

    const [updated] = await db.update(importMappingProfiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(importMappingProfiles.id, id))
      .returning();

    if (!updated) return null;

    return {
      id: updated.id,
      name: updated.name,
      description: updated.description || undefined,
      isBuiltIn: updated.isBuiltIn || false,
      isDefault: updated.isDefault || false,
      columnMappings: (updated.columnMappings as Record<string, string>) || {},
      fieldAliases: (updated.fieldAliases as FieldAlias[]) || [],
      dataTransformations: updated.dataTransformations as Record<string, string> | undefined
    };
  }

  async deleteProfile(id: string): Promise<boolean> {
    if (this.builtInProfiles.has(id)) {
      throw new Error('Cannot delete built-in profiles');
    }

    const result = await db.delete(importMappingProfiles)
      .where(eq(importMappingProfiles.id, id));

    return true;
  }

  async detectMappings(sourceColumns: string[], profileId?: string): Promise<MappingPreview> {
    let profile: MappingProfile;
    
    if (profileId) {
      const found = await this.getProfileById(profileId);
      profile = found || await this.getDefaultProfile();
    } else {
      profile = await this.getDefaultProfile();
    }

    const detectedMappings: DetectedMapping[] = [];
    const mappedTargetFields = new Set<string>();
    const mappedSourceColumns = new Set<string>();

    const allProfiles = await this.getAllProfiles();
    let bestProfile = profile;
    let bestScore = 0;

    for (const p of allProfiles) {
      const score = this.calculateProfileMatchScore(sourceColumns, p);
      if (score > bestScore) {
        bestScore = score;
        bestProfile = p;
      }
    }

    if (!profileId && bestScore > 0.5) {
      profile = bestProfile;
    }

    for (const sourceCol of sourceColumns) {
      const mapping = this.findBestMapping(sourceCol, profile);
      
      if (mapping.targetField && !mappedTargetFields.has(mapping.targetField)) {
        detectedMappings.push(mapping);
        mappedTargetFields.add(mapping.targetField);
        mappedSourceColumns.add(sourceCol);
      } else {
        detectedMappings.push({
          sourceColumn: sourceCol,
          targetField: null,
          confidence: 0,
          matchType: 'none',
          isRequired: false
        });
      }
    }

    const unmappedSourceColumns = sourceColumns.filter(col => !mappedSourceColumns.has(col));
    const unmappedRequiredFields = REQUIRED_FIELDS.filter(field => !mappedTargetFields.has(field));

    const mappedRequiredCount = REQUIRED_FIELDS.filter(f => mappedTargetFields.has(f)).length;
    const confidenceScore = mappedRequiredCount / REQUIRED_FIELDS.length;

    return {
      detectedMappings,
      unmappedSourceColumns,
      unmappedRequiredFields,
      suggestedProfile: bestScore > 0.5 ? bestProfile.name : null,
      confidenceScore
    };
  }

  private calculateProfileMatchScore(sourceColumns: string[], profile: MappingProfile): number {
    let matches = 0;
    const normalizedSource = sourceColumns.map(normalizeString);

    for (const [sourceKey, targetField] of Object.entries(profile.columnMappings)) {
      const normalizedKey = normalizeString(sourceKey);
      if (normalizedSource.some(s => s === normalizedKey)) {
        matches++;
      }
    }

    for (const alias of profile.fieldAliases) {
      for (const a of alias.aliases) {
        const normalizedAlias = normalizeString(a);
        if (normalizedSource.some(s => s === normalizedAlias)) {
          matches++;
          break;
        }
      }
    }

    return matches / Math.max(Object.keys(profile.columnMappings).length, 1);
  }

  private findBestMapping(sourceColumn: string, profile: MappingProfile): DetectedMapping {
    const normalizedSource = normalizeString(sourceColumn);
    const isRequired = REQUIRED_FIELDS.some(f => normalizeString(f) === normalizedSource);

    for (const [sourceKey, targetField] of Object.entries(profile.columnMappings)) {
      if (normalizeString(sourceKey) === normalizedSource) {
        return {
          sourceColumn,
          targetField,
          confidence: 1.0,
          matchType: 'exact',
          isRequired: REQUIRED_FIELDS.includes(targetField)
        };
      }
    }

    for (const alias of profile.fieldAliases) {
      for (const a of alias.aliases) {
        if (normalizeString(a) === normalizedSource) {
          return {
            sourceColumn,
            targetField: alias.targetField,
            confidence: 0.95,
            matchType: 'alias',
            isRequired: REQUIRED_FIELDS.includes(alias.targetField)
          };
        }
      }
    }

    let bestMatch: { targetField: string; similarity: number } | null = null;

    for (const targetField of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
      const similarity = calculateSimilarity(sourceColumn, targetField);
      if (similarity >= 0.7 && (!bestMatch || similarity > bestMatch.similarity)) {
        bestMatch = { targetField, similarity };
      }
    }

    for (const alias of profile.fieldAliases) {
      for (const a of alias.aliases) {
        const similarity = calculateSimilarity(sourceColumn, a);
        if (similarity >= 0.7 && (!bestMatch || similarity > bestMatch.similarity)) {
          bestMatch = { targetField: alias.targetField, similarity };
        }
      }
    }

    if (bestMatch) {
      return {
        sourceColumn,
        targetField: bestMatch.targetField,
        confidence: bestMatch.similarity,
        matchType: 'fuzzy',
        isRequired: REQUIRED_FIELDS.includes(bestMatch.targetField)
      };
    }

    return {
      sourceColumn,
      targetField: null,
      confidence: 0,
      matchType: 'none',
      isRequired: false
    };
  }

  applyMappings(row: Record<string, any>, mappings: DetectedMapping[]): Record<string, any> {
    const result: Record<string, any> = {};

    for (const mapping of mappings) {
      if (mapping.targetField && mapping.sourceColumn in row) {
        const value = row[mapping.sourceColumn];
        result[mapping.targetField] = this.transformValue(value, mapping.targetField);
      }
    }

    return result;
  }

  private transformValue(value: any, targetField: string): any {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    switch (targetField) {
      case 'occupiedYN':
        if (typeof value === 'boolean') return value;
        const strVal = String(value).toLowerCase().trim();
        return strVal === 'y' || strVal === 'yes' || strVal === 'true' || strVal === '1' || strVal === 'occupied';

      case 'renovated':
        if (typeof value === 'boolean') return value;
        const renovatedVal = String(value).toLowerCase().trim();
        return renovatedVal === 'y' || renovatedVal === 'yes' || renovatedVal === 'true' || renovatedVal === '1';

      case 'daysVacant':
      case 'inquiryCount':
      case 'tourCount':
        const intVal = parseInt(String(value), 10);
        return isNaN(intVal) ? 0 : intVal;

      case 'streetRate':
      case 'inHouseRate':
      case 'careRate':
      case 'discountToStreetRate':
      case 'rentAndCareRate':
      case 'competitorRate':
      case 'competitorAvgCareRate':
      case 'competitorFinalRate':
      case 'moduloSuggestedRate':
      case 'aiSuggestedRate':
      case 'promotionAllowance':
      case 'medicaidRate':
      case 'medicareRate':
        const floatVal = parseFloat(String(value).replace(/[$,]/g, ''));
        return isNaN(floatVal) ? null : floatVal;

      case 'serviceLine':
        const normalizedService = String(value).toUpperCase().trim();
        const serviceLineMap: Record<string, string> = {
          'AL': 'AL',
          'ASSISTED LIVING': 'AL',
          'ASSISTED': 'AL',
          'MC': 'AL/MC',
          'MEMORY CARE': 'AL/MC',
          'AL/MC': 'AL/MC',
          'HC': 'HC',
          'SKILLED': 'HC',
          'SKILLED NURSING': 'HC',
          'SNF': 'HC',
          'HC/MC': 'HC/MC',
          'SL': 'SL',
          'SENIOR LIVING': 'SL',
          'VIL': 'VIL',
          'IL': 'VIL',
          'INDEPENDENT': 'VIL',
          'INDEPENDENT LIVING': 'VIL'
        };
        return serviceLineMap[normalizedService] || normalizedService;

      case 'size':
        const sizeStr = String(value).toLowerCase().trim();
        if (sizeStr.includes('studio') || sizeStr === '0' || sizeStr === 'stu') return 'Studio';
        if (sizeStr.includes('1') || sizeStr.includes('one')) return 'One Bedroom';
        if (sizeStr.includes('2') || sizeStr.includes('two')) return 'Two Bedroom';
        return value;

      default:
        return String(value).trim();
    }
  }

  getRequiredFields(): string[] {
    return [...REQUIRED_FIELDS];
  }

  getOptionalFields(): string[] {
    return [...OPTIONAL_FIELDS];
  }
}

export const importMappingService = new ImportMappingService();
