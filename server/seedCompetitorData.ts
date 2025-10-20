import { db } from "./db";
import { competitors, locations } from "@shared/schema";
import { sql } from "drizzle-orm";

// Competitor name prefixes/suffixes for realistic senior living facility names
const namePrefix = [
  'Brookdale', 'Sunrise', 'Atria', 'Five Star', 'Holiday', 'American House',
  'Heartland', 'Golden Living', 'Kindred', 'Life Care', 'ManorCare',
  'Signature', 'Symphony', 'Harmony', 'Heritage', 'Magnolia', 'Willow',
  'Cedar', 'Oak', 'Pine', 'Maple', 'Birch', 'Evergreen', 'Garden',
  'Meadow', 'Valley', 'Ridge', 'Creek', 'Springs', 'Haven', 'Manor'
];

const nameSuffix = [
  'Senior Living', 'Retirement Community', 'Assisted Living', 
  'Memory Care', 'Senior Community', 'Care Center', 'Health Campus',
  'Living Center', 'Residence', 'Village', 'Place', 'Pointe',
  'Crossing', 'Commons', 'Gardens', 'Estates', 'Heights', 'Park'
];

// State coordinates for generating nearby competitors
const stateCoordinates: Record<string, { lat: number, lng: number, radius: number }> = {
  'Indiana': { lat: 39.7910, lng: -86.1480, radius: 2.5 },
  'Kentucky': { lat: 37.8393, lng: -84.2700, radius: 2.0 },
  'Ohio': { lat: 40.4173, lng: -82.9071, radius: 2.5 },
  'Wisconsin': { lat: 43.7844, lng: -88.7879, radius: 2.5 },
  'Michigan': { lat: 44.3148, lng: -85.6024, radius: 3.0 }
};

// Campus to state mapping based on Trilogy locations
const campusStateMapping: Record<string, string> = {
  'Ashland-117': 'Kentucky',
  'Batesville-120': 'Indiana',
  'Bloomington-149': 'Indiana',
  'Canton-121': 'Ohio',
  'Columbus-110': 'Indiana',
  'Cynthiana-114': 'Kentucky',
  'Delaware-135': 'Ohio',
  'Elkhart-105': 'Indiana',
  'Goshen-106': 'Indiana',
  'Greensburg-7153': 'Indiana',
  'Greensburg-150': 'Indiana',
  'Harrodsburg-115': 'Kentucky',
  'Jeffersonville-119': 'Indiana',
  'Kokomo-106': 'Indiana',
  'LaGrange-128': 'Indiana',
  'Louisville-127': 'Kentucky',
  'Madison-129': 'Wisconsin',
  'Marion-136': 'Indiana',
  'Middletown-122': 'Ohio',
  'Mount Vernon-124': 'Ohio',
  'Muncie-112': 'Indiana',
  'New Albany-111': 'Indiana',
  'Noblesville-113': 'Indiana',
  'Northwood-126': 'Ohio',
  'Ontario-132': 'Ohio',
  'Richmond-147': 'Indiana',
  'Shelbyville-116': 'Indiana',
  'Spencer-134': 'Indiana',
  'Troy-130': 'Michigan',
  'Warsaw-133': 'Indiana',
  'Zanesville-125': 'Ohio'
};

// Service line base rates for competitors
const serviceLineRates: Record<string, { min: number, max: number }> = {
  'AL': { min: 2800, max: 4500 },
  'AL/MC': { min: 3800, max: 5500 },
  'HC': { min: 280, max: 420 }, // Daily rates
  'HC/MC': { min: 320, max: 480 }, // Daily rates
  'IL': { min: 2200, max: 3800 }
};

// Care level rates for competitors
const careLevelRates = {
  'Base Care': 0,
  'Level 1': 400,
  'Level 2': 700,
  'Level 3': 1100,
  'Level 4': 1500
};

// Generate random coordinates near a campus
function generateNearbyCoordinates(state: string): { lat: number, lng: number } {
  const stateCenter = stateCoordinates[state] || stateCoordinates['Indiana'];
  
  // Generate random offset within radius (in degrees, roughly)
  const latOffset = (Math.random() - 0.5) * stateCenter.radius * 0.02; // ~1-2 miles
  const lngOffset = (Math.random() - 0.5) * stateCenter.radius * 0.02;
  
  return {
    lat: stateCenter.lat + latOffset,
    lng: stateCenter.lng + lngOffset
  };
}

// Generate a realistic competitor name
function generateCompetitorName(index: number, location: string): string {
  const prefix = namePrefix[Math.floor(Math.random() * namePrefix.length)];
  const suffix = nameSuffix[Math.floor(Math.random() * nameSuffix.length)];
  
  // Sometimes include the city name
  if (Math.random() < 0.3) {
    const cityName = location.split('-')[0];
    return `${prefix} of ${cityName}`;
  }
  
  return `${prefix} ${suffix}`;
}

// Generate competitor attributes
function generateAttributes(distance: number) {
  return {
    distance_miles: Number((distance * (0.5 + Math.random() * 2)).toFixed(1)), // 0.5 to 2.5 miles
    drive_time_minutes: Math.floor(distance * (3 + Math.random() * 5)), // 3-8 min per mile
    facility_type: Math.random() < 0.6 ? 'Senior Living' : Math.random() < 0.8 ? 'Assisted Living' : 'Memory Care',
    beds: Math.floor(40 + Math.random() * 120),
    year_built: Math.floor(1980 + Math.random() * 40),
    last_renovated: Math.random() < 0.4 ? Math.floor(2015 + Math.random() * 9) : null,
    rating_google: Number((3.5 + Math.random() * 1.5).toFixed(1)),
    rating_medicare: Math.random() < 0.7 ? Math.floor(3 + Math.random() * 3) : null,
    chain_affiliation: Math.random() < 0.6,
    accepts_medicaid: Math.random() < 0.4,
    accepts_medicare: Math.random() < 0.6,
    specialties: [
      Math.random() < 0.5 ? 'Memory Care' : null,
      Math.random() < 0.3 ? 'Rehabilitation' : null,
      Math.random() < 0.4 ? 'Respite Care' : null,
      Math.random() < 0.2 ? 'Hospice' : null
    ].filter(Boolean)
  };
}

// Generate room rates for a competitor
function generateRoomRates(serviceLine: string) {
  const baseRates = serviceLineRates[serviceLine] || serviceLineRates['AL'];
  const variation = 0.15; // ±15% variation
  
  const rates: Record<string, number> = {};
  
  if (serviceLine === 'AL' || serviceLine === 'AL/MC') {
    rates['Studio'] = Math.round(baseRates.min + Math.random() * (baseRates.max - baseRates.min) * 0.6);
    rates['1BR'] = Math.round(rates['Studio'] * (1.15 + Math.random() * 0.15));
    rates['2BR'] = Math.round(rates['1BR'] * (1.20 + Math.random() * 0.20));
  } else if (serviceLine === 'HC' || serviceLine === 'HC/MC') {
    rates['Private'] = Math.round(baseRates.min + Math.random() * (baseRates.max - baseRates.min));
    rates['Semi-Private'] = Math.round(rates['Private'] * (0.7 + Math.random() * 0.1));
    // Convert to monthly for display
    rates['Private'] = rates['Private'] * 30;
    rates['Semi-Private'] = rates['Semi-Private'] * 30;
  } else if (serviceLine === 'IL') {
    rates['1BR'] = Math.round(baseRates.min + Math.random() * (baseRates.max - baseRates.min) * 0.7);
    rates['2BR'] = Math.round(rates['1BR'] * (1.25 + Math.random() * 0.25));
    rates['Studio'] = Math.round(rates['1BR'] * (0.75 + Math.random() * 0.1));
  }
  
  return rates;
}

async function seedCompetitorData() {
  console.log('Starting to seed competitor data for Trilogy portfolio...');
  
  try {
    // Clear existing competitor data
    await db.delete(competitors);
    console.log('Cleared existing competitor data');
    
    // Get all Trilogy campus locations
    const campusLocations = await db.select().from(locations);
    const trilogyCampuses = campusLocations.filter(loc => 
      loc.name.includes('-') && !loc.name.includes('Senior') && !loc.name.includes('Care')
    );
    
    console.log(`Found ${trilogyCampuses.length} Trilogy campuses`);
    
    const allCompetitors = [];
    
    for (const campus of trilogyCampuses) {
      const state = campusStateMapping[campus.name] || 'Indiana';
      
      // Generate 3-7 competitors per campus
      const numCompetitors = Math.floor(Math.random() * 5) + 3;
      
      for (let i = 0; i < numCompetitors; i++) {
        const coords = generateNearbyCoordinates(state);
        const distance = 1 + Math.random() * 4; // 1-5 miles
        const attributes = generateAttributes(distance);
        
        // Determine service lines this competitor offers (can be multiple)
        const competitorServiceLines = [];
        if (Math.random() < 0.7) competitorServiceLines.push('AL');
        if (Math.random() < 0.4) competitorServiceLines.push('AL/MC');
        if (Math.random() < 0.5) competitorServiceLines.push('HC');
        if (Math.random() < 0.3) competitorServiceLines.push('IL');
        
        // Use first service line for primary rates
        const primaryServiceLine = competitorServiceLines.length > 0 
          ? competitorServiceLines[0] 
          : 'AL';
        
        const roomRates = generateRoomRates(primaryServiceLine);
        const streetRate = Object.values(roomRates)[0] || 3500;
        const avgCareRate = careLevelRates['Level 1'] + Math.random() * 300;
        
        // Determine room types based on service line
        let roomType = 'Studio';
        if (primaryServiceLine === 'HC' || primaryServiceLine === 'HC/MC') {
          roomType = Math.random() < 0.6 ? 'Private' : 'Semi-Private';
        } else if (primaryServiceLine === 'AL' || primaryServiceLine === 'AL/MC') {
          roomType = Math.random() < 0.4 ? 'Studio' : Math.random() < 0.7 ? '1BR' : '2BR';
        } else if (primaryServiceLine === 'IL') {
          roomType = Math.random() < 0.6 ? '1BR' : '2BR';
        }
        
        // Calculate competitive positioning
        const rank = Math.floor(Math.random() * 10) + 1;
        const weight = Number((0.5 + Math.random() * 0.5).toFixed(2));
        const rating = rank <= 3 ? 'A' : rank <= 7 ? 'B' : 'C';
        
        // Generate address
        const streetNumber = Math.floor(100 + Math.random() * 9900);
        const streetNames = ['Main St', 'Oak Ave', 'Maple Dr', 'Church St', 'Market St', 
                            'State St', 'Park Ave', 'Center St', 'Highland Rd', 'College Ave'];
        const streetName = streetNames[Math.floor(Math.random() * streetNames.length)];
        const cityName = campus.name.split('-')[0];
        const stateAbbr = {
          'Indiana': 'IN',
          'Kentucky': 'KY', 
          'Ohio': 'OH',
          'Wisconsin': 'WI',
          'Michigan': 'MI'
        }[state] || 'IN';
        
        const competitor = {
          id: `COMP-${campus.id}-${i}`,
          name: generateCompetitorName(i, campus.name),
          lat: coords.lat,
          lng: coords.lng,
          rates: roomRates,
          avgCareRate: Math.round(avgCareRate),
          streetRate: Math.round(streetRate),
          roomType,
          attributes,
          address: `${streetNumber} ${streetName}, ${cityName}, ${stateAbbr}`,
          rank,
          weight,
          rating,
          location: campus.name,
          locationId: campus.id,
          createdAt: new Date()
        };
        
        allCompetitors.push(competitor);
      }
    }
    
    // Insert all competitors in batches
    const batchSize = 50;
    for (let i = 0; i < allCompetitors.length; i += batchSize) {
      const batch = allCompetitors.slice(i, i + batchSize);
      await db.insert(competitors).values(batch);
      console.log(`Inserted ${Math.min(i + batchSize, allCompetitors.length)} of ${allCompetitors.length} competitors`);
    }
    
    console.log(`Successfully seeded ${allCompetitors.length} competitors across ${trilogyCampuses.length} campuses`);
    
    // Show summary by state
    const statesSummary: Record<string, number> = {};
    allCompetitors.forEach(comp => {
      const campus = trilogyCampuses.find(c => c.id === comp.locationId);
      if (campus) {
        const state = campusStateMapping[campus.name] || 'Indiana';
        statesSummary[state] = (statesSummary[state] || 0) + 1;
      }
    });
    
    console.log('Competitors by state:', statesSummary);
    
  } catch (error) {
    console.error('Error seeding competitor data:', error);
    throw error;
  }
}

// Run the seed function when imported
seedCompetitorData()
  .then(() => {
    console.log('Competitor data seed completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Competitor seed failed:', error);
    process.exit(1);
  });

export { seedCompetitorData };