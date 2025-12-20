import { SelectRentRollData } from '@shared/schema';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import OpenAI from 'openai';

// MatrixCare field mappings
interface MatrixCareRow {
  FacilityName: string;
  FacilityCustomerID: string;
  BedTypeDescription: string;
  LevelofCare: string;
  RoomChargeDescription: string;
  BasePriceBeginDate: string;
  BasePrice: number;
  BasePriceChargeBy: string;
  PayerBeginDate: string;
  PayerName: string;
  PayerChargeBy: string;
  Proration: string;
  RevenueCode: string;
  AllowableCharge: number;
  AllowablePercent: number;
  HospBedHoldRate: number;
  HospBedHoldPercent: number;
  TherBedHoldRate: number;
  TherBedHoldPercent: number;
  RevenueAccount: string;
  ContractualAccount: string;
  CopayContractualAccount: string;
}

// Map our service lines to MatrixCare level of care
const mapServiceLineToLevelOfCare = (serviceLine: string): string => {
  const mappings: Record<string, string> = {
    'HC': 'BASE RATE - SKILLED - ACTIVE',
    'SNF': 'BASE RATE - SKILLED - ACTIVE',
    'AL': 'BASE RATE - INTERMED - ACTIVE',
    'MC': 'BASE RATE - INTERMED - ACTIVE',
    'AL/MC': 'BASE RATE - INTERMED - ACTIVE',
    'SL': 'BASE RATE - INTERMED - ACTIVE',
    'VIL': 'BASE RATE - INTERMED - ACTIVE'
  };
  return mappings[serviceLine] || 'BASE RATE - INTERMED - ACTIVE';
};

// Map room types to MatrixCare bed type descriptions
const mapRoomTypeToBedType = (rentRollData: SelectRentRollData): string => {
  let bedType = rentRollData.roomType || 'Private';
  
  // Add A/B/C ratings if available
  const ratings: string[] = [];
  if (rentRollData.viewRating) {
    ratings.push(`${rentRollData.viewRating} Vw`);
  }
  if (rentRollData.locationRating) {
    ratings.push(`${rentRollData.locationRating} Loc`);
  }
  if (rentRollData.sizeRating) {
    ratings.push(`${rentRollData.sizeRating} Sz`);
  }
  
  if (ratings.length > 0) {
    bedType = `${bedType};${ratings.join(';')}`;
  }
  
  return bedType;
};

// Generate revenue account codes based on service line
const getRevenueAccount = (serviceLine: string): string => {
  const accountMappings: Record<string, string> = {
    'HC': '~C01-41010',
    'SNF': '~C01-41010',
    'AL': '~C01-41010',
    'MC': '~C02-41013',
    'AL/MC': '~C02-41013',
    'SL': '~C01-41010',
    'VIL': '~C01-41010'
  };
  return accountMappings[serviceLine] || '~C01-41010';
};

// Map payor types
const mapPayorType = (payorType: string | null | undefined): string => {
  if (!payorType) return 'Private HCC';
  
  const payorMappings: Record<string, string> = {
    'Private Pay': 'Private HCC',
    'Medicaid': 'Medicaid',
    'Medicare': 'Medicare Part A',
    'Insurance': 'Insurance',
    'Hospice': 'Hospice Private',
    'VA': 'Veterans Administration'
  };
  
  return payorMappings[payorType] || 'Private HCC';
};

// Get facility customer ID format
const getFacilityCustomerId = (location: string, serviceLine: string): string => {
  // Generate a consistent ID format based on location
  const locationCode = location.replace(/[^A-Z0-9]/gi, '').substring(0, 6).toUpperCase();
  const serviceCode = serviceLine === 'HC' || serviceLine === 'SNF' ? 'HC' : 
                       serviceLine === 'AL' || serviceLine === 'MC' ? 'AL' : 
                       serviceLine === 'VIL' ? 'VIL' : 'SL';
  return `~14-${locationCode}-${serviceCode}`;
};

export function transformToMatrixCareFormat(
  rentRollData: SelectRentRollData[],
  exportMonth: string = format(new Date(), 'M/d/yyyy')
): MatrixCareRow[] {
  const matrixCareRows: MatrixCareRow[] = [];
  
  // Group data by facility and create appropriate rows
  const facilitiesMap = new Map<string, SelectRentRollData[]>();
  
  rentRollData.forEach(row => {
    const facilityKey = row.location;
    if (!facilitiesMap.has(facilityKey)) {
      facilitiesMap.set(facilityKey, []);
    }
    facilitiesMap.get(facilityKey)!.push(row);
  });
  
  // Generate rows for each facility
  facilitiesMap.forEach((facilityData, facilityName) => {
    // Get unique combinations of bed types and service lines
    const uniqueCombinations = new Map<string, { bedType: string, serviceLine: string, basePrice: number }>();
    
    facilityData.forEach(row => {
      const bedType = mapRoomTypeToBedType(row);
      const key = `${bedType}-${row.serviceLine}`;
      
      if (!uniqueCombinations.has(key)) {
        // Calculate daily rate from monthly street rate
        const dailyRate = Math.round((row.streetRate || 0) / 30);
        
        uniqueCombinations.set(key, {
          bedType,
          serviceLine: row.serviceLine,
          basePrice: dailyRate
        });
      }
    });
    
    // Create MatrixCare rows for each unique combination with different payer types
    uniqueCombinations.forEach(({ bedType, serviceLine, basePrice }) => {
      const levelOfCare = mapServiceLineToLevelOfCare(serviceLine);
      const revenueAccount = getRevenueAccount(serviceLine);
      const facilityCustomerId = getFacilityCustomerId(facilityName, serviceLine);
      
      // Create rows for different payer types (Private and Hospice as shown in template)
      const payerTypes = ['Private HCC', 'Hospice Private'];
      
      payerTypes.forEach(payerName => {
        // For skilled nursing, create both SKILLED and INTERMED levels
        const levelsOfCare = serviceLine === 'HC' || serviceLine === 'SNF' 
          ? ['BASE RATE - SKILLED - ACTIVE', 'BASE RATE - INTERMED - ACTIVE']
          : [levelOfCare];
        
        levelsOfCare.forEach(loc => {
          matrixCareRows.push({
            FacilityName: `${facilityName} ${serviceLine}`,
            FacilityCustomerID: facilityCustomerId,
            BedTypeDescription: bedType,
            LevelofCare: loc,
            RoomChargeDescription: 'ROOM CHARGE',
            BasePriceBeginDate: exportMonth,
            BasePrice: basePrice,
            BasePriceChargeBy: 'Daily',
            PayerBeginDate: exportMonth,
            PayerName: payerName,
            PayerChargeBy: 'Daily',
            Proration: 'None',
            RevenueCode: '',
            AllowableCharge: 0,
            AllowablePercent: 100,
            HospBedHoldRate: 0,
            HospBedHoldPercent: 100,
            TherBedHoldRate: 0,
            TherBedHoldPercent: 100,
            RevenueAccount: revenueAccount,
            ContractualAccount: revenueAccount,
            CopayContractualAccount: revenueAccount
          });
        });
      });
    });
  });
  
  return matrixCareRows;
}

// AI Validation for MatrixCare mapping
async function validateMatrixCareMapping(
  originalData: SelectRentRollData[],
  matrixCareData: MatrixCareRow[]
): Promise<{ isValid: boolean; issues: string[]; suggestions: string[] }> {
  const issues: string[] = [];
  const suggestions: string[] = [];
  
  // Basic data integrity checks
  if (matrixCareData.length === 0) {
    issues.push("No data generated for MatrixCare export");
  }
  
  // Check for missing critical fields
  matrixCareData.forEach((row, index) => {
    if (!row.FacilityName) {
      issues.push(`Row ${index + 1}: Missing FacilityName`);
    }
    if (!row.FacilityCustomerID) {
      issues.push(`Row ${index + 1}: Missing FacilityCustomerID`);
    }
    if (!row.LevelofCare) {
      issues.push(`Row ${index + 1}: Missing LevelofCare`);
    }
    if (row.BasePrice === undefined || row.BasePrice < 0) {
      issues.push(`Row ${index + 1}: Invalid BasePrice (${row.BasePrice})`);
    }
    if (row.BasePrice > 1000) {
      suggestions.push(`Row ${index + 1}: Daily rate ${row.BasePrice} seems high - verify monthly to daily conversion`);
    }
  });
  
  // Verify service line to level of care mapping
  const invalidMappings = matrixCareData.filter(row => {
    const hasSkilled = row.LevelofCare.includes('SKILLED');
    const hasIntermed = row.LevelofCare.includes('INTERMED');
    const hasIndependent = row.LevelofCare.includes('INDEPENDENT');
    return !hasSkilled && !hasIntermed && !hasIndependent;
  });
  
  if (invalidMappings.length > 0) {
    issues.push(`${invalidMappings.length} rows have invalid LevelofCare values`);
  }
  
  // Check for duplicate entries
  const seen = new Set<string>();
  matrixCareData.forEach(row => {
    const key = `${row.FacilityName}-${row.BedTypeDescription}-${row.LevelofCare}-${row.PayerName}`;
    if (seen.has(key)) {
      suggestions.push(`Potential duplicate: ${key}`);
    }
    seen.add(key);
  });
  
  // Use AI for advanced validation if available
  if (process.env.OPENAI_API_KEY && matrixCareData.length > 0) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      
      // Sample a few rows for AI validation
      const sampleRows = matrixCareData.slice(0, 5);
      
      const prompt = `As a healthcare data expert familiar with MatrixCare EHR systems, validate this data mapping:

Sample MatrixCare Export Data:
${JSON.stringify(sampleRows, null, 2)}

Source Data Summary:
- Total units: ${originalData.length}
- Service lines: ${[...new Set(originalData.map(d => d.serviceLine))].join(', ')}
- Room types: ${[...new Set(originalData.map(d => d.roomType))].join(', ')}

Please validate:
1. Are the Level of Care mappings correct for the service lines?
2. Are the daily rates reasonable (converted from monthly)?
3. Are the revenue accounts properly formatted?
4. Do the payer types match MatrixCare standards?
5. Are there any critical fields missing or incorrectly formatted?

Respond in JSON format:
{
  "isValid": boolean,
  "criticalIssues": ["list of critical issues"],
  "suggestions": ["list of suggestions for improvement"],
  "mappingAccuracy": "high" | "medium" | "low"
}`;

      const response = await openai.chat.completions.create({
        model: "gpt-5",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 1000
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');
      
      if (result.criticalIssues) {
        issues.push(...result.criticalIssues);
      }
      if (result.suggestions) {
        suggestions.push(...result.suggestions);
      }
      
      if (result.mappingAccuracy === "low") {
        issues.push("AI validation indicates low mapping accuracy - please review the export carefully");
      } else if (result.mappingAccuracy === "medium") {
        suggestions.push("AI validation suggests reviewing the mapping for potential improvements");
      }
      
    } catch (error) {
      console.error('AI validation error:', error);
      suggestions.push("AI validation unavailable - manual review recommended");
    }
  }
  
  return {
    isValid: issues.length === 0,
    issues,
    suggestions
  };
}

export async function generateMatrixCareExcel(rentRollData: SelectRentRollData[]): Promise<{ buffer: Buffer; validation: any }> {
  // Transform data to MatrixCare format
  const matrixCareData = transformToMatrixCareFormat(rentRollData);
  
  // Validate the mapping
  const validation = await validateMatrixCareMapping(rentRollData, matrixCareData);
  
  // Log validation results
  if (!validation.isValid) {
    console.warn('MatrixCare export validation issues:', validation.issues);
  }
  if (validation.suggestions.length > 0) {
    console.info('MatrixCare export suggestions:', validation.suggestions);
  }
  
  // Create a new workbook
  const wb = XLSX.utils.book_new();
  
  // Convert data to worksheet
  const ws = XLSX.utils.json_to_sheet(matrixCareData);
  
  // Set column widths for better readability
  const colWidths = [
    { wch: 30 }, // FacilityName
    { wch: 20 }, // FacilityCustomerID
    { wch: 25 }, // BedTypeDescription
    { wch: 30 }, // LevelofCare
    { wch: 20 }, // RoomChargeDescription
    { wch: 15 }, // BasePriceBeginDate
    { wch: 10 }, // BasePrice
    { wch: 15 }, // BasePriceChargeBy
    { wch: 15 }, // PayerBeginDate
    { wch: 20 }, // PayerName
    { wch: 15 }, // PayerChargeBy
    { wch: 10 }, // Proration
    { wch: 12 }, // RevenueCode
    { wch: 15 }, // AllowableCharge
    { wch: 15 }, // AllowablePercent
    { wch: 15 }, // HospBedHoldRate
    { wch: 18 }, // HospBedHoldPercent
    { wch: 15 }, // TherBedHoldRate
    { wch: 18 }, // TherBedHoldPercent
    { wch: 15 }, // RevenueAccount
    { wch: 20 }, // ContractualAccount
    { wch: 25 }, // CopayContractualAccount
  ];
  ws['!cols'] = colWidths;
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'MatrixCare Upload');
  
  // Add validation summary sheet if there are issues or suggestions
  if (!validation.isValid || validation.suggestions.length > 0) {
    const validationData = [
      { Type: 'Status', Detail: validation.isValid ? 'VALID - Export completed with warnings' : 'INVALID - Review issues before uploading' },
      ...validation.issues.map(issue => ({ Type: 'Issue', Detail: issue })),
      ...validation.suggestions.map(suggestion => ({ Type: 'Suggestion', Detail: suggestion }))
    ];
    
    const validationSheet = XLSX.utils.json_to_sheet(validationData);
    XLSX.utils.book_append_sheet(wb, validationSheet, 'Validation Report');
  }
  
  // Generate Excel buffer
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  
  return {
    buffer,
    validation
  };
}

export async function generateMatrixCareCSV(rentRollData: SelectRentRollData[]): Promise<{ csv: string; validation: any }> {
  // Transform data to MatrixCare format
  const matrixCareData = transformToMatrixCareFormat(rentRollData);
  
  // Validate the mapping
  const validation = await validateMatrixCareMapping(rentRollData, matrixCareData);
  
  // Log validation results
  if (!validation.isValid) {
    console.warn('MatrixCare CSV export validation issues:', validation.issues);
  }
  if (validation.suggestions.length > 0) {
    console.info('MatrixCare CSV export suggestions:', validation.suggestions);
  }
  
  // Create CSV header
  const headers = [
    'FacilityName', 'FacilityCustomerID', 'BedTypeDescription', 'LevelofCare',
    'RoomChargeDescription', 'BasePriceBeginDate', 'BasePrice', 'BasePriceChargeBy',
    'PayerBeginDate', 'PayerName', 'PayerChargeBy', 'Proration', 'RevenueCode',
    'AllowableCharge', 'AllowablePercent', 'HospBedHoldRate', 'HospBedHoldPercent',
    'TherBedHoldRate', 'TherBedHoldPercent', 'RevenueAccount', 'ContractualAccount',
    'CopayContractualAccount'
  ];
  
  // Build CSV string
  let csv = headers.join(',') + '\n';
  
  matrixCareData.forEach(row => {
    const values = headers.map(header => {
      const value = row[header as keyof MatrixCareRow];
      // Escape values containing commas or quotes
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    csv += values.join(',') + '\n';
  });
  
  // Add validation comments at the end if there are issues
  if (!validation.isValid || validation.suggestions.length > 0) {
    csv += '\n# VALIDATION REPORT\n';
    csv += `# Status: ${validation.isValid ? 'VALID with warnings' : 'INVALID - Review before uploading'}\n`;
    if (validation.issues.length > 0) {
      csv += '# Issues:\n';
      validation.issues.forEach(issue => {
        csv += `# - ${issue}\n`;
      });
    }
    if (validation.suggestions.length > 0) {
      csv += '# Suggestions:\n';
      validation.suggestions.forEach(suggestion => {
        csv += `# - ${suggestion}\n`;
      });
    }
  }
  
  return {
    csv,
    validation
  };
}