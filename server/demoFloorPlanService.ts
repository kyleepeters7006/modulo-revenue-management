import { db } from './db';
import { campusMaps, unitPolygons, rentRollData, locations } from '../shared/schema';
import { eq, desc } from 'drizzle-orm';

export async function generateOrGetDemoFloorPlan(locationId: string) {
  try {
    console.log(`[Demo Floor Plan Service] Checking for existing floor plan for location ${locationId}`);
    
    // Check if demo floor plan already exists for this location
    const existing = await db
      .select()
      .from(campusMaps)
      .where(
        eq(campusMaps.locationId, locationId)
      )
      .limit(1);

    if (existing[0]) {
      console.log(`[Demo Floor Plan Service] Found existing floor plan for location ${locationId}, id: ${existing[0].id}`);
      return existing[0];
    }

    console.log(`[Demo Floor Plan Service] No existing floor plan found, checking for rent roll data...`);
    
    // Get rent roll data for this location to determine room layout
    const latestMonth = await db
      .select({ uploadMonth: rentRollData.uploadMonth })
      .from(rentRollData)
      .where(eq(rentRollData.locationId, locationId))
      .orderBy(desc(rentRollData.uploadMonth))
      .limit(1);

    const uploadMonth = latestMonth[0]?.uploadMonth;
    if (!uploadMonth) {
      console.error(`[Demo Floor Plan Service] No rent roll data found for location ${locationId}`);
      return null;
    }

    console.log(`[Demo Floor Plan Service] Using rent roll data from upload month ${uploadMonth}`);
    
    const units = await db
      .select()
      .from(rentRollData)
      .where(
        eq(rentRollData.locationId, locationId)
      );

    if (units.length === 0) {
      console.error(`[Demo Floor Plan Service] No units found for location ${locationId}`);
      return null;
    }

    console.log(`[Demo Floor Plan Service] Found ${units.length} units for location ${locationId}`);
    
    // Get location name
    const location = await db
      .select()
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);

    const locationName = location[0]?.name || 'Unknown Campus';
    
    console.log(`[Demo Floor Plan Service] Creating demo floor plan for ${locationName}...`);

    // Create demo floor plan with auto-generated grid layout
    const cols = Math.ceil(Math.sqrt(units.length * 1.2));
    const rows = Math.ceil(units.length / cols);
    const tileWidth = 150;
    const tileHeight = 120;
    const mapWidth = cols * tileWidth;
    const mapHeight = rows * tileHeight + 50;

    // Create the SVG-based demo floor plan
    const svgContent = generateDemoSVG(cols, rows, tileWidth, tileHeight, units);
    
    console.log(`[Demo Floor Plan Service] Generated SVG with dimensions ${mapWidth}x${mapHeight}`);

    // Wrap database operations in a transaction
    const result = await db.transaction(async (tx) => {
      console.log(`[Demo Floor Plan Service] Starting transaction to insert floor plan and polygons`);
      
      const [floorPlan] = await tx
        .insert(campusMaps)
        .values({
          name: `${locationName} - Demo Floor Plan`,
          locationId,
          width: mapWidth,
          height: mapHeight,
          svgContent,
          baseImageUrl: null,
          isTemplate: false,
          isPublished: true,
          createdAt: new Date(),
        })
        .returning();

      console.log(`[Demo Floor Plan Service] Created floor plan with id: ${floorPlan.id}`);

      // Create unit polygons for each room in grid layout
      const polygonsToInsert = [];
      let unitIndex = 0;
      
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (unitIndex >= units.length) break;

          const unit = units[unitIndex];
          const x = (col * tileWidth) / mapWidth;
          const y = (row * tileHeight) / mapHeight;
          const w = tileWidth / mapWidth;
          const h = tileHeight / mapHeight;

          const polygonCoords = [
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h],
          ];

          // Green if vacant, gray if occupied
          const fillColor = !unit.occupiedYN ? '#22c55e' : '#9ca3af';
          const strokeColor = !unit.occupiedYN ? '#16a34a' : '#6b7280';

          polygonsToInsert.push({
            campusMapId: floorPlan.id,
            rentRollDataId: unit.id,
            polygonCoordinates: JSON.stringify(polygonCoords),
            normalizedCoordinates: polygonCoords.map(([x, y]) => ({ x, y })),
            displayRoomNumber: unit.roomNumber,
            defaultServiceLine: unit.serviceLine || null,
            fillColor,
            strokeColor,
            label: unit.roomNumber,
          });

          unitIndex++;
        }
      }
      
      if (polygonsToInsert.length > 0) {
        await tx.insert(unitPolygons).values(polygonsToInsert);
        console.log(`[Demo Floor Plan Service] Inserted ${polygonsToInsert.length} unit polygons`);
      }

      return floorPlan;
    });

    console.log(`[Demo Floor Plan Service] Successfully created demo floor plan for location ${locationId}`);
    return result;
  } catch (error) {
    console.error('[Demo Floor Plan Service] Error generating demo floor plan:', error);
    console.error('[Demo Floor Plan Service] Stack trace:', error instanceof Error ? error.stack : 'No stack trace available');
    throw error;
  }
}

function generateDemoSVG(cols: number, rows: number, tileWidth: number, tileHeight: number, units: any[]): string {
  const mapWidth = cols * tileWidth;
  const mapHeight = rows * tileHeight + 50;

  let svgContent = `<svg width="${mapWidth}" height="${mapHeight}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .demo-room { cursor: pointer; transition: opacity 0.2s; }
        .demo-room:hover { opacity: 0.8; }
        .demo-text { font-size: 12px; font-weight: bold; text-anchor: middle; pointer-events: none; }
      </style>
    </defs>
    <rect width="${mapWidth}" height="${mapHeight}" fill="#f5f5f5"/>`;

  // Add title
  svgContent += `<text x="${mapWidth / 2}" y="25" font-size="16" font-weight="bold" text-anchor="middle">Demo Floor Plan</text>`;

  let unitIndex = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (unitIndex >= units.length) break;

      const unit = units[unitIndex];
      const x = col * tileWidth;
      const y = row * tileHeight + 50;

      const fillColor = !unit.occupiedYN ? '#22c55e' : '#d1d5db';
      const strokeColor = !unit.occupiedYN ? '#16a34a' : '#9ca3af';

      // Room rectangle
      svgContent += `
        <g class="demo-room">
          <rect 
            x="${x + 5}" 
            y="${y + 5}" 
            width="${tileWidth - 10}" 
            height="${tileHeight - 10}"
            fill="${fillColor}"
            stroke="${strokeColor}"
            stroke-width="2"
            rx="4"
          />
          <text 
            x="${x + tileWidth / 2}" 
            y="${y + tileHeight / 2 - 10}"
            class="demo-text"
            fill="#000"
          >${unit.roomNumber}</text>
          <text 
            x="${x + tileWidth / 2}" 
            y="${y + tileHeight / 2 + 10}"
            font-size="10"
            class="demo-text"
            fill="#333"
          >${unit.roomType}</text>
          <text 
            x="${x + tileWidth / 2}" 
            y="${y + tileHeight - 10}"
            font-size="9"
            class="demo-text"
            fill="${!unit.occupiedYN ? '#fff' : '#666'}"
          >${!unit.occupiedYN ? 'Vacant' : 'Occupied'}</text>
        </g>`;

      unitIndex++;
    }
  }

  svgContent += '</svg>';
  return svgContent;
}
