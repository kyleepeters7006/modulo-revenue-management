import OpenAI from 'openai';
import { db } from './db';
import { campusMaps, unitPolygons, rentRollData } from '../shared/schema';
import { eq, and, isNull } from 'drizzle-orm';

// Initialize OpenAI client using Replit AI Integrations
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
});

interface DetectedRoom {
  roomNumber: string;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  center: {
    x: number;
    y: number;
  };
  confidence: number;
  serviceLine?: string;
}

interface RoomDetectionResult {
  detectedRooms: DetectedRoom[];
  imageWidth: number;
  imageHeight: number;
  processingTime: number;
}

export async function detectRoomsWithAI(imageUrl: string): Promise<RoomDetectionResult> {
  const startTime = Date.now();

  try {
    console.log('Starting AI room detection for image:', imageUrl);
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert at analyzing floor plan images for senior living facilities.
Your task is to identify all rooms with their room numbers and locations.

Return a JSON object with this exact structure:
{
  "detectedRooms": [
    {
      "roomNumber": "101",
      "boundingBox": {
        "x": 100,
        "y": 200,
        "width": 150,
        "height": 120
      },
      "center": {
        "x": 175,
        "y": 260
      },
      "confidence": 0.95,
      "serviceLine": "IL"
    }
  ],
  "imageWidth": 1024,
  "imageHeight": 768
}

Guidelines:
- Look for any text that could be a room number (like "101", "A-12", "201B")
- Estimate the bounding box for each room based on walls and doors
- Calculate the center point of each room
- Identify service lines if labeled (IL=Independent Living, AL=Assisted Living, HC=Health Center, MC=Memory Care)
- Set confidence between 0 and 1 based on how clear the room number is
- Use pixel coordinates relative to the image dimensions`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Please analyze this floor plan and identify all rooms with their numbers and locations."
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
                detail: "high"
              }
            }
          ]
        }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    
    // Ensure we have valid data
    if (!result.detectedRooms || !Array.isArray(result.detectedRooms)) {
      throw new Error('Invalid AI response format');
    }

    // Add default dimensions if not provided
    if (!result.imageWidth) result.imageWidth = 1024;
    if (!result.imageHeight) result.imageHeight = 768;

    console.log(`AI detected ${result.detectedRooms.length} rooms in ${Date.now() - startTime}ms`);

    return {
      ...result,
      processingTime: Date.now() - startTime
    };
  } catch (error) {
    console.error('AI room detection error:', error);
    throw error;
  }
}

export async function createPolygonsFromDetection(
  campusMapId: string,
  detectionResult: RoomDetectionResult
): Promise<{ created: number; matched: number; unmatched: string[] }> {
  const { detectedRooms, imageWidth, imageHeight } = detectionResult;
  
  let created = 0;
  let matched = 0;
  const unmatched: string[] = [];

  // Get all rent roll units for this campus
  const campusMap = await db.select().from(campusMaps).where(eq(campusMaps.id, campusMapId)).limit(1);
  if (!campusMap[0]) {
    throw new Error('Campus map not found');
  }

  const units = await db
    .select()
    .from(rentRollData)
    .where(eq(rentRollData.campus, campusMap[0].locationId));

  // Create a map of room numbers to unit IDs
  const unitsByRoom = new Map<string, string>();
  units.forEach(unit => {
    // Normalize room number for matching
    const normalized = normalizeRoomNumber(unit.roomNumber);
    unitsByRoom.set(normalized, unit.id);
  });

  // Process each detected room
  for (const room of detectedRooms) {
    const normalizedRoom = normalizeRoomNumber(room.roomNumber);
    
    // Convert bounding box to polygon coordinates (4 corners)
    const polygonCoords = [
      [room.boundingBox.x / imageWidth, room.boundingBox.y / imageHeight],
      [(room.boundingBox.x + room.boundingBox.width) / imageWidth, room.boundingBox.y / imageHeight],
      [(room.boundingBox.x + room.boundingBox.width) / imageWidth, (room.boundingBox.y + room.boundingBox.height) / imageHeight],
      [room.boundingBox.x / imageWidth, (room.boundingBox.y + room.boundingBox.height) / imageHeight]
    ];

    // Find matching unit
    const unitId = unitsByRoom.get(normalizedRoom);
    
    if (unitId) {
      matched++;
    } else {
      unmatched.push(room.roomNumber);
    }

    // Create polygon record
    await db.insert(unitPolygons).values({
      campusMapId,
      rentRollDataId: unitId || null,
      polygonCoordinates: JSON.stringify(polygonCoords),
      normalizedCoordinates: polygonCoords.map(([x, y]) => ({ x, y })),
      displayRoomNumber: room.roomNumber,
      defaultServiceLine: room.serviceLine || null,
      fillColor: unitId ? '#4CAF50' : '#FFC107', // Green if matched, yellow if unmatched
      strokeColor: '#2E7D32',
      label: room.roomNumber
    }).onConflictDoNothing();
    
    created++;
  }

  return { created, matched, unmatched };
}

function normalizeRoomNumber(roomNumber: string): string {
  let normalized = roomNumber.toString().trim().toUpperCase();
  
  normalized = normalized.replace(/^(ROOM|RM|UNIT|APT|APARTMENT)\s*/i, '');
  
  normalized = normalized.replace(/[\s\/_-]/g, '');
  
  normalized = normalized.replace(/^0+(\d)/, '$1');
  
  return normalized;
}

export async function autoMapCampus(campusId: string): Promise<{
  success: boolean;
  message: string;
  stats?: {
    detected: number;
    created: number;
    matched: number;
    unmatched: string[];
  };
}> {
  try {
    // Get campus map with base image
    const campusMap = await db
      .select()
      .from(campusMaps)
      .where(eq(campusMaps.locationId, campusId))
      .limit(1);

    if (!campusMap[0] || !campusMap[0].baseImageUrl) {
      return {
        success: false,
        message: 'No floor plan image found for this campus'
      };
    }

    // Clear existing auto-generated polygons for this campus
    await db
      .delete(unitPolygons)
      .where(
        and(
          eq(unitPolygons.campusMapId, campusMap[0].id),
          isNull(unitPolygons.rentRollDataId) // Only delete unmatched auto-generated ones
        )
      );

    // Detect rooms using AI
    const detectionResult = await detectRoomsWithAI(campusMap[0].baseImageUrl);
    
    // Create polygons from detection
    const mappingResult = await createPolygonsFromDetection(
      campusMap[0].id,
      detectionResult
    );

    return {
      success: true,
      message: `Successfully auto-mapped ${mappingResult.matched} units`,
      stats: {
        detected: detectionResult.detectedRooms.length,
        ...mappingResult
      }
    };
  } catch (error) {
    console.error('Auto-mapping error:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Auto-mapping failed'
    };
  }
}