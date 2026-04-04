import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import OpenAI from 'openai';
import { aiClient } from './aiRouter';

const execAsync = promisify(exec);

export type DetectionStrategy = 'opencv' | 'openai' | 'hybrid';

export interface DetectedRoom {
  label: string;
  polygon: string;
  centerX: number;
  centerY: number;
  roomType?: string;
  confidence: number;
}

export interface DetectionResult {
  success: boolean;
  rooms: DetectedRoom[];
  metadata: {
    imageWidth: number;
    imageHeight: number;
    totalRoomsDetected: number;
    strategyUsed: string;
    fallbackUsed?: boolean;
  };
  error?: string;
}

export class RoomDetectionService {
  private openai: OpenAI;

  constructor() {
    this.openai = aiClient;
  }

  async detect(
    imagePath: string,
    strategy: DetectionStrategy = 'hybrid'
  ): Promise<DetectionResult> {
    try {
      if (strategy === 'opencv' || strategy === 'hybrid') {
        const opencvResult = await this.detectWithOpenCV(imagePath);
        
        // Check if OpenCV result is good enough
        const hasEnoughRooms = opencvResult.rooms.length >= 3;
        const avgConfidence = opencvResult.rooms.length > 0
          ? opencvResult.rooms.reduce((sum, r) => sum + r.confidence, 0) / opencvResult.rooms.length
          : 0;
        
        if (strategy === 'opencv' || (hasEnoughRooms && avgConfidence > 0.7)) {
          return opencvResult;
        }
        
        // Fallback to OpenAI if hybrid and OpenCV results are insufficient
        console.log(`OpenCV detected ${opencvResult.rooms.length} rooms with avg confidence ${avgConfidence.toFixed(2)}. Falling back to OpenAI...`);
      }
      
      // Use OpenAI (either explicitly requested or as fallback)
      return await this.detectWithOpenAI(imagePath, strategy === 'hybrid');
      
    } catch (error) {
      console.error('Room detection error:', error);
      return {
        success: false,
        rooms: [],
        metadata: {
          imageWidth: 1024,
          imageHeight: 683,
          totalRoomsDetected: 0,
          strategyUsed: strategy,
        },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async detectWithOpenCV(imagePath: string): Promise<DetectionResult> {
    try {
      const pythonScript = path.join(process.cwd(), 'server', 'room_detector.py');
      const absoluteImagePath = path.isAbsolute(imagePath) 
        ? imagePath 
        : path.join(process.cwd(), imagePath);
      
      console.log(`Running OpenCV detection on: ${absoluteImagePath}`);
      
      const { stdout, stderr } = await execAsync(
        `python "${pythonScript}" "${absoluteImagePath}"`,
        { timeout: 30000 } // 30 second timeout
      );
      
      if (stderr) {
        console.warn('OpenCV stderr:', stderr);
      }
      
      const result = JSON.parse(stdout);
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      // Convert OpenCV output format to our standard format
      const rooms: DetectedRoom[] = result.rooms.map((room: any, index: number) => {
        // Convert pixel points to percentage-based SVG polygon
        const points = room.points.map((pt: number[]) => [
          (pt[0] / result.image_width) * 100,
          (pt[1] / result.image_height) * 100
        ]);
        
        const polygon = points.map((pt: number[]) => `${pt[0].toFixed(2)},${pt[1].toFixed(2)}`).join(' ');
        
        // Calculate center point
        const centerX = points.reduce((sum: number, pt: number[]) => sum + pt[0], 0) / points.length;
        const centerY = points.reduce((sum: number, pt: number[]) => sum + pt[1], 0) / points.length;
        
        return {
          label: `Room ${index + 1}`,
          polygon,
          centerX: Number(centerX.toFixed(2)),
          centerY: Number(centerY.toFixed(2)),
          roomType: undefined,
          confidence: 0.85, // OpenCV doesn't provide confidence, use fixed value
        };
      });
      
      return {
        success: true,
        rooms,
        metadata: {
          imageWidth: result.image_width,
          imageHeight: result.image_height,
          totalRoomsDetected: rooms.length,
          strategyUsed: 'opencv',
        },
      };
      
    } catch (error) {
      console.error('OpenCV detection failed:', error);
      throw error;
    }
  }

  private async detectWithOpenAI(imagePath: string, isFallback: boolean = false): Promise<DetectionResult> {
    try {
      const fs = await import('fs/promises');
      const imageBuffer = await fs.readFile(imagePath);
      const imageBase64 = imageBuffer.toString('base64');
      
      console.log(`Starting OpenAI room detection${isFallback ? ' (fallback)' : ''}...`);
      
      const response = await Promise.race([
        this.openai.chat.completions.create({
          model: "gpt-5.4",
          messages: [
            {
              role: "system",
              content: `You are an expert at analyzing architectural floor plans for senior living facilities. 
              Analyze the floor plan image and detect individual room boundaries. 
              For each room detected, provide:
              1. A polygon boundary (as normalized coordinates 0-100% for SVG)
              2. A suggested room label (e.g., "101", "AL-102", "MC-01")
              3. Approximate room center point
              4. Room type if identifiable (Studio, 1BR, 2BR, Semi-Private, etc.)
              
              Return your response as a JSON object with this structure:
              {
                "rooms": [
                  {
                    "label": "101",
                    "polygon": "10,10 20,10 20,20 10,20",
                    "centerX": 15,
                    "centerY": 15,
                    "roomType": "Studio",
                    "confidence": 0.95
                  }
                ],
                "imageWidth": 1024,
                "imageHeight": 683
              }
              
              Notes:
              - Polygon coordinates should be in SVG format as percentages (0-100)
              - Only detect actual resident rooms, not common areas
              - Look for room numbers in the image
              - Confidence should be 0-1 (1 being most confident)`
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Analyze this floor plan and detect all resident rooms with their boundaries and labels."
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${imageBase64}`
                  }
                }
              ],
            },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 4096,
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('OpenAI detection timed out after 60 seconds')), 60000)
        )
      ]) as any;
      
      console.log('OpenAI room detection completed successfully');
      
      const detectionResult = JSON.parse(response.choices[0].message.content || '{"rooms": []}');
      
      return {
        success: true,
        rooms: detectionResult.rooms || [],
        metadata: {
          imageWidth: detectionResult.imageWidth || 1024,
          imageHeight: detectionResult.imageHeight || 683,
          totalRoomsDetected: (detectionResult.rooms || []).length,
          strategyUsed: 'openai',
          fallbackUsed: isFallback,
        },
      };
      
    } catch (error) {
      console.error('OpenAI detection failed:', error);
      throw error;
    }
  }
}

export const roomDetectionService = new RoomDetectionService();
