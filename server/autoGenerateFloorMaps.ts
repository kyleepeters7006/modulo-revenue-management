import { db } from './db';
import { campusMaps, unitPolygons, rentRollData, locations } from '../shared/schema';
import { eq, sql } from 'drizzle-orm';

// Generate a grid-based floor plan layout with enhanced visual SVG
export async function autoGenerateFloorPlanForCampus(campusId: string) {
  try {
    // Get all units for this campus
    const units = await db
      .select()
      .from(rentRollData)
      .where(eq(rentRollData.locationId, campusId));

    if (units.length === 0) {
      console.log(`No units found for campus ${campusId}`);
      return { created: 0, message: 'No units found' };
    }

    // Get location name for SVG title
    const location = await db
      .select()
      .from(locations)
      .where(eq(locations.id, campusId))
      .limit(1);

    const locationName = location[0]?.name || 'Unknown Campus';

    // Check if campus map already exists
    let campusMap = await db
      .select()
      .from(campusMaps)
      .where(eq(campusMaps.locationId, campusId))
      .limit(1);

    // CRITICAL: Only generate/update SVG for maps without baseImageUrl (to preserve real images)
    // Skip if map exists with a real image unless it already has SVG content
    if (campusMap.length > 0 && campusMap[0].baseImageUrl && !campusMap[0].svgContent) {
      console.log(`Skipping ${locationName} - has baseImageUrl, preserving real image floor plan`);
      return { 
        created: 0, 
        message: `Skipped ${locationName} - preserving existing image floor plan. Delete baseImageUrl first if you want to replace with auto-generated layout.` 
      };
    }

    const isUpdate = campusMap.length > 0;
    
    // Calculate dimensions for SVG floor plan
    const cols = Math.ceil(Math.sqrt(units.length * 1.2));
    const rows = Math.ceil(units.length / cols);
    const tileWidth = 150;
    const tileHeight = 120;
    const mapWidth = cols * tileWidth;
    const mapHeight = rows * tileHeight + 50;

    // Generate enhanced SVG content
    const svgContent = generateEnhancedFloorPlanSVG(units, cols, rows, tileWidth, tileHeight, locationName);

    if (!isUpdate) {
      // Create new campus map with SVG (no baseImageUrl)
      const [newCampusMap] = await db.insert(campusMaps).values({
        locationId: campusId,
        name: `${locationName} - Interactive Floor Plan`,
        svgContent,
        width: mapWidth,
        height: mapHeight,
        baseImageUrl: null, // Explicitly null for SVG-only maps
        isTemplate: false,
        isPublished: true
      }).returning();

      campusMap = [newCampusMap];
    } else {
      // Update existing campus map with new SVG (only if no baseImageUrl or already has SVG)
      await db
        .update(campusMaps)
        .set({
          svgContent,
          width: mapWidth,
          height: mapHeight,
          updatedAt: new Date()
        })
        .where(eq(campusMaps.id, campusMap[0].id));
    }

    // Delete existing polygons before regenerating
    if (isUpdate) {
      await db
        .delete(unitPolygons)
        .where(eq(unitPolygons.campusMapId, campusMap[0].id));
      console.log(`Deleted old polygons for campus ${campusId} before regenerating`);
    }

    // Group units by service line for section metadata
    const unitsByServiceLine = units.reduce((acc, unit) => {
      const sl = unit.serviceLine || 'Other';
      if (!acc[sl]) acc[sl] = [];
      acc[sl].push(unit);
      return acc;
    }, {} as Record<string, typeof units>);

    // Create polygon data for each unit, preserving service line grouping
    const polygonsToInsert = [];
    
    // Simple grid layout for now (can enhance with service line sections later)
    for (let unitIndex = 0; unitIndex < units.length; unitIndex++) {
      const row = Math.floor(unitIndex / cols);
      const col = unitIndex % cols;
      const unit = units[unitIndex];
      
      // Calculate normalized coordinates (0-1 range) accounting for SVG viewBox
      const x = (col * tileWidth) / mapWidth;
      const y = ((row * tileHeight) + 50) / mapHeight;
      const w = tileWidth / mapWidth;
      const h = tileHeight / mapHeight;

      // Create polygon coordinates (rectangle)
      const polygonCoords = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h]
      ];

      // Color based on occupancy (occupiedYN is "Y" or "N" string)
      const isAvailable = unit.occupiedYN !== 'Y';
      const fillColor = isAvailable ? '#22c55e' : '#9ca3af';
      const strokeColor = isAvailable ? '#16a34a' : '#6b7280';

      polygonsToInsert.push({
        campusMapId: campusMap[0].id,
        rentRollDataId: unit.id,
        polygonCoordinates: JSON.stringify(polygonCoords),
        normalizedCoordinates: polygonCoords.map(([x, y]) => ({ x, y })),
        displayRoomNumber: unit.roomNumber,
        defaultServiceLine: unit.serviceLine || null,
        sectionName: unit.serviceLine || 'Other', // Preserve section metadata for UI filters
        label: unit.roomNumber,
        fillColor,
        strokeColor
      });
    }

    // Batch insert all polygons
    if (polygonsToInsert.length > 0) {
      await db.insert(unitPolygons).values(polygonsToInsert).onConflictDoNothing();
    }

    console.log(`${isUpdate ? 'Updated' : 'Created'} ${polygonsToInsert.length} unit polygons for campus ${campusId}`);
    return { 
      created: polygonsToInsert.length, 
      message: `Successfully mapped ${polygonsToInsert.length} units for ${locationName}` 
    };
  } catch (error) {
    console.error('Error auto-generating floor plan:', error);
    return { created: 0, message: 'Failed to generate floor plan' };
  }
}

// Generate enhanced SVG floor plan with room numbers and perimeters clearly visible
function generateEnhancedFloorPlanSVG(
  units: any[], 
  cols: number, 
  rows: number, 
  tileWidth: number, 
  tileHeight: number,
  locationName: string
): string {
  const mapWidth = cols * tileWidth;
  const mapHeight = rows * tileHeight + 50;

  let svgContent = `<svg width="${mapWidth}" height="${mapHeight}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mapWidth} ${mapHeight}">
    <defs>
      <style>
        .floor-room { cursor: pointer; transition: all 0.2s ease; }
        .floor-room:hover { opacity: 0.85; transform: scale(1.02); }
        .room-number { font-size: 16px; font-weight: bold; text-anchor: middle; pointer-events: none; fill: #1a1a1a; }
        .room-type { font-size: 11px; text-anchor: middle; pointer-events: none; fill: #4a4a4a; }
        .room-status { font-size: 10px; text-anchor: middle; pointer-events: none; font-weight: 600; }
        .section-title { font-size: 14px; font-weight: 600; fill: #2563eb; }
      </style>
    </defs>
    <rect width="${mapWidth}" height="${mapHeight}" fill="#f8fafc"/>
    <text x="${mapWidth / 2}" y="30" font-size="20" font-weight="bold" text-anchor="middle" fill="#1e293b">${locationName} - Interactive Floor Plan</text>`;

  let unitIndex = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (unitIndex >= units.length) break;

      const unit = units[unitIndex];
      const x = col * tileWidth;
      const y = row * tileHeight + 50;

      // occupiedYN is stored as "Y" or "N" string in the database
      const isAvailable = unit.occupiedYN !== 'Y';
      const fillColor = isAvailable ? '#22c55e' : '#e5e7eb';
      const strokeColor = isAvailable ? '#16a34a' : '#9ca3af';
      const statusColor = isAvailable ? '#ffffff' : '#6b7280';
      const statusText = isAvailable ? 'AVAILABLE' : 'Occupied';

      // Room rectangle with enhanced styling
      svgContent += `
        <g class="floor-room" data-room="${unit.roomNumber}">
          <rect 
            x="${x + 8}" 
            y="${y + 8}" 
            width="${tileWidth - 16}" 
            height="${tileHeight - 16}"
            fill="${fillColor}"
            stroke="${strokeColor}"
            stroke-width="3"
            rx="6"
            filter="drop-shadow(0 2px 4px rgba(0,0,0,0.1))"
          />
          <text 
            x="${x + tileWidth / 2}" 
            y="${y + tileHeight / 2 - 15}"
            class="room-number"
          >${unit.roomNumber}</text>
          <text 
            x="${x + tileWidth / 2}" 
            y="${y + tileHeight / 2 + 5}"
            class="room-type"
          >${unit.roomType || unit.size || 'Studio'}</text>
          <text 
            x="${x + tileWidth / 2}" 
            y="${y + tileHeight - 20}"
            class="room-status"
            fill="${statusColor}"
          >${statusText}</text>
        </g>`;

      unitIndex++;
    }
  }

  svgContent += '</svg>';
  return svgContent;
}

// Generate floor plans for all campuses (only those with rent roll data)
export async function autoGenerateAllFloorPlans() {
  // Get all locations that have rent roll data
  const locationsWithData = await db
    .selectDistinct({ locationId: rentRollData.locationId })
    .from(rentRollData);
  
  const results = [];
  
  for (const { locationId } of locationsWithData) {
    if (!locationId) continue;
    
    const location = await db
      .select()
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);
    
    if (!location[0]) continue;
    
    console.log(`Generating floor plan for ${location[0].name}...`);
    const result = await autoGenerateFloorPlanForCampus(locationId);
    results.push({ campus: location[0].name, locationId, ...result });
  }
  
  console.log(`\nGenerated floor plans for ${results.length} campuses`);
  return results;
}