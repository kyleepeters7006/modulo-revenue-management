import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// 10 Senior Housing Campuses with thoughtful names and details
const campuses = [
  { name: "Sunrise Valley Senior Living", region: "North", division: "Northeast", city: "Boston", state: "MA", lat: 42.3601, lng: -71.0589 },
  { name: "Oakwood Retirement Community", region: "North", division: "Northeast", city: "Hartford", state: "CT", lat: 41.7658, lng: -72.6734 },
  { name: "Cedar Ridge Care Center", region: "North", division: "Northwest", city: "Chicago", state: "IL", lat: 41.8781, lng: -87.6298 },
  { name: "Maple Grove Senior Campus", region: "North", division: "Northwest", city: "Milwaukee", state: "WI", lat: 43.0389, lng: -87.9065 },
  { name: "Heritage Oaks Retirement", region: "North", division: "Central", city: "Columbus", state: "OH", lat: 39.9612, lng: -82.9988 },
  { name: "Magnolia Gardens Senior Living", region: "South", division: "Southeast", city: "Atlanta", state: "GA", lat: 33.7490, lng: -84.3880 },
  { name: "Palmetto Bay Retirement Resort", region: "South", division: "Southeast", city: "Miami", state: "FL", lat: 25.7617, lng: -80.1918 },
  { name: "Bluebonnet Senior Community", region: "South", division: "Southwest", city: "Houston", state: "TX", lat: 29.7604, lng: -95.3698 },
  { name: "Desert Rose Care Facility", region: "South", division: "Southwest", city: "Phoenix", state: "AZ", lat: 33.4484, lng: -112.0740 },
  { name: "Silver Creek Senior Village", region: "South", division: "Central", city: "Nashville", state: "TN", lat: 36.1627, lng: -86.7816 }
];

// Service lines with typical unit counts and pricing
const serviceLineConfigs = {
  "IL": { units: 40, baseRate: 3500, variance: 500, occupancy: 0.92, attributes: ["A", "A", "B"] },
  "AL": { units: 35, baseRate: 4500, variance: 600, occupancy: 0.88, attributes: ["A", "B", "B"] },
  "AL/MC": { units: 20, baseRate: 6500, variance: 700, occupancy: 0.85, attributes: ["B", "B", "C"] },
  "HC": { units: 25, baseRate: 7500, variance: 800, occupancy: 0.82, attributes: ["B", "C", "C"] },
  "HC/MC": { units: 15, baseRate: 8500, variance: 900, occupancy: 0.80, attributes: ["B", "C", "C"] },
  "SL": { units: 30, baseRate: 5500, variance: 650, occupancy: 0.90, attributes: ["A", "B", "B"] }
};

// Room types for variety
const roomTypes = {
  "IL": ["Studio", "1 Bedroom", "2 Bedroom"],
  "AL": ["Studio", "Companion Suite", "1 Bedroom"],
  "AL/MC": ["Private", "Semi-Private"],
  "HC": ["Private", "Semi-Private", "Ward"],
  "HC/MC": ["Private", "Semi-Private"],
  "SL": ["Studio", "1 Bedroom", "Deluxe Suite"]
};

// Generate trailing 12 months through September 2025 (Oct 2024 - Sep 2025)
function generateMonthlyDates(): string[] {
  const dates: string[] = [];
  const months = [
    '10/01/2024', // October 2024
    '11/01/2024', // November 2024
    '12/01/2024', // December 2024
    '01/01/2025', // January 2025
    '02/01/2025', // February 2025
    '03/01/2025', // March 2025
    '04/01/2025', // April 2025
    '05/01/2025', // May 2025
    '06/01/2025', // June 2025
    '07/01/2025', // July 2025
    '08/01/2025', // August 2025
    '09/01/2025', // September 2025
  ];
  
  return months;
}

// Generate thoughtful unit data
function generatePortfolioData() {
  const data: any[] = [];
  const dates = generateMonthlyDates();
  let unitCounter = 1;
  
  dates.forEach((date, monthIndex) => {
    campuses.forEach((campus) => {
      Object.entries(serviceLineConfigs).forEach(([serviceLine, config]) => {
        const roomTypesForService = roomTypes[serviceLine as keyof typeof roomTypes];
        const unitsPerRoomType = Math.floor(config.units / roomTypesForService.length);
        
        roomTypesForService.forEach((roomType, rtIndex) => {
          // Determine number of units for this room type
          const extraUnit = rtIndex === roomTypesForService.length - 1 ? 
            config.units % roomTypesForService.length : 0;
          const numUnits = unitsPerRoomType + extraUnit;
          
          for (let unit = 0; unit < numUnits; unit++) {
            // Calculate seasonal variations
            const seasonalFactor = 1 + (0.05 * Math.sin((monthIndex / 12) * 2 * Math.PI));
            
            // Determine occupancy status (occupied or vacant)
            const isOccupied = Math.random() < config.occupancy;
            
            // Calculate rates with realistic variations
            const baseVariation = (Math.random() - 0.5) * config.variance;
            const roomTypeMultiplier = roomType.includes("2 Bedroom") ? 1.3 : 
                                     roomType.includes("1 Bedroom") ? 1.15 :
                                     roomType.includes("Deluxe") ? 1.25 :
                                     roomType.includes("Private") ? 1.1 : 1.0;
            
            const marketRate = Math.round((config.baseRate + baseVariation) * roomTypeMultiplier * seasonalFactor);
            const currentRate = isOccupied ? 
              Math.round(marketRate * (0.92 + Math.random() * 0.08)) : 0;
            
            // Assign attribute based on unit quality distribution
            const attributeIndex = Math.floor(Math.random() * config.attributes.length);
            const attribute = config.attributes[attributeIndex];
            
            // Calculate days vacant (0 if occupied, random if vacant)
            const daysVacant = isOccupied ? 0 : Math.floor(Math.random() * 90) + 1;
            
            // Generate unit ID
            const unitId = `${campus.name.split(' ')[0].toUpperCase()}-${serviceLine}-${unitCounter.toString().padStart(3, '0')}`;
            
            data.push({
              Date: date,
              Region: campus.region,
              Division: campus.division,
              Location: campus.name,
              "Unit ID": unitId,
              "Service Line": serviceLine,
              "Room Type": roomType,
              "Market Rate": marketRate,
              "Current Rate": currentRate,
              "Occupancy Status": isOccupied ? "Occupied" : "Vacant",
              "Days Vacant": daysVacant,
              "Attribute (A/B/C)": attribute,
              "Square Footage": roomType.includes("2 Bedroom") ? 950 :
                               roomType.includes("1 Bedroom") ? 750 :
                               roomType.includes("Deluxe") ? 850 :
                               roomType.includes("Studio") ? 550 : 650,
              "Last Renovated": `01/01/${2015 + Math.floor(Math.random() * 8)}`,
              "Floor Number": Math.floor(Math.random() * 3) + 1,
              Notes: isOccupied ? "" : "Ready for immediate occupancy"
            });
            
            unitCounter++;
          }
        });
      });
      
      // Reset unit counter for each campus
      unitCounter = 1;
    });
  });
  
  return data;
}

// Generate competitor data with realistic details
function generateCompetitorData() {
  const competitors: any[] = [];
  
  // Generate 2-3 competitors near each campus
  campuses.forEach((campus) => {
    const numCompetitors = 2 + Math.floor(Math.random() * 2);
    
    for (let i = 0; i < numCompetitors; i++) {
      // Generate nearby coordinates (within ~10 miles)
      const latOffset = (Math.random() - 0.5) * 0.2;
      const lngOffset = (Math.random() - 0.5) * 0.2;
      
      const competitorNames = [
        "Golden Years", "Harmony House", "Serenity Springs", "Willows Care",
        "Garden Plaza", "Autumn Leaves", "Crystal Springs", "Haven Health",
        "Comfort Care", "Liberty Lodge", "Peaceful Pines", "Caring Hands"
      ];
      
      const competitorName = competitorNames[Math.floor(Math.random() * competitorNames.length)] + 
                            ` ${campus.city}`;
      
      // Generate rates similar to our portfolio
      const baseRates = {
        "IL": 3400 + Math.random() * 600,
        "AL": 4400 + Math.random() * 700,
        "AL/MC": 6400 + Math.random() * 800,
        "HC": 7400 + Math.random() * 900,
        "HC/MC": 8400 + Math.random() * 1000,
        "SL": 5400 + Math.random() * 750
      };
      
      // Each competitor offers 3-4 service lines
      const availableServices = Object.keys(baseRates);
      const numServices = 3 + Math.floor(Math.random() * 2);
      const selectedServices = availableServices
        .sort(() => Math.random() - 0.5)
        .slice(0, numServices);
      
      selectedServices.forEach((service) => {
        competitors.push({
          name: competitorName,
          location: `${campus.city}, ${campus.state}`,
          latitude: campus.lat + latOffset,
          longitude: campus.lng + lngOffset,
          service_line: service,
          average_rate: Math.round(baseRates[service as keyof typeof baseRates]),
          occupancy: (0.75 + Math.random() * 0.20).toFixed(2),
          total_units: 20 + Math.floor(Math.random() * 40),
          distance_miles: Math.round(Math.sqrt(latOffset * latOffset + lngOffset * lngOffset) * 69 * 10) / 10,
          rating: (3.5 + Math.random() * 1.5).toFixed(1),
          last_updated: new Date().toISOString().split('T')[0],
          website: `www.${competitorName.toLowerCase().replace(/\s+/g, '')}.com`,
          phone: `(${Math.floor(Math.random() * 900) + 100}) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`,
          amenities: ["24/7 Care", "Dining Services", "Activities Program", "Transportation"].slice(0, 2 + Math.floor(Math.random() * 3)).join(", ")
        });
      });
    }
  });
  
  return competitors;
}

// Generate campus locations data
function generateLocationsData() {
  return campuses.map((campus, index) => ({
    id: `LOC-${(index + 1).toString().padStart(3, '0')}`,
    name: campus.name,
    region: campus.region,
    division: campus.division,
    address: `${100 + index * 100} Senior Living Blvd`,
    city: campus.city,
    state: campus.state,
    latitude: campus.lat,
    longitude: campus.lng,
    total_units: Object.values(serviceLineConfigs).reduce((sum, config) => sum + config.units, 0),
    service_lines: Object.keys(serviceLineConfigs).join(", ")
  }));
}

// Main function to generate all data
export async function generateAllDemoData() {
  console.log('Generating comprehensive demo data for 10 senior housing campuses...');
  
  // Generate portfolio data
  const portfolioData = generatePortfolioData();
  const csvContent = stringify(portfolioData, { header: true });
  const uploadsDir = path.join(process.cwd(), 'uploads');
  
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  
  const fileName = `portfolio_demo_data_${Date.now()}.csv`;
  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, csvContent);
  
  console.log(`Generated portfolio data: ${portfolioData.length} records`);
  console.log(`Saved to: ${filePath}`);
  
  // Generate competitor data
  const competitorData = generateCompetitorData();
  console.log(`Generated competitor data: ${competitorData.length} records`);
  
  // Generate locations data
  const locationsData = generateLocationsData();
  console.log(`Generated locations data: ${locationsData.length} campuses`);
  
  return {
    portfolioFile: filePath,
    portfolioData,
    competitorData,
    locationsData
  };
}

// Run generation
generateAllDemoData().then(() => {
  console.log('Demo data generation complete!');
}).catch(error => {
  console.error('Error generating demo data:', error);
});
