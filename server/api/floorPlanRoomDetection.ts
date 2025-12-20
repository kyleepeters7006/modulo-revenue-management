import OpenAI from "openai";
import { Request, Response } from "express";
import sharp from "sharp";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function detectRoomsInFloorPlan(req: Request, res: Response) {
  try {
    const { image, campusMapId } = req.body;
    
    if (!image || !campusMapId) {
      return res.status(400).json({ error: "Missing image or campusMapId" });
    }
    
    // Extract base64 image data
    let base64Image = image;
    if (image.startsWith('data:')) {
      base64Image = image.split(',')[1];
    }
    
    // Resize image if it's too large (to save on API costs)
    const buffer = Buffer.from(base64Image, 'base64');
    const resizedBuffer = await sharp(buffer)
      .resize(1024, 1024, { 
        fit: 'inside',
        withoutEnlargement: true 
      })
      .toBuffer();
    const resizedBase64 = resizedBuffer.toString('base64');
    
    // Use GPT-5 Vision to analyze the floor plan
    const visionResponse = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content: `You are an expert at analyzing floor plans. Analyze the floor plan image and identify all rooms.
            
            For each room, provide:
            1. Room type (bedroom, bathroom, kitchen, living room, dining room, hallway, closet, etc.)
            2. Approximate relative position in the image (top-left, center, bottom-right, etc.)
            3. Relative size (small, medium, large)
            
            Return the response as a JSON object with this structure:
            {
              "rooms": [
                {
                  "type": "bedroom",
                  "position": "top-left",
                  "size": "large",
                  "label": "Master Bedroom"
                }
              ],
              "summary": "Brief description of the floor plan"
            }
            
            Focus on identifying distinct rooms separated by walls. Include hallways and closets if visible.`
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Please analyze this floor plan and identify all rooms with their types and positions."
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${resizedBase64}`
              }
            }
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2048,
    });
    
    const result = JSON.parse(visionResponse.choices[0].message.content || "{}");
    
    // Convert room descriptions to approximate polygon regions
    // Since GPT-4V can't provide exact coordinates, we'll create approximate regions
    const rooms = result.rooms?.map((room: any, index: number) => {
      // Create approximate polygon based on position description
      const vertices = generateApproximatePolygon(room.position, room.size);
      
      return {
        id: `ai-room-${Date.now()}-${index}`,
        type: room.type,
        label: room.label || `${room.type} ${index + 1}`,
        position: room.position,
        size: room.size,
        vertices: vertices,
        confidence: 0.7 // Indicate these are approximate
      };
    }) || [];
    
    // Log the detection results for future reference
    if (campusMapId) {
      console.log(`Detected ${rooms.length} rooms for campus map ${campusMapId}`);
    }
    
    res.json({
      success: true,
      rooms: rooms,
      summary: result.summary || "Floor plan analyzed successfully",
      message: "Room detection complete. Note: Polygons are approximate regions. Please adjust manually for precision."
    });
    
  } catch (error) {
    console.error("Room detection error:", error);
    res.status(500).json({ 
      error: "Failed to detect rooms",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

// Helper function to generate approximate polygon vertices based on position description
function generateApproximatePolygon(position: string, size: string): Array<{x: number, y: number}> {
  // These are normalized coordinates (0-1 range) that can be scaled to actual image dimensions
  const sizeMultiplier = size === 'large' ? 0.3 : size === 'medium' ? 0.2 : 0.15;
  
  const positions: {[key: string]: {x: number, y: number}} = {
    'top-left': { x: 0.15, y: 0.15 },
    'top-center': { x: 0.5, y: 0.15 },
    'top-right': { x: 0.85, y: 0.15 },
    'center-left': { x: 0.15, y: 0.5 },
    'center': { x: 0.5, y: 0.5 },
    'center-right': { x: 0.85, y: 0.5 },
    'bottom-left': { x: 0.15, y: 0.85 },
    'bottom-center': { x: 0.5, y: 0.85 },
    'bottom-right': { x: 0.85, y: 0.85 },
  };
  
  const centerPos = positions[position] || positions['center'];
  const halfSize = sizeMultiplier / 2;
  
  // Create a rectangular polygon (can be adjusted manually in the UI)
  return [
    { x: (centerPos.x - halfSize), y: (centerPos.y - halfSize) },
    { x: (centerPos.x + halfSize), y: (centerPos.y - halfSize) },
    { x: (centerPos.x + halfSize), y: (centerPos.y + halfSize) },
    { x: (centerPos.x - halfSize), y: (centerPos.y + halfSize) },
  ];
}

// Alternative approach using edge detection (if we want to try without AI)
export async function detectRoomBoundariesWithEdgeDetection(req: Request, res: Response) {
  try {
    const { image, threshold = 100 } = req.body;
    
    if (!image) {
      return res.status(400).json({ error: "Missing image" });
    }
    
    // Extract base64 image data
    let base64Image = image;
    if (image.startsWith('data:')) {
      base64Image = image.split(',')[1];
    }
    
    const buffer = Buffer.from(base64Image, 'base64');
    
    // Use sharp to process the image
    // Convert to grayscale and detect edges
    const edges = await sharp(buffer)
      .greyscale()
      .normalise()
      .convolve({
        width: 3,
        height: 3,
        kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1], // Edge detection kernel
      })
      .toBuffer();
    
    // Convert edge detection result to base64 for client preview
    const edgesBase64 = edges.toString('base64');
    
    res.json({
      success: true,
      edgeImage: `data:image/png;base64,${edgesBase64}`,
      message: "Edge detection complete. Use this to manually trace room boundaries."
    });
    
  } catch (error) {
    console.error("Edge detection error:", error);
    res.status(500).json({ 
      error: "Failed to detect edges",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
}