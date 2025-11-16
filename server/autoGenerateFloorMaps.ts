import { db } from './db';
import { campusMaps, unitPolygons, rentRollData, locations } from '../shared/schema';
import { eq, sql } from 'drizzle-orm';

// Generate a grid-based floor plan layout
export async function autoGenerateFloorPlanForCampus(campusId: string) {
  try {
    // Get all units for this campus
    const units = await db
      .select()
      .from(rentRollData)
      .where(eq(rentRollData.campus, campusId));

    if (units.length === 0) {
      console.log(`No units found for campus ${campusId}`);
      return { created: 0, message: 'No units found' };
    }

    // Get or create campus map
    let campusMap = await db
      .select()
      .from(campusMaps)
      .where(eq(campusMaps.locationId, campusId))
      .limit(1);

    if (!campusMap[0]) {
      // Create a default campus map
      const location = await db
        .select()
        .from(locations)
        .where(eq(locations.id, campusId))
        .limit(1);

      if (!location[0]) {
        return { created: 0, message: 'Location not found' };
      }

      const [newCampusMap] = await db.insert(campusMaps).values({
        locationId: campusId,
        name: `${location[0].name} Floor Plan`,
        baseImageUrl: '/attached_assets/default-floor-plan.jpg', // Use a default image
        width: 1024,
        height: 768,
        isPublished: true
      }).returning();

      campusMap = [newCampusMap];
    }

    // Group units by service line for better organization
    const unitsByServiceLine = units.reduce((acc, unit) => {
      const sl = unit.serviceLine || 'Other';
      if (!acc[sl]) acc[sl] = [];
      acc[sl].push(unit);
      return acc;
    }, {} as Record<string, typeof units>);

    // Calculate grid layout
    const serviceLines = Object.keys(unitsByServiceLine);
    const sectionsPerRow = Math.min(serviceLines.length, 3);
    const sectionWidth = 1 / sectionsPerRow;
    const sectionHeight = 1 / Math.ceil(serviceLines.length / sectionsPerRow);

    let created = 0;

    // Process each service line section
    for (let slIndex = 0; slIndex < serviceLines.length; slIndex++) {
      const serviceLine = serviceLines[slIndex];
      const slUnits = unitsByServiceLine[serviceLine];
      
      // Calculate section position
      const sectionX = (slIndex % sectionsPerRow) * sectionWidth;
      const sectionY = Math.floor(slIndex / sectionsPerRow) * sectionHeight;
      
      // Sort units by room number for consistent layout
      slUnits.sort((a, b) => {
        const aNum = parseInt(a.roomNumber.replace(/\D/g, '') || '0');
        const bNum = parseInt(b.roomNumber.replace(/\D/g, '') || '0');
        return aNum - bNum;
      });
      
      // Calculate grid for this section
      const cols = Math.ceil(Math.sqrt(slUnits.length));
      const rows = Math.ceil(slUnits.length / cols);
      
      // Create polygon for each unit
      for (let i = 0; i < slUnits.length; i++) {
        const unit = slUnits[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        
        // Calculate room position within section
        const roomWidth = sectionWidth / cols * 0.9; // 90% to leave gaps
        const roomHeight = sectionHeight / rows * 0.9;
        
        const x = sectionX + (col * sectionWidth / cols) + (sectionWidth / cols * 0.05);
        const y = sectionY + (row * sectionHeight / rows) + (sectionHeight / rows * 0.05);
        
        // Create polygon coordinates (rectangle)
        const polygonCoords = [
          [x, y],
          [x + roomWidth, y],
          [x + roomWidth, y + roomHeight],
          [x, y + roomHeight]
        ];
        
        // Determine fill color based on occupancy
        let fillColor = '#4CAF50'; // Green for available
        if (unit.occupiedYN) {
          fillColor = '#FF5252'; // Red for occupied
        }
        
        // Create unit polygon
        await db.insert(unitPolygons).values({
          campusMapId: campusMap[0].id,
          rentRollDataId: unit.id,
          polygonCoordinates: JSON.stringify(polygonCoords),
          normalizedCoordinates: polygonCoords.map(([x, y]) => ({ x, y })),
          displayRoomNumber: unit.roomNumber,
          defaultServiceLine: unit.serviceLine,
          sectionName: serviceLine,
          label: unit.roomNumber,
          fillColor,
          strokeColor: '#2E7D32'
        }).onConflictDoNothing();
        
        created++;
      }
    }

    console.log(`Created ${created} unit polygons for campus ${campusId}`);
    return { created, message: `Successfully mapped ${created} units` };
  } catch (error) {
    console.error('Error auto-generating floor plan:', error);
    return { created: 0, message: 'Failed to generate floor plan' };
  }
}

// Generate floor plans for all campuses
export async function autoGenerateAllFloorPlans() {
  const allLocations = await db.select().from(locations);
  const results = [];
  
  for (const location of allLocations) {
    console.log(`Generating floor plan for ${location.name}...`);
    const result = await autoGenerateFloorPlanForCampus(location.id);
    results.push({ campus: location.name, ...result });
  }
  
  return results;
}