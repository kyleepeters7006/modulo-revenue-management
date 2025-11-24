import { db } from './db';
import { campusMaps, unitPolygons, rentRollData, locations } from '../shared/schema';
import { eq, and, isNull, or, desc } from 'drizzle-orm';
import { detectRoomsWithAI } from './floorPlanAI';

export async function detectAndStoreTemplateRooms(
  templateMapId: string
): Promise<{
  success: boolean;
  message: string;
  roomsDetected?: number;
  roomsStored?: number;
}> {
  try {
    const templateMap = await db
      .select()
      .from(campusMaps)
      .where(eq(campusMaps.id, templateMapId))
      .limit(1);

    if (!templateMap[0]) {
      return {
        success: false,
        message: 'Template floor plan not found'
      };
    }

    if (!templateMap[0].baseImageUrl) {
      return {
        success: false,
        message: 'Template floor plan has no image'
      };
    }

    console.log('Detecting rooms in template floor plan...');
    const detectionResult = await detectRoomsWithAI(templateMap[0].baseImageUrl);
    console.log(`Detected ${detectionResult.detectedRooms.length} rooms in template`);

    const { detectedRooms, imageWidth, imageHeight } = detectionResult;

    await db
      .delete(unitPolygons)
      .where(eq(unitPolygons.campusMapId, templateMapId));

    let roomsStored = 0;

    for (const room of detectedRooms) {
      const polygonCoords = [
        [room.boundingBox.x / imageWidth, room.boundingBox.y / imageHeight],
        [(room.boundingBox.x + room.boundingBox.width) / imageWidth, room.boundingBox.y / imageHeight],
        [(room.boundingBox.x + room.boundingBox.width) / imageWidth, (room.boundingBox.y + room.boundingBox.height) / imageHeight],
        [room.boundingBox.x / imageWidth, (room.boundingBox.y + room.boundingBox.height) / imageHeight]
      ];

      await db.insert(unitPolygons).values({
        campusMapId: templateMapId,
        rentRollDataId: null,
        polygonCoordinates: JSON.stringify(polygonCoords),
        normalizedCoordinates: polygonCoords.map(([x, y]) => ({ x, y })),
        displayRoomNumber: room.roomNumber,
        defaultServiceLine: room.serviceLine || null,
        fillColor: '#4CAF50',
        strokeColor: '#2E7D32',
        label: room.roomNumber
      });

      roomsStored++;
    }

    return {
      success: true,
      message: `Successfully detected and stored ${roomsStored} rooms in template`,
      roomsDetected: detectedRooms.length,
      roomsStored
    };
  } catch (error) {
    console.error('Template room detection error:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Room detection failed'
    };
  }
}

export async function getCampusMapForLocation(locationId: string): Promise<typeof campusMaps.$inferSelect | null> {
  const locationSpecific = await db
    .select()
    .from(campusMaps)
    .where(and(
      eq(campusMaps.locationId, locationId),
      eq(campusMaps.isPublished, true)
    ))
    .orderBy(desc(campusMaps.createdAt))
    .limit(1);

  if (locationSpecific[0]) {
    return locationSpecific[0];
  }

  const globalTemplate = await db
    .select()
    .from(campusMaps)
    .where(and(
      eq(campusMaps.isTemplate, true),
      eq(campusMaps.isPublished, true)
    ))
    .orderBy(desc(campusMaps.createdAt))
    .limit(1);

  return globalTemplate[0] || null;
}

export async function getFloorPlanDataForLocation(
  locationId: string,
  uploadMonth?: string
): Promise<{
  campusMap: typeof campusMaps.$inferSelect | null;
  polygons: Array<{
    polygon: typeof unitPolygons.$inferSelect;
    unit: typeof rentRollData.$inferSelect | null;
  }>;
  stats: {
    totalRooms: number;
    matchedUnits: number;
    unmatchedRooms: number;
  };
}> {
  const campusMap = await getCampusMapForLocation(locationId);

  if (!campusMap) {
    return {
      campusMap: null,
      polygons: [],
      stats: { totalRooms: 0, matchedUnits: 0, unmatchedRooms: 0 }
    };
  }

  const polygonRecords = await db
    .select()
    .from(unitPolygons)
    .where(eq(unitPolygons.campusMapId, campusMap.id));

  let targetUploadMonth = uploadMonth;
  if (!targetUploadMonth) {
    const latestRecord = await db
      .select({ uploadMonth: rentRollData.uploadMonth })
      .from(rentRollData)
      .where(eq(rentRollData.locationId, locationId))
      .orderBy(desc(rentRollData.uploadMonth))
      .limit(1);
    
    if (latestRecord[0]?.uploadMonth) {
      targetUploadMonth = latestRecord[0].uploadMonth;
    }
  }

  const whereConditions = targetUploadMonth
    ? and(
        eq(rentRollData.locationId, locationId),
        eq(rentRollData.uploadMonth, targetUploadMonth)
      )
    : eq(rentRollData.locationId, locationId);

  const units = await db
    .select()
    .from(rentRollData)
    .where(whereConditions);

  const unitsByRoom = new Map<string, typeof rentRollData.$inferSelect>();
  units.forEach(unit => {
    const normalized = normalizeRoomNumber(unit.roomNumber);
    unitsByRoom.set(normalized, unit);
  });

  const polygons = polygonRecords.map(polygon => {
    const normalizedRoomNumber = normalizeRoomNumber(polygon.displayRoomNumber || '');
    const matchedUnit = unitsByRoom.get(normalizedRoomNumber) || null;
    
    return {
      polygon,
      unit: matchedUnit
    };
  });

  const matchedCount = polygons.filter(p => p.unit !== null).length;

  return {
    campusMap,
    polygons,
    stats: {
      totalRooms: polygons.length,
      matchedUnits: matchedCount,
      unmatchedRooms: polygons.length - matchedCount
    }
  };
}

function normalizeRoomNumber(roomNumber: string): string {
  let normalized = roomNumber.toString().trim().toUpperCase();
  
  normalized = normalized.replace(/^(ROOM|RM|UNIT|APT|APARTMENT)\s*/i, '');
  
  normalized = normalized.replace(/[\s\/_-]/g, '');
  
  normalized = normalized.replace(/^0+(\d)/, '$1');
  
  return normalized;
}
