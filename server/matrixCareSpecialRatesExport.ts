import { db } from "./db";
import { locations, rentRollData, specialRates } from "@shared/schema";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { campusMapping, getMatrixCareNameFromKeyStats, getCustomerFacilityId } from "./campusMapping";
import { stringify } from 'csv-stringify';
import { promises as fs } from 'fs';

interface SpecialRateRecord {
  facilityName: string;
  residentId: string;
  residentName: string;
  beginDate: string;
  endDate: string;
  payerName: string;
  proration: number;
  spclRate: number;
  amount: number;
  pct: number;
  monthly: number;
  hospHold: number;
  hospHoldAmount: number;
  hospPct: number;
  hospHoldMonthly: number;
  therLv: number;
  therLvHoldAmount: number;
  therLvPct: number;
  therLvHoldMonthly: number;
}

export async function generateSpecialRatesExport(selectedCampuses?: string[]): Promise<string> {
  try {
    // Fetch all locations
    const allLocations = await db.select().from(locations);
    
    // Filter to selected campuses or use all
    const campusesToExport = selectedCampuses && selectedCampuses.length > 0
      ? allLocations.filter(loc => selectedCampuses.includes(loc.name))
      : allLocations;

    // Fetch occupied rent roll data (current residents) for selected locations
    const occupiedUnits = await db.select()
      .from(rentRollData)
      .where(
        and(
          inArray(
            rentRollData.locationId,
            campusesToExport.map(loc => loc.id)
          ),
          eq(rentRollData.occupiedYN, true),
          isNotNull(rentRollData.residentId) // Only include units with residents
        )
      );

    const specialRateRecords: SpecialRateRecord[] = [];
    const today = new Date();
    const beginDate = `${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}/${today.getFullYear()}`;
    const endDate = '12/31/2099'; // Far future date for ongoing special rates

    // Generate special rates for each occupied unit
    for (const unit of occupiedUnits) {
      const location = campusesToExport.find(loc => loc.id === unit.locationId);
      if (!location) continue;

      // Get MatrixCare facility name based on service line
      let matrixCareName: string | undefined;
      
      if (unit.serviceLine === 'HC' || unit.serviceLine === 'HC/MC') {
        matrixCareName = location.matrixCareNameHC || getMatrixCareNameFromKeyStats(location.name, 'HC');
      } else if (unit.serviceLine === 'AL' || unit.serviceLine === 'AL/MC') {
        matrixCareName = location.matrixCareNameAL || getMatrixCareNameFromKeyStats(location.name, 'AL');
      } else if (unit.serviceLine === 'SL') {
        matrixCareName = location.matrixCareNameIL || getMatrixCareNameFromKeyStats(location.name, 'IL');
      } else if (unit.serviceLine === 'VIL') {
        // Village units use the AL facility name or a generic name
        matrixCareName = location.matrixCareNameAL || getMatrixCareNameFromKeyStats(location.name, 'AL') || `${location.name} VIL`;
      }

      if (!matrixCareName) continue;

      // Determine payer based on service line
      const payerName = getPayerName(unit.serviceLine);
      
      // Use current in-house rate for special rate (freezing current pricing)
      const specialRateAmount = unit.inHouseRate;
      
      // Calculate rate adjustments
      let spclRate = 1; // Special rate flag
      let monthly = 0; // Monthly flag
      let proration = 0; // Proration flag
      
      // Set flags based on service line
      if (unit.serviceLine === 'AL' || unit.serviceLine === 'AL/MC' || unit.serviceLine === 'SL' || unit.serviceLine === 'VIL') {
        monthly = 1; // Monthly billing
        proration = 1; // Annually prorated
      }
      
      specialRateRecords.push({
        facilityName: matrixCareName,
        residentId: unit.residentId || `RES-${unit.roomNumber}`,
        residentName: unit.residentName || `Resident - Room ${unit.roomNumber}`,
        beginDate: beginDate,
        endDate: endDate,
        payerName: payerName,
        proration: proration,
        spclRate: spclRate,
        amount: Math.round(specialRateAmount * 100) / 100,
        pct: 0, // Not using percentage discount
        monthly: monthly,
        hospHold: 0, // Hospice bed hold flag
        hospHoldAmount: 0,
        hospPct: 100, // Full rate during hospice hold
        hospHoldMonthly: 0,
        therLv: 0, // Therapeutic leave flag
        therLvHoldAmount: 0,
        therLvPct: 100, // Full rate during therapeutic leave
        therLvHoldMonthly: 0
      });
    }

    // Convert to CSV
    const csvData = await new Promise<string>((resolve, reject) => {
      stringify(specialRateRecords, {
        header: true,
        columns: [
          { key: 'facilityName', header: 'Facility Name' },
          { key: 'residentId', header: 'Resident ID' },
          { key: 'residentName', header: 'Resident Name' },
          { key: 'beginDate', header: 'BeginDate' },
          { key: 'endDate', header: 'EndDate' },
          { key: 'payerName', header: 'PayerName' },
          { key: 'proration', header: 'Proration' },
          { key: 'spclRate', header: 'SpclRate' },
          { key: 'amount', header: 'Amount' },
          { key: 'pct', header: 'Pct' },
          { key: 'monthly', header: 'Monthly' },
          { key: 'hospHold', header: 'HospHold' },
          { key: 'hospHoldAmount', header: 'HospHoldAmount' },
          { key: 'hospPct', header: 'HospPct' },
          { key: 'hospHoldMonthly', header: 'HospHoldMonthly' },
          { key: 'therLv', header: 'TherLv' },
          { key: 'therLvHoldAmount', header: 'TherLvHoldAmount' },
          { key: 'therLvPct', header: 'TherLvPct' },
          { key: 'therLvHoldMonthly', header: 'TherLvHoldMonthly' }
        ]
      }, (err, output) => {
        if (err) reject(err);
        else resolve(output);
      });
    });

    // Save to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `/tmp/SPECIALROOMRATESEXPORT_Trilogy_${timestamp}.CSV`;
    await fs.writeFile(filename, csvData, 'utf8');
    
    return filename;
  } catch (error) {
    console.error('Error generating special rates export:', error);
    throw error;
  }
}

// Helper function to determine payer name based on service line
function getPayerName(serviceLine: string): string {
  const payerMapping: { [key: string]: string } = {
    'HC': 'Private HCC',
    'HC/MC': 'Private HCC',
    'AL': 'Private AL',
    'AL/MC': 'Private AL',
    'SL': 'Private SL',
    'VIL': 'Private VIL'
  };
  return payerMapping[serviceLine] || 'Private';
}

// Helper function to validate special rates export
export async function validateSpecialRatesExport(filepath: string): Promise<{
  isValid: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    totalRecords: number;
    facilities: number;
    residentsAffected: number;
    avgSpecialRate: number;
  };
}> {
  try {
    const csvContent = await fs.readFile(filepath, 'utf8');
    const lines = csvContent.split('\n');
    const headers = lines[0].split(',');
    
    const errors: string[] = [];
    const warnings: string[] = [];
    const facilities = new Set<string>();
    const residents = new Set<string>();
    let totalRate = 0;
    let rateCount = 0;
    
    // Validate headers
    const requiredHeaders = ['Facility Name', 'Resident ID', 'Amount', 'BeginDate', 'EndDate'];
    for (const header of requiredHeaders) {
      if (!headers.some(h => h.includes(header))) {
        errors.push(`Missing required column: ${header}`);
      }
    }
    
    // Process data rows
    for (let i = 1; i < lines.length - 1; i++) { // Skip header and empty last line
      const values = lines[i].split(',');
      if (values.length < headers.length) continue;
      
      const facilityName = values[0];
      const residentId = values[1];
      const amount = parseFloat(values[8]);
      const beginDate = values[3];
      const endDate = values[4];
      
      facilities.add(facilityName);
      residents.add(residentId);
      
      if (!isNaN(amount)) {
        totalRate += amount;
        rateCount++;
      }
      
      // Validation checks
      if (!facilityName || facilityName === '') {
        errors.push(`Row ${i}: Missing facility name`);
      }
      if (!residentId || residentId === '') {
        errors.push(`Row ${i}: Missing resident ID`);
      }
      if (isNaN(amount) || amount <= 0) {
        warnings.push(`Row ${i}: Invalid amount: ${values[8]}`);
      }
      if (amount > 20000) {
        warnings.push(`Row ${i}: Unusually high special rate: $${amount}`);
      }
      if (!beginDate || !endDate) {
        errors.push(`Row ${i}: Missing date information`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      summary: {
        totalRecords: lines.length - 2, // Exclude header and empty last line
        facilities: facilities.size,
        residentsAffected: residents.size,
        avgSpecialRate: rateCount > 0 ? totalRate / rateCount : 0
      }
    };
  } catch (error) {
    return {
      isValid: false,
      errors: [`Failed to validate file: ${error instanceof Error ? error.message : String(error)}`],
      warnings: [],
      summary: {
        totalRecords: 0,
        facilities: 0,
        residentsAffected: 0,
        avgSpecialRate: 0
      }
    };
  }
}