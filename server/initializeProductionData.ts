import { IStorage } from "./storage";

// 10 Senior Housing Campuses 
const campuses = [
  { id: "LOC-001", name: "Sunrise Valley Senior Living", region: "North", division: "Northeast", city: "Boston", state: "MA", lat: 42.3601, lng: -71.0589 },
  { id: "LOC-002", name: "Oakwood Retirement Community", region: "North", division: "Northeast", city: "Hartford", state: "CT", lat: 41.7658, lng: -72.6734 },
  { id: "LOC-003", name: "Cedar Ridge Care Center", region: "North", division: "Northwest", city: "Chicago", state: "IL", lat: 41.8781, lng: -87.6298 },
  { id: "LOC-004", name: "Maple Grove Senior Campus", region: "North", division: "Northwest", city: "Milwaukee", state: "WI", lat: 43.0389, lng: -87.9065 },
  { id: "LOC-005", name: "Heritage Oaks Retirement", region: "North", division: "Central", city: "Columbus", state: "OH", lat: 39.9612, lng: -82.9988 },
  { id: "LOC-006", name: "Magnolia Gardens Senior Living", region: "South", division: "Southeast", city: "Atlanta", state: "GA", lat: 33.7490, lng: -84.3880 },
  { id: "LOC-007", name: "Palmetto Bay Retirement Resort", region: "South", division: "Southeast", city: "Miami", state: "FL", lat: 25.7617, lng: -80.1918 },
  { id: "LOC-008", name: "Bluebonnet Senior Community", region: "South", division: "Southwest", city: "Houston", state: "TX", lat: 29.7604, lng: -95.3698 },
  { id: "LOC-009", name: "Desert Rose Care Facility", region: "South", division: "Southwest", city: "Phoenix", state: "AZ", lat: 33.4484, lng: -112.0740 },
  { id: "LOC-010", name: "Silver Creek Senior Village", region: "South", division: "Central", city: "Nashville", state: "TN", lat: 36.1627, lng: -86.7816 }
];

// Service lines with unit counts and pricing
const serviceLineConfigs = {
  "IL": { units: 40, baseRate: 3500, variance: 500, occupancy: 0.92 },
  "AL": { units: 35, baseRate: 4500, variance: 600, occupancy: 0.88 },
  "AL/MC": { units: 20, baseRate: 6500, variance: 700, occupancy: 0.85 },
  "HC": { units: 25, baseRate: 7500, variance: 800, occupancy: 0.82 },
  "HC/MC": { units: 15, baseRate: 8500, variance: 900, occupancy: 0.80 },
  "SL": { units: 30, baseRate: 5500, variance: 650, occupancy: 0.90 }
};

// Room types for each service
const roomTypes = {
  "IL": ["Studio", "1 Bedroom", "2 Bedroom"],
  "AL": ["Studio", "Companion Suite", "1 Bedroom"],
  "AL/MC": ["Private", "Semi-Private"],
  "HC": ["Private", "Semi-Private", "Ward"],
  "HC/MC": ["Private", "Semi-Private"],
  "SL": ["Studio", "1 Bedroom", "Deluxe Suite"]
};

// Competitor templates for each location (3 per location)
const competitorTemplates = [
  ["Forest Springs Health Campus", "Willow Creek Senior Living", "Garden View Care Center"],
  ["Autumn Leaves Memory Care", "Brookdale Senior Living", "Sunrise Assisted Living"],
  ["The Arbors at Parkside", "Heritage Woods", "The Lantern at Morning Pointe"],
  ["Emerald Gardens", "The Wellington", "Carrington Court"],
  ["Bickford Senior Living", "American House", "StoryPoint Senior Living"],
  ["Peachtree Hills Place", "Lenbrook", "Park Springs"],
  ["Vi at Aventura", "The Palace at Coral Gables", "Atria Willow Wood"],
  ["The Buckingham Senior Living", "Belmont Village", "Silverado Memory Care"],
  ["The Terraces of Phoenix", "La Siena", "The Stratford"],
  ["Morningside of Belmont", "NHC Place at Cool Springs", "The Heritage at Brentwood"]
];

export async function initializeProductionDatabase(storage: IStorage): Promise<void> {
  console.log('Initializing production database with full demo data...');
  
  // Clear existing data
  await storage.clearAllData();
  
  // Insert locations
  for (const campus of campuses) {
    await storage.createOrUpdateLocation({
      name: campus.name,
      region: campus.region,
      division: campus.division,
      address: `${100 + campuses.indexOf(campus) * 100} Senior Living Blvd`,
      city: campus.city,
      state: campus.state,
      lat: campus.lat,
      lng: campus.lng,
      totalUnits: Object.values(serviceLineConfigs).reduce((sum, config) => sum + config.units, 0)
    });
  }
  
  // Generate and insert rent roll data
  let totalUnits = 0;
  const currentMonth = "09/01/2025";
  
  for (const campus of campuses) {
    let unitCounter = 1;
    
    for (const [serviceLine, config] of Object.entries(serviceLineConfigs)) {
      const roomTypesForService = roomTypes[serviceLine as keyof typeof roomTypes];
      const unitsPerRoomType = Math.floor(config.units / roomTypesForService.length);
      
      for (const roomType of roomTypesForService) {
        const extraUnit = roomTypesForService.indexOf(roomType) === roomTypesForService.length - 1 
          ? config.units % roomTypesForService.length : 0;
        const unitsForThisType = unitsPerRoomType + extraUnit;
        
        for (let i = 0; i < unitsForThisType; i++) {
          const isOccupied = Math.random() < config.occupancy;
          const daysVacant = isOccupied ? 0 : Math.floor(Math.random() * 90) + 1;
          const baseRent = Math.round(config.baseRate + (Math.random() - 0.5) * config.variance);
          const careFee = isOccupied ? Math.round(300 + Math.random() * 1200) : 0;
          
          // Determine attributes
          const hasView = Math.random() < 0.3;
          const isRenovated = Math.random() < 0.4;
          const isCorner = Math.random() < 0.2;
          
          const unitId = `${serviceLine}${unitCounter.toString().padStart(3, '0')}`;
          
          await storage.createRentRollData({
            date: currentMonth,
            uploadMonth: currentMonth,
            location: campus.name,
            locationId: campus.id,
            roomNumber: unitId,
            roomType,
            serviceLine,
            occupiedYN: isOccupied,
            daysVacant,
            size: roomType,
            view: hasView ? "Garden View" : "Street View",
            renovated: isRenovated,
            streetRate: baseRent,
            inHouseRate: baseRent,
            careRate: careFee,
            competitorRate: Math.round(baseRent * (0.95 + Math.random() * 0.1))
          });
          
          unitCounter++;
          totalUnits++;
        }
      }
    }
  }
  
  // Generate and insert competitors (3 per location)
  let competitorCount = 0;
  
  for (let campusIndex = 0; campusIndex < campuses.length; campusIndex++) {
    const campus = campuses[campusIndex];
    const competitorNames = competitorTemplates[campusIndex];
    
    for (let i = 0; i < 3; i++) {
      // Position competitor within 20-minute drive (approximately 10-15 miles in mixed traffic)
      // Using realistic distance based on urban/suburban driving patterns
      const angle = (i * 120 + Math.random() * 60) * Math.PI / 180;
      const distance = 3 + Math.random() * 12; // 3-15 miles = roughly 10-20 minute drive
      const latOffset = (distance / 69) * Math.sin(angle);
      const lngOffset = (distance / 69) * Math.cos(angle) / Math.cos(campus.lat * Math.PI / 180);
      
      // Determine quality rating
      const qualityRand = Math.random();
      let rating = 'B';
      if (qualityRand < 0.25) rating = 'A';
      else if (qualityRand > 0.75) rating = 'C';
      
      // Set rates based on quality
      const rateMultiplier = rating === 'A' ? 1.15 : rating === 'B' ? 1.0 : 0.85;
      
      // Calculate actual distance for verification (should be within 20-minute drive)
      const actualDistance = Math.round(distance * 10) / 10;
      
      await storage.createCompetitor({
        name: competitorNames[i],
        location: campus.name,
        locationId: campus.id,
        address: `${200 + (i * 50)} Competitor Dr, ${campus.city}, ${campus.state}`,
        lat: campus.lat + latOffset,
        lng: campus.lng + lngOffset,
        rating,
        avgCareRate: Math.round(800 * rateMultiplier),
        streetRate: Math.round(4300 * rateMultiplier),
        roomType: "AL",
        rates: {
          "Studio": Math.round(3500 * rateMultiplier),
          "One Bedroom": Math.round(4500 * rateMultiplier),
          "Two Bedroom": Math.round(5500 * rateMultiplier),
          "Memory Care": Math.round(6500 * rateMultiplier)
        },
        attributes: {
          distance_miles: actualDistance,
          drive_time_minutes: Math.round(actualDistance * 1.5 + (Math.random() * 5)), // 1.5 min/mile + traffic variance
          occupancy: (0.75 + Math.random() * 0.20).toFixed(2),
          totalUnits: 50 + Math.floor(Math.random() * 100),
          website: `www.${competitorNames[i].toLowerCase().replace(/\s+/g, '')}.com`,
          phone: `(${Math.floor(Math.random() * 900) + 100}) ${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`,
          amenities: "24/7 Care, Dining Services, Activities Program"
        }
      });
      
      competitorCount++;
    }
  }
  
  console.log(`Production database initialized with ${totalUnits} units and ${competitorCount} competitors`);
}