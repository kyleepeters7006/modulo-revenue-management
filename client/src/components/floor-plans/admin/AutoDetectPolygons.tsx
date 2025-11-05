import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Wand2, AlertCircle, Sparkles } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface AutoDetectPolygonsProps {
  campusMap: any;
  onPolygonsDetected: (polygons: any[]) => void;
  rentRollData?: any[];
  existingPolygons?: any[];
}

export default function AutoDetectPolygons({ 
  campusMap, 
  onPolygonsDetected,
  rentRollData = [],
  existingPolygons = []
}: AutoDetectPolygonsProps) {
  const [autoMapping, setAutoMapping] = useState(false);
  const { toast } = useToast();

  const autoMapAndSaveAll = async () => {
    if (!campusMap?.baseImageUrl) {
      toast({
        title: "No image available",
        description: "Please upload a floor plan image first",
        variant: "destructive",
      });
      return;
    }

    if (rentRollData.length === 0) {
      toast({
        title: "No rooms available",
        description: "No rent roll data found for this location",
        variant: "destructive",
      });
      return;
    }

    setAutoMapping(true);

    try {
      // Step 1: Detect rooms using AI
      const result: any = await apiRequest('/api/floor-plans/detect-rooms', 'POST', {
        campusMapId: campusMap.id,
      });

      if (!result?.detected || result.detected.length === 0) {
        toast({
          title: "No rooms detected",
          description: "The AI couldn't identify rooms in this floor plan",
          variant: "destructive",
        });
        return;
      }

      // Step 2: Convert AI response to polygon format with center coordinates
      const detectedRooms = result.detected.map((room: any) => {
        const coords = room.polygon.split(' ').map((pair: string) => {
          const [x, y] = pair.split(',').map(Number);
          return [
            Math.round((x / 100) * (campusMap.width || 1024)),
            Math.round((y / 100) * (campusMap.height || 683))
          ];
        });

        // Calculate center x-coordinate for sorting
        const centerX = coords.reduce((sum: number, p: number[]) => sum + p[0], 0) / coords.length;

        return {
          points: coords,
          centerX,
          color: getRandomColor(),
          roomType: room.roomType,
          confidence: room.confidence
        };
      });

      // Step 3: Sort detected rooms left to right by center X coordinate
      detectedRooms.sort((a: any, b: any) => a.centerX - b.centerX);

      // Step 4: Get available rooms (not yet assigned to polygons)
      const assignedRoomIds = new Set(existingPolygons.map((p: any) => p.rentRollDataId));
      const availableRooms = rentRollData
        .filter((room: any) => !assignedRoomIds.has(room.id))
        .sort((a: any, b: any) => {
          // Sort by room number alphanumerically (handles "A1", "101B", etc.)
          return a.roomNumber.localeCompare(b.roomNumber, undefined, { 
            numeric: true, 
            sensitivity: 'base' 
          });
        });

      if (availableRooms.length === 0) {
        toast({
          title: "All rooms assigned",
          description: "All rooms in this location already have polygons assigned",
          variant: "destructive",
        });
        return;
      }

      // Step 5: Match detected rooms to available rooms sequentially
      const matchCount = Math.min(detectedRooms.length, availableRooms.length);
      const polygonsToCreate = [];

      for (let i = 0; i < matchCount; i++) {
        const detectedRoom = detectedRooms[i];
        const assignedRoom = availableRooms[i];

        polygonsToCreate.push({
          campusMapId: campusMap.id,
          rentRollDataId: assignedRoom.id,
          label: assignedRoom.roomNumber,
          polygonCoordinates: JSON.stringify(detectedRoom.points),
          fillColor: detectedRoom.color,
          strokeColor: "#334155",
        });
      }

      // Step 6: Save all polygons
      toast({
        title: "Saving polygons...",
        description: `Auto-mapping ${matchCount} rooms from left to right`,
      });

      let savedCount = 0;
      for (const polygonData of polygonsToCreate) {
        try {
          await apiRequest('/api/unit-polygons', 'POST', polygonData);
          savedCount++;
        } catch (err) {
          console.error('Error saving polygon:', err);
        }
      }

      // Invalidate the query cache to refresh the UI with newly saved polygons
      await queryClient.invalidateQueries({ 
        queryKey: ['/api/unit-polygons/map', campusMap.id] 
      });

      toast({
        title: "Auto-mapping complete!",
        description: `Successfully mapped and saved ${savedCount} out of ${matchCount} rooms in left-to-right order`,
      });

    } catch (error) {
      console.error('Auto-mapping error:', error);
      toast({
        title: "Auto-mapping failed",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setAutoMapping(false);
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
          <Sparkles className="h-4 w-4" />
          <AlertDescription>
            Uses AI to scan the floor plan, detect all rooms, sort them left-to-right, and automatically assign them to your available units. Everything saves in one click.
          </AlertDescription>
        </Alert>

        <Button
          onClick={autoMapAndSaveAll}
          disabled={autoMapping || !campusMap?.baseImageUrl || rentRollData.length === 0}
          className="w-full bg-gradient-to-r from-purple-600 to-[var(--trilogy-navy)] hover:from-purple-700 hover:to-[var(--trilogy-dark-blue)] text-white font-bold shadow-xl h-12"
          data-testid="button-auto-detect"
        >
          <Sparkles className="h-5 w-5 mr-2" />
          {autoMapping ? "Detecting & Mapping..." : "Auto-Detect & Map Rooms"}
        </Button>

        {rentRollData.length === 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              No units available to map. Please select a location with rent roll data.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function getRandomColor(): string {
  const colors = ['#ff6b6b', '#ffd93d', '#6bcf7f', '#4ecdc4', '#a29bfe', '#fd79a8'];
  return colors[Math.floor(Math.random() * colors.length)];
}
