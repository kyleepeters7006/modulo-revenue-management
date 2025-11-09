import { db } from "./db";
import { locations, rentRollData, unitPolygons } from "@shared/schema";
import { sql } from "drizzle-orm";

// Room type distributions by service line
const roomTypesByServiceLine: Record<string, Array<{ type: string, baseRate: number, weight: number }>> = {
  'AL': [
    { type: 'Studio', baseRate: 3200, weight: 0.3 },
    { type: 'One Bedroom', baseRate: 3800, weight: 0.5 },
    { type: 'Two Bedroom', baseRate: 4500, weight: 0.2 }
  ],
  'AL/MC': [
    { type: 'Studio', baseRate: 4200, weight: 0.4 },
    { type: 'One Bedroom', baseRate: 4800, weight: 0.5 },
    { type: 'Companion', baseRate: 3800, weight: 0.1 }
  ],
  'HC': [
    { type: 'Private', baseRate: 350, weight: 0.3 },  // Daily rates for HC
    { type: 'Semi-Private', baseRate: 280, weight: 0.7 }
  ],
  'HC/MC': [
    { type: 'Private', baseRate: 380, weight: 0.4 },  // Daily rates for HC/MC
    { type: 'Semi-Private', baseRate: 310, weight: 0.6 }
  ],
  'IL': [
    { type: 'One Bedroom', baseRate: 2800, weight: 0.6 },
    { type: 'Two Bedroom', baseRate: 3500, weight: 0.4 }
  ]
};

// Care levels and rates
const careLevels = [
  { level: 'Base Care', rate: 0, weight: 0.4 },
  { level: 'Level 1', rate: 500, weight: 0.3 },
  { level: 'Level 2', rate: 800, weight: 0.2 },
  { level: 'Level 3', rate: 1200, weight: 0.1 }
];

// Payer types by service line
const payerTypesByServiceLine: Record<string, Array<{ type: string, weight: number }>> = {
  'AL': [
    { type: 'Private AL', weight: 0.85 },
    { type: 'Medicaid AL', weight: 0.15 }
  ],
  'AL/MC': [
    { type: 'Private AL', weight: 0.9 },
    { type: 'Medicaid AL', weight: 0.1 }
  ],
  'HC': [
    { type: 'Private HCC', weight: 0.3 },
    { type: 'Medicare A', weight: 0.4 },
    { type: 'Medicaid IN', weight: 0.25 },
    { type: 'Insurance FFS', weight: 0.05 }
  ],
  'HC/MC': [
    { type: 'Private HCC', weight: 0.35 },
    { type: 'Medicare A', weight: 0.35 },
    { type: 'Medicaid IN', weight: 0.25 },
    { type: 'Insurance FFS', weight: 0.05 }
  ],
  'IL': [
    { type: 'Private IL', weight: 1.0 }
  ]
};

// First names and last names for generating resident names
const firstNames = ['John', 'Mary', 'Robert', 'Patricia', 'James', 'Jennifer', 'Michael', 'Linda', 
                    'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
                    'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy', 'Daniel', 'Betty',
                    'Matthew', 'Helen', 'Anthony', 'Sandra', 'Mark', 'Donna'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
                   'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
                   'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White'];

// Service line configurations for campuses
const serviceLineConfigs = [
  { lines: ['AL', 'HC'], weight: 0.4 },  // AL + HC campus
  { lines: ['AL', 'AL/MC', 'HC'], weight: 0.3 },  // AL + Memory Care + HC campus
  { lines: ['AL', 'HC', 'IL'], weight: 0.2 },  // AL + HC + IL campus
  { lines: ['AL', 'AL/MC'], weight: 0.1 }  // AL + Memory Care only
];

// Occupancy targets by service line (high occupancy scenario)
const occupancyByServiceLine: Record<string, number> = {
  'HC': 0.90,      // Health Center at 90%
  'HC/MC': 0.88,   // Health Center/Memory Care at 88%
  'AL': 0.92,      // Assisted Living at 92%
  'AL/MC': 0.90,   // Assisted Living/Memory Care at 90%
  'IL': 0.93,      // Independent Living at 93%
  'SL': 0.91       // Senior Living at 91%
};

// Low occupancy targets for second campus (low demand market example)
const lowOccupancyByServiceLine: Record<string, number> = {
  'HC': 0.60,
  'HC/MC': 0.58,
  'AL': 0.62,
  'AL/MC': 0.60,
  'IL': 0.65,
  'SL': 0.63
};

function getRandomElement<T>(items: Array<{ weight: number } & T>): T {
  const random = Math.random();
  let sum = 0;
  for (const item of items) {
    sum += item.weight;
    if (random < sum) {
      return item;
    }
  }
  return items[items.length - 1];
}

function generateResidentName(): string {
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  return `${firstName} ${lastName}`;
}

function generateMoveInDate(): string {
  const daysAgo = Math.floor(Math.random() * 1095); // Random date within last 3 years
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

async function seedTrilogyRentRoll() {
  console.log('Starting to seed Trilogy rent roll data...');

  try {
    // Get existing unit polygons to preserve them
    const existingPolygons = await db.select().from(unitPolygons);
    const polygonRentRollIds = new Set(existingPolygons.map(p => p.rentRollDataId).filter(Boolean));
    console.log(`Found ${existingPolygons.length} existing unit polygons to preserve`);
    
    // Delete only rent roll data that doesn't have polygon mappings
    if (polygonRentRollIds.size > 0) {
      const allRentRoll = await db.select().from(rentRollData);
      const toDelete = allRentRoll.filter(r => !polygonRentRollIds.has(r.id));
      console.log(`Deleting ${toDelete.length} rent roll units without polygon mappings, preserving ${allRentRoll.length - toDelete.length} with mappings`);
      
      for (const unit of toDelete) {
        await db.delete(rentRollData).where(sql`id = ${unit.id}`);
      }
    } else {
      // No polygons exist, safe to delete all
      await db.delete(rentRollData);
      console.log('Cleared all rent roll data');
    }

    // Get all Trilogy campus locations (excluding demo data)
    const campusLocations = await db.select().from(locations);
    const trilogyCampuses = campusLocations.filter(loc => 
      loc.name.includes('-') && !loc.name.includes('Senior') && !loc.name.includes('Care')
    );

    console.log(`Found ${trilogyCampuses.length} Trilogy campuses to seed`);

    const allUnits = [];
    const today = new Date();
    const uploadMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const todayStr = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;

    for (let campusIndex = 0; campusIndex < trilogyCampuses.length; campusIndex++) {
      const campus = trilogyCampuses[campusIndex];
      
      // Second campus (Hartford-101) is low occupancy market example
      const isLowOccupancyCampus = campusIndex === 1;
      const occupancyConfig = isLowOccupancyCampus ? lowOccupancyByServiceLine : occupancyByServiceLine;
      
      // Determine regional market positioning
      // North region: higher market position (20-25% above market)
      // South region: lower market position (12-16% above market)
      // Overall average: ~18% above market
      const isNorthRegion = campus.lat > 39.5; // Approximately northern states
      const baseMarketPosition = isNorthRegion ? 0.225 : 0.14; // North: 22.5%, South: 14%
      const positionVariation = (Math.random() - 0.5) * 0.08; // ±4% variation
      const campusMarketPosition = baseMarketPosition + positionVariation;
      
      // Determine service lines for this campus
      const config = getRandomElement(serviceLineConfigs);
      const serviceLines = config.lines;
      
      // Generate units for each service line
      for (const serviceLine of serviceLines) {
        const roomTypes = roomTypesByServiceLine[serviceLine] || roomTypesByServiceLine['AL'];
        const payerTypes = payerTypesByServiceLine[serviceLine] || payerTypesByServiceLine['AL'];
        
        // Determine number of units for this service line
        const unitCount = serviceLine === 'HC' || serviceLine === 'HC/MC' 
          ? Math.floor(Math.random() * 40) + 30  // 30-70 beds for HC
          : serviceLine === 'IL'
          ? Math.floor(Math.random() * 20) + 15  // 15-35 units for IL
          : Math.floor(Math.random() * 30) + 20; // 20-50 units for AL
        
        // Generate room numbers based on service line
        const roomPrefix = serviceLine === 'HC' || serviceLine === 'HC/MC' ? 'HC-' 
                        : serviceLine === 'IL' ? 'IL-'
                        : serviceLine === 'AL/MC' ? 'MC-'
                        : '';
        const startRoom = serviceLine === 'IL' ? 100 
                        : serviceLine === 'AL/MC' ? 200
                        : serviceLine === 'HC' || serviceLine === 'HC/MC' ? 300
                        : 100;

        for (let i = 0; i < unitCount; i++) {
          const roomType = getRandomElement(roomTypes);
          const targetOccupancy = occupancyConfig[serviceLine] || 0.85;
          const isOccupied = Math.random() < targetOccupancy;
          const careLevel = getRandomElement(careLevels);
          const payerType = getRandomElement(payerTypes);
          
          // Calculate rates
          let streetRate = roomType.baseRate;
          let inHouseRate = streetRate;
          
          // Add variation to rates
          const variation = (Math.random() - 0.5) * 0.2; // ±10% variation
          streetRate = Math.round(streetRate * (1 + variation));
          
          // Apply discount for occupied units
          if (isOccupied) {
            const discount = Math.random() * 0.1 + 0.02; // 2-12% discount
            inHouseRate = Math.round(streetRate * (1 - discount));
          }
          
          // Convert daily rates to monthly for HC
          const displayStreetRate = serviceLine.startsWith('HC') ? streetRate * 30 : streetRate;
          const displayInHouseRate = serviceLine.startsWith('HC') ? inHouseRate * 30 : inHouseRate;
          
          // Generate care rate
          const careRate = careLevel.rate * (1 + (Math.random() - 0.5) * 0.2);
          const totalRate = displayInHouseRate + careRate;
          
          // Generate competitor rates based on campus market positioning
          // Market position = (streetRate - competitorRate) / competitorRate
          // So: competitorRate = streetRate / (1 + marketPosition)
          const unitVariation = (Math.random() - 0.5) * 0.06; // ±3% unit-level variation
          const effectiveMarketPosition = campusMarketPosition + unitVariation;
          const competitorRate = Math.round(displayStreetRate / (1 + effectiveMarketPosition));
          const competitorCareRate = Math.round(careRate * (0.9 + Math.random() * 0.2));
          const competitorFinalRate = competitorRate + competitorCareRate;
          
          // Generate AI suggested rate
          const aiSuggestedRate = Math.round(displayStreetRate * (0.95 + Math.random() * 0.15));
          const moduloSuggestedRate = Math.round(displayStreetRate * (0.98 + Math.random() * 0.1));
          
          // Determine unit attributes first
          const viewType = Math.random() < 0.3 ? 'Garden' : Math.random() < 0.2 ? 'Courtyard' : 'Standard';
          const isRenovated = Math.random() < 0.3;
          
          const unit = {
            id: `${campus.id}-${serviceLine}-${roomPrefix}${startRoom + i}`,
            uploadMonth,
            date: todayStr,
            location: campus.name,
            locationId: campus.id,
            roomNumber: `${roomPrefix}${startRoom + i}`,
            roomType: roomType.type,
            occupiedYN: isOccupied,
            daysVacant: isOccupied ? 0 : Math.floor(Math.random() * 60),
            preferredLocation: Math.random() < 0.3 ? 'Front Building' : Math.random() < 0.5 ? 'Garden View' : null,
            size: roomType.type === 'Studio' ? 'Small' : roomType.type === 'Two Bedroom' ? 'Large' : 'Medium',
            view: viewType,
            renovated: isRenovated,
            otherPremiumFeature: Math.random() < 0.2 ? 'Corner Unit' : null,
            streetRate: displayStreetRate,
            inHouseRate: displayInHouseRate,
            discountToStreetRate: isOccupied ? Math.round((displayStreetRate - displayInHouseRate) / displayStreetRate * 100) : 0,
            careLevel: careLevel.level,
            careRate: Math.round(careRate),
            rentAndCareRate: Math.round(totalRate),
            competitorRate,
            competitorAvgCareRate: Math.round(competitorCareRate),
            competitorFinalRate,
            moduloSuggestedRate,
            aiSuggestedRate,
            promotionAllowance: Math.random() < 0.2 ? Math.round(displayStreetRate * 0.05) : 0,
            locationRating: Math.random() < 0.4 ? 'A' : Math.random() < 0.7 ? 'B' : 'C',
            sizeRating: roomType.type === 'Two Bedroom' ? 'A' : roomType.type === 'Studio' ? 'C' : 'B',
            viewRating: viewType === 'Garden' ? 'A' : viewType === 'Courtyard' ? 'B' : 'C',
            renovationRating: isRenovated ? 'A' : 'C',
            amenityRating: Math.random() < 0.3 ? 'A' : Math.random() < 0.6 ? 'B' : 'C',
            serviceLine,
            residentId: isOccupied ? `RES${Math.floor(Math.random() * 100000)}` : null,
            residentName: isOccupied ? generateResidentName() : null,
            moveInDate: isOccupied ? generateMoveInDate() : null,
            moveOutDate: null,
            payorType: payerType.type,
            admissionStatus: isOccupied ? 'Active' : null,
            levelOfCare: serviceLine.startsWith('HC') ? 'Skilled' : serviceLine === 'AL/MC' ? 'Memory Care' : serviceLine === 'IL' ? 'Independent' : 'Assisted',
            medicaidRate: payerType.type.includes('Medicaid') ? Math.round(displayStreetRate * 0.7) : null,
            medicareRate: payerType.type.includes('Medicare') ? Math.round(displayStreetRate * 0.85) : null,
            assessmentDate: isOccupied ? todayStr : null,
            marketingSource: isOccupied ? (Math.random() < 0.3 ? 'Referral' : Math.random() < 0.5 ? 'Hospital' : 'Walk-in') : null,
            aiCalculationDetails: JSON.stringify({
              baseRate: displayStreetRate,
              occupancyAdjustment: isOccupied ? -5 : 10,
              competitorPosition: (displayStreetRate - competitorRate) / competitorRate * 100,
              seasonalAdjustment: 0,
              recommendedAction: isOccupied ? 'Hold current rate' : 'Consider promotion'
            })
          };

          allUnits.push(unit);
        }
      }
    }

    // Insert all units in batches
    const batchSize = 100;
    for (let i = 0; i < allUnits.length; i += batchSize) {
      const batch = allUnits.slice(i, i + batchSize);
      await db.insert(rentRollData).values(batch);
      console.log(`Inserted ${Math.min(i + batchSize, allUnits.length)} of ${allUnits.length} units`);
    }

    console.log(`Successfully seeded ${allUnits.length} rent roll units across ${trilogyCampuses.length} campuses`);
    
    // Show summary by service line
    const serviceLineSummary = allUnits.reduce((acc, unit) => {
      acc[unit.serviceLine] = (acc[unit.serviceLine] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log('Units by service line:', serviceLineSummary);
    
    // Show occupancy summary
    const occupiedCount = allUnits.filter(u => u.occupiedYN).length;
    console.log(`Overall occupancy: ${(occupiedCount / allUnits.length * 100).toFixed(1)}%`);
    
  } catch (error) {
    console.error('Error seeding rent roll data:', error);
    throw error;
  }
}

export { seedTrilogyRentRoll };