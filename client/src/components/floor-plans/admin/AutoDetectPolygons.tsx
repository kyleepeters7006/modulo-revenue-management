import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Wand2, AlertCircle, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiRequest } from "@/lib/queryClient";

interface AutoDetectPolygonsProps {
  campusMap: any;
  onPolygonsDetected: (polygons: any[]) => void;
}

export default function AutoDetectPolygons({ campusMap, onPolygonsDetected }: AutoDetectPolygonsProps) {
  const [detecting, setDetecting] = useState(false);
  const [aiDetecting, setAiDetecting] = useState(false);
  const [sensitivity, setSensitivity] = useState([50]);
  const [minRoomSize, setMinRoomSize] = useState([1000]);
  const { toast } = useToast();

  const detectRooms = async () => {
    if (!campusMap?.baseImageUrl) {
      toast({
        title: "No image available",
        description: "Please upload a floor plan image first",
        variant: "destructive",
      });
      return;
    }

    setDetecting(true);

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = campusMap.baseImageUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Could not get canvas context');
      }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Convert to grayscale and apply edge detection
      const edges = detectEdges(data, canvas.width, canvas.height, sensitivity[0] / 100);
      
      // Find contours in the edge-detected image
      const contours = findContours(edges, canvas.width, canvas.height);
      
      // Filter and simplify contours to get room-like rectangles
      const roomPolygons = contours
        .filter(contour => {
          const area = calculateArea(contour);
          return area > minRoomSize[0] && area < (canvas.width * canvas.height * 0.3);
        })
        .map((contour, index) => {
          const simplified = simplifyPolygon(contour, 10);
          return {
            points: simplified,
            label: `Room ${index + 1}`,
            color: getRandomColor(),
          };
        })
        .slice(0, 30); // Limit to 30 rooms

      if (roomPolygons.length === 0) {
        toast({
          title: "No rooms detected",
          description: "Try adjusting the sensitivity or ensure the image has clear room boundaries",
          variant: "destructive",
        });
      } else {
        onPolygonsDetected(roomPolygons);
        toast({
          title: "Rooms detected",
          description: `Found ${roomPolygons.length} potential room shapes`,
        });
      }
    } catch (error) {
      console.error('Auto-detect error:', error);
      toast({
        title: "Detection failed",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setDetecting(false);
    }
  };

  const detectRoomsWithAI = async () => {
    if (!campusMap?.baseImageUrl) {
      toast({
        title: "No image available",
        description: "Please upload a floor plan image first",
        variant: "destructive",
      });
      return;
    }

    setAiDetecting(true);

    try {
      // Call the AI vision endpoint
      const result: any = await apiRequest('/api/floor-plans/detect-rooms', 'POST', {
        campusMapId: campusMap.id,
      });

      if (result?.detected && result.detected.length > 0) {
        // Convert AI response to polygon format
        const roomPolygons = result.detected.map((room: any) => {
          // Parse polygon coordinates from "x1,y1 x2,y2 x3,y3" format
          const coords = room.polygon.split(' ').map((pair: string) => {
            const [x, y] = pair.split(',').map(Number);
            return [
              Math.round((x / 100) * (campusMap.width || 1024)),
              Math.round((y / 100) * (campusMap.height || 683))
            ];
          });

          return {
            points: coords,
            label: room.label,
            color: getRandomColor(),
            roomType: room.roomType,
            confidence: room.confidence
          };
        });

        onPolygonsDetected(roomPolygons);
        toast({
          title: "AI Detection Complete",
          description: `Found ${roomPolygons.length} rooms using AI vision analysis`,
        });
      } else {
        toast({
          title: "No rooms detected",
          description: "The AI couldn't identify rooms in this floor plan",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('AI detection error:', error);
      toast({
        title: "AI Detection failed",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setAiDetecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-purple-600" />
          Auto-Detect Rooms
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This feature analyzes the floor plan image to automatically detect room shapes. 
            Adjust the settings below for best results with your specific floor plan.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label htmlFor="sensitivity">
            Detection Sensitivity: {sensitivity[0]}%
          </Label>
          <Slider
            id="sensitivity"
            value={sensitivity}
            onValueChange={setSensitivity}
            min={10}
            max={90}
            step={5}
            className="w-full"
            data-testid="slider-sensitivity"
          />
          <p className="text-xs text-muted-foreground">
            Higher values detect more edges (use for faint lines)
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="min-size">
            Minimum Room Size: {minRoomSize[0]} sq px
          </Label>
          <Slider
            id="min-size"
            value={minRoomSize}
            onValueChange={setMinRoomSize}
            min={500}
            max={5000}
            step={100}
            className="w-full"
            data-testid="slider-min-size"
          />
          <p className="text-xs text-muted-foreground">
            Filters out shapes smaller than this size
          </p>
        </div>

        <Button
          onClick={detectRooms}
          disabled={detecting || aiDetecting || !campusMap?.baseImageUrl}
          className="w-full bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white font-semibold"
          data-testid="button-auto-detect"
        >
          <Wand2 className="h-4 w-4 mr-2" />
          {detecting ? "Detecting..." : "Auto-Detect Rooms (Free)"}
        </Button>

        <Button
          onClick={detectRoomsWithAI}
          disabled={detecting || aiDetecting || !campusMap?.baseImageUrl}
          className="w-full bg-[var(--trilogy-navy)] hover:bg-[var(--trilogy-dark-blue)] text-white font-semibold shadow-lg"
          data-testid="button-ai-detect"
        >
          <Sparkles className="h-4 w-4 mr-2" />
          {aiDetecting ? "AI Analyzing..." : "AI Detect Rooms (Premium)"}
        </Button>

        <Alert className="mt-2">
          <Sparkles className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>Premium AI Detection:</strong> Uses advanced vision AI to identify room boundaries and labels with higher accuracy. Consumes credits.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

// Edge detection using Sobel operator
function detectEdges(data: Uint8ClampedArray, width: number, height: number, threshold: number): number[] {
  const edges = new Array(width * height).fill(0);
  const gray = new Array(width * height);

  // Convert to grayscale
  for (let i = 0; i < data.length; i += 4) {
    const idx = i / 4;
    gray[idx] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  // Sobel kernels
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0, gy = 0;

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = (y + ky) * width + (x + kx);
          const kernelIdx = (ky + 1) * 3 + (kx + 1);
          gx += gray[idx] * sobelX[kernelIdx];
          gy += gray[idx] * sobelY[kernelIdx];
        }
      }

      const magnitude = Math.sqrt(gx * gx + gy * gy);
      edges[y * width + x] = magnitude > threshold * 255 ? 255 : 0;
    }
  }

  return edges;
}

// Find contours using a simple boundary following algorithm
function findContours(edges: number[], width: number, height: number): number[][][] {
  const visited = new Array(width * height).fill(false);
  const contours: number[][][] = [];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (edges[idx] === 255 && !visited[idx]) {
        const contour = traceContour(edges, visited, width, height, x, y);
        if (contour.length > 20) { // Minimum points for a valid contour
          contours.push(contour);
        }
      }
    }
  }

  return contours;
}

function traceContour(edges: number[], visited: boolean[], width: number, height: number, startX: number, startY: number): number[][] {
  const contour: number[][] = [];
  const directions = [
    [1, 0], [1, 1], [0, 1], [-1, 1],
    [-1, 0], [-1, -1], [0, -1], [1, -1]
  ];

  let x = startX, y = startY;
  let dir = 0;
  const maxPoints = 1000;

  do {
    const idx = y * width + x;
    if (!visited[idx]) {
      contour.push([x, y]);
      visited[idx] = true;
    }

    let found = false;
    for (let i = 0; i < 8; i++) {
      const newDir = (dir + i) % 8;
      const nx = x + directions[newDir][0];
      const ny = y + directions[newDir][1];

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nidx = ny * width + nx;
        if (edges[nidx] === 255) {
          x = nx;
          y = ny;
          dir = newDir;
          found = true;
          break;
        }
      }
    }

    if (!found || contour.length > maxPoints) break;
  } while (!(x === startX && y === startY));

  return contour;
}

function simplifyPolygon(points: number[][], tolerance: number): number[][] {
  if (points.length < 3) return points;

  // Douglas-Peucker algorithm
  let maxDist = 0;
  let maxIndex = 0;

  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyPolygon(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyPolygon(points.slice(maxIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  } else {
    return [first, last];
  }
}

function perpendicularDistance(point: number[], lineStart: number[], lineEnd: number[]): number {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const mag = Math.sqrt(dx * dx + dy * dy);

  if (mag === 0) return Math.sqrt(
    Math.pow(point[0] - lineStart[0], 2) + Math.pow(point[1] - lineStart[1], 2)
  );

  const u = ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / (mag * mag);
  const px = lineStart[0] + u * dx;
  const py = lineStart[1] + u * dy;

  return Math.sqrt(Math.pow(point[0] - px, 2) + Math.pow(point[1] - py, 2));
}

function calculateArea(points: number[][]): number {
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i][0] * points[j][1];
    area -= points[j][0] * points[i][1];
  }

  return Math.abs(area / 2);
}

function getRandomColor(): string {
  const colors = ['#ff6b6b', '#ffd93d', '#6bcf7f', '#4ecdc4', '#a29bfe', '#fd79a8'];
  return colors[Math.floor(Math.random() * colors.length)];
}
