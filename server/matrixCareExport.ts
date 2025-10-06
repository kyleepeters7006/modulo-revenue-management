import { SelectRentRollData } from '@shared/schema';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';

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
    'IL': 'BASE RATE - INDEPENDENT - ACTIVE',
    'SL': 'BASE RATE - INTERMED - ACTIVE'
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
    'IL': '~C01-41010',
    'SL': '~C01-41010'
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
                       serviceLine === 'AL' || serviceLine === 'MC' ? 'AL' : 'IL';
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

export function generateMatrixCareExcel(rentRollData: SelectRentRollData[]): Buffer {
  // Transform data to MatrixCare format
  const matrixCareData = transformToMatrixCareFormat(rentRollData);
  
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
  
  // Generate Excel buffer
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export function generateMatrixCareCSV(rentRollData: SelectRentRollData[]): string {
  // Transform data to MatrixCare format
  const matrixCareData = transformToMatrixCareFormat(rentRollData);
  
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
  
  return csv;
}