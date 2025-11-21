import { db } from './db';
import { campusMaps, unitPolygons, rentRollData, locations } from '../shared/schema';
import { eq, desc } from 'drizzle-orm';

export async function generateOrGetDemoFloorPlan(locationId: string) {
  try {
    // Check if demo floor plan already exists for this location
    const existing = await db
      .select()
      .from(campusMaps)
      .where(
        eq(campusMaps.locationId, locationId)
      )
      .limit(1);

    if (existing[0]) {
      return existing[0];
    }

    // Get rent roll data for this location to determine room layout
    const latestMonth = await db
      .select({ uploadMonth: rentRollData.uploadMonth })
      .from(rentRollData)
      .where(eq(rentRollData.locationId, locationId))
      .orderBy(desc(rentRollData.uploadMonth))
      .limit(1);

    const uploadMonth = latestMonth[0]?.uploadMonth;
    if (!uploadMonth) {
      return null;
    }

    const units = await db
      .select()
      .from(rentRollData)
      .where(
        eq(rentRollData.locationId, locationId)
      );

    if (units.length === 0) {
      return null;
    }

    // Get location name
    const location = await db
      .select()
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1);

    const locationName = location[0]?.name || 'Unknown Campus';

    // Create demo floor plan with auto-generated grid layout
    const cols = Math.ceil(Math.sqrt(units.length * 1.2));
    const rows = Math.ceil(units.length / cols);
    const tileWidth = 150;
    const tileHeight = 120;
    const mapWidth = cols * tileWidth;
    const mapHeight = rows * tileHeight + 50;

    // Create the SVG-based demo floor plan
    const svgContent = generateDemoSVG(cols, rows, tileWidth, tileHeight, units);

    const [floorPlan] = await db
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

    // Create unit polygons for each room in grid layout
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

        await db.insert(unitPolygons).values({
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

    return floorPlan;
  } catch (error) {
    console.error('Error generating demo floor plan:', error);
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
