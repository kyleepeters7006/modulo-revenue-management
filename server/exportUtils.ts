import { stringify } from 'csv-stringify/sync';

// Define essential fields for each export type
export const EXPORT_FIELDS = {
  // Rate card export - client-facing pricing information
  rateCard: [
    'uploadMonth',
    'location',
    'roomNumber', 
    'roomType',
    'serviceLine',
    'occupiedYN',
    'daysVacant',
    'streetRate',
    'inHouseRate',
    'competitorRate',
    'competitorName',
    'moduloSuggestedRate',
    'aiSuggestedRate',
    'residentName',
    'moveInDate',
    'moveOutDate'
  ],
  
  // Rent roll history export - historical data for analysis
  rentRollHistory: [
    'uploadMonth',
    'location',
    'roomNumber',
    'roomType',
    'serviceLine',
    'occupiedYN',
    'daysVacant',
    'streetRate',
    'inHouseRate',
    'moveInDate',
    'moveOutDate',
    'residentName'
  ],
  
  // Competitive survey export - competitor analysis data
  competitiveSurvey: [
    'surveyMonth',
    'location',
    'competitorName',
    'roomType',
    'serviceLine',
    'baseRate',
    'adjustedRate',
    'weight'
  ],
  
  // Enquire/inquiry data export - lead tracking
  enquireData: [
    'activityDate',
    'location',
    'serviceLine',
    'dataSource',
    'leadStatus',
    'contactName',
    'contactPhone',
    'contactEmail',
    'preferredMoveInDate'
  ],
  
  // Location mappings export - facility reference data
  locationMappings: [
    'originalName',
    'mappedName',
    'locationCode',
    'region',
    'division',
    'state',
    'city'
  ]
};

// Helper function to filter data to only include specified fields
export function filterDataFields(data: any[], fields: string[]): any[] {
  return data.map(row => {
    const filteredRow: any = {};
    fields.forEach(field => {
      if (field in row) {
        filteredRow[field] = row[field];
      }
    });
    return filteredRow;
  });
}

// Generate CSV with only essential fields
export function generateOptimizedCSV(data: any[], exportType: keyof typeof EXPORT_FIELDS): string {
  const fields = EXPORT_FIELDS[exportType];
  const filteredData = filterDataFields(data, fields);
  
  // Generate CSV with headers
  return stringify(filteredData, { 
    header: true,
    columns: fields // Ensure column order matches the defined fields
  });
}

// Generate filename with timestamp
export function generateExportFilename(prefix: string, extension: string = 'csv'): string {
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return `${prefix}_${timestamp}.${extension}`;
}

// Format data for client-friendly export
export function formatExportData(data: any[], exportType: keyof typeof EXPORT_FIELDS): any[] {
  const filteredData = filterDataFields(data, EXPORT_FIELDS[exportType]);
  
  // Apply any formatting transformations
  return filteredData.map(row => {
    const formattedRow = { ...row };
    
    // Format boolean values to Yes/No
    if ('occupiedYN' in formattedRow) {
      formattedRow.occupiedYN = formattedRow.occupiedYN ? 'Yes' : 'No';
    }
    
    // Format dates to readable format
    ['moveInDate', 'moveOutDate', 'activityDate', 'preferredMoveInDate'].forEach(dateField => {
      if (dateField in formattedRow && formattedRow[dateField]) {
        const date = new Date(formattedRow[dateField]);
        if (!isNaN(date.getTime())) {
          formattedRow[dateField] = date.toLocaleDateString('en-US');
        }
      }
    });
    
    // Format currency values
    ['streetRate', 'inHouseRate', 'competitorRate', 'moduloSuggestedRate', 'aiSuggestedRate', 'baseRate', 'adjustedRate'].forEach(rateField => {
      if (rateField in formattedRow && formattedRow[rateField] !== null && formattedRow[rateField] !== undefined) {
        formattedRow[rateField] = `$${parseFloat(formattedRow[rateField]).toFixed(2)}`;
      }
    });
    
    return formattedRow;
  });
}