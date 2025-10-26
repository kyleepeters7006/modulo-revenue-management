import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Save, Trash2, Undo, Plus, X } from "lucide-react";
import AutoDetectPolygons from "./AutoDetectPolygons";

interface PolygonEditorProps {
  campusMap: any;
  locationId: string;
}

interface Point {
  x: number;
  y: number;
}

export default function PolygonEditor({ campusMap, locationId }: PolygonEditorProps) {
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [fillColor, setFillColor] = useState("#ff6b6b");
  const [isDrawing, setIsDrawing] = useState(false);
  const [detectedPolygons, setDetectedPolygons] = useState<any[]>([]);
  const imageRef = useRef<HTMLImageElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: rentRollData = [] } = useQuery({
    queryKey: [`/api/rent-roll-data/location/${locationId}`],
    enabled: !!locationId,
  });

  const { data: existingPolygons = [] } = useQuery({
    queryKey: [`/api/unit-polygons/map/${campusMap?.id}`],
    enabled: !!campusMap?.id,
  });

  const createPolygonMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/unit-polygons', 'POST', data),
    onSuccess: () => {
      toast({ title: "Success", description: "Polygon created successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/unit-polygons/map/${campusMap?.id}`] });
      resetDrawing();
    },
    onError: (error) => {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    },
  });

  const deletePolygonMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/unit-polygons/${id}`, 'DELETE'),
    onSuccess: () => {
      toast({ title: "Success", description: "Polygon deleted successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/unit-polygons/map/${campusMap?.id}`] });
    },
  });

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!isDrawing || !imageRef.current) return;

    const rect = imageRef.current.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * (campusMap?.width || 1024));
    const y = Math.round(((e.clientY - rect.top) / rect.height) * (campusMap?.height || 683));

    setCurrentPoints([...currentPoints, { x, y }]);
  };

  const handleStartDrawing = () => {
    setIsDrawing(true);
    setCurrentPoints([]);
  };

  const handleFinishDrawing = () => {
    if (currentPoints.length < 3) {
      toast({
        title: "Invalid polygon",
        description: "A polygon needs at least 3 points",
        variant: "destructive",
      });
      return;
    }

    if (!selectedRoomId) {
      toast({
        title: "No room selected",
        description: "Please select a room to link this polygon to",
        variant: "destructive",
      });
      return;
    }

    const selectedRoom = rentRollData.find((r: any) => r.id === selectedRoomId);
    if (!selectedRoom) return;

    const polygonData = {
      campusMapId: campusMap.id,
      rentRollDataId: selectedRoomId,
      label: selectedRoom.roomNumber,
      polygonCoordinates: JSON.stringify(currentPoints.map(p => [p.x, p.y])),
      fillColor,
      strokeColor: "#334155",
    };

    createPolygonMutation.mutate(polygonData);
  };

  const resetDrawing = () => {
    setIsDrawing(false);
    setCurrentPoints([]);
    setSelectedRoomId("");
  };

  const handleUndo = () => {
    setCurrentPoints(currentPoints.slice(0, -1));
  };

  const getSvgPoints = () => {
    if (!imageRef.current || currentPoints.length === 0) return "";
    const rect = imageRef.current.getBoundingClientRect();
    return currentPoints
      .map(p => {
        const x = (p.x / (campusMap?.width || 1024)) * rect.width;
        const y = (p.y / (campusMap?.height || 683)) * rect.height;
        return `${x},${y}`;
      })
      .join(" ");
  };

  const availableRooms = rentRollData.filter((room: any) => {
    return !existingPolygons.some((p: any) => p.rentRollDataId === room.id);
  });

  if (!campusMap?.baseImageUrl) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-slate-500">No floor plan image available. Please upload an image first.</p>
        </CardContent>
      </Card>
    );
  }

  const handlePolygonsDetected = (polygons: any[]) => {
    setDetectedPolygons(polygons);
    toast({
      title: "Polygons detected",
      description: `Found ${polygons.length} room shapes. Review and save them below.`,
    });
  };

  const handlePlaceDetectedPolygon = (polygon: any) => {
    if (!selectedRoomId) {
      toast({
        title: "No room selected",
        description: "Please select a room to link this polygon to",
        variant: "destructive",
      });
      return;
    }

    const selectedRoom = rentRollData.find((r: any) => r.id === selectedRoomId);
    if (!selectedRoom) return;

    const polygonData = {
      campusMapId: campusMap.id,
      rentRollDataId: selectedRoomId,
      label: selectedRoom.roomNumber,
      polygonCoordinates: JSON.stringify(polygon.points),
      fillColor: polygon.color,
      strokeColor: "#334155",
    };

    createPolygonMutation.mutate(polygonData);
    // Remove the polygon from detected list after placing it
    setDetectedPolygons(detectedPolygons.filter((p) => p !== polygon));
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="auto" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="auto" data-testid="tab-auto">Step 1: Auto-Detect</TabsTrigger>
          <TabsTrigger value="manual" data-testid="tab-manual">Step 2: Place & Draw</TabsTrigger>
        </TabsList>

        <TabsContent value="auto" className="space-y-4">
          <AutoDetectPolygons 
            campusMap={campusMap} 
            onPolygonsDetected={handlePolygonsDetected}
          />
          
          {detectedPolygons.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Detected Rooms ({detectedPolygons.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  Review the detected rooms below. You can save all or delete individual ones.
                </p>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {detectedPolygons.map((polygon, index) => (
                    <div key={index} className="flex items-center justify-between p-3 border rounded">
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-6 h-6 rounded border"
                          style={{ backgroundColor: polygon.color }}
                        />
                        <div>
                          <div className="font-medium">{polygon.label}</div>
                          <div className="text-xs text-slate-500">
                            {polygon.points.length} points
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setDetectedPolygons(detectedPolygons.filter((_, i) => i !== index));
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button
                  className="w-full mt-4"
                  onClick={() => {
                    toast({
                      title: "Feature coming soon",
                      description: "Bulk save detected polygons will be available soon. Please use manual drawing for now.",
                    });
                  }}
                >
                  Save All Detected Rooms
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="manual" className="space-y-4">
          {detectedPolygons.length > 0 && (
            <Card className="bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800">
              <CardHeader>
                <CardTitle className="text-purple-900 dark:text-purple-100 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                  AI Detected Presets ({detectedPolygons.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-purple-800 dark:text-purple-200 mb-3">
                  Select a room below, then click a detected polygon preset to place it:
                </p>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {detectedPolygons.map((polygon, index) => (
                    <Button
                      key={index}
                      variant="outline"
                      className="h-auto p-3 flex flex-col items-start gap-1 hover:bg-purple-100 dark:hover:bg-purple-900/30"
                      onClick={() => handlePlaceDetectedPolygon(polygon)}
                      data-testid={`button-preset-${index}`}
                    >
                      <div className="flex items-center gap-2 w-full">
                        <div 
                          className="w-4 h-4 rounded border"
                          style={{ backgroundColor: polygon.color }}
                        />
                        <span className="font-medium text-sm">{polygon.label || `Preset ${index + 1}`}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {polygon.points.length} points • {polygon.roomType || 'Unknown type'}
                      </span>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          
          <Card>
            <CardHeader>
              <CardTitle>Manual Drawing Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label htmlFor="room-select">Select Room</Label>
              <Select 
                value={selectedRoomId} 
                onValueChange={setSelectedRoomId}
                disabled={isDrawing}
              >
                <SelectTrigger data-testid="select-room">
                  <SelectValue placeholder="Choose a room..." />
                </SelectTrigger>
                <SelectContent>
                  {availableRooms.map((room: any) => (
                    <SelectItem key={room.id} value={room.id}>
                      Room {room.roomNumber} - {room.size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="fill-color">Polygon Color</Label>
              <div className="flex gap-2">
                <Input
                  id="fill-color"
                  type="color"
                  value={fillColor}
                  onChange={(e) => setFillColor(e.target.value)}
                  disabled={isDrawing}
                  className="w-20"
                  data-testid="input-color"
                />
                <Input
                  value={fillColor}
                  onChange={(e) => setFillColor(e.target.value)}
                  disabled={isDrawing}
                  placeholder="#ff6b6b"
                  data-testid="input-color-text"
                />
              </div>
            </div>

            <div className="flex items-end gap-2">
              {!isDrawing ? (
                <Button
                  onClick={handleStartDrawing}
                  disabled={!selectedRoomId}
                  data-testid="button-start-drawing"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Start Drawing
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={handleUndo}
                    disabled={currentPoints.length === 0}
                    data-testid="button-undo"
                  >
                    <Undo className="h-4 w-4 mr-2" />
                    Undo Point
                  </Button>
                  <Button
                    variant="outline"
                    onClick={resetDrawing}
                    data-testid="button-cancel"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                  <Button
                    onClick={handleFinishDrawing}
                    disabled={currentPoints.length < 3}
                    data-testid="button-finish"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    Save Polygon
                  </Button>
                </>
              )}
            </div>
          </div>

          {isDrawing && (
            <div className="text-sm text-slate-600 bg-blue-50 p-3 rounded">
              <strong>Drawing mode:</strong> Click on the floor plan to add points. 
              Points: {currentPoints.length} {currentPoints.length < 3 && "(need at least 3)"}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="relative inline-block">
            <img
              ref={imageRef}
              src={campusMap.baseImageUrl}
              alt="Floor plan"
              className={`max-w-full h-auto border rounded ${isDrawing ? 'cursor-crosshair' : ''}`}
              onClick={handleImageClick}
              data-testid="floor-plan-image"
            />
            
            {isDrawing && currentPoints.length > 0 && (
              <svg
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
                style={{ width: '100%', height: '100%' }}
              >
                <polygon
                  points={getSvgPoints()}
                  fill={fillColor}
                  fillOpacity="0.5"
                  stroke="#000"
                  strokeWidth="2"
                />
                {currentPoints.map((point, index) => {
                  const rect = imageRef.current?.getBoundingClientRect();
                  if (!rect) return null;
                  const x = (point.x / (campusMap?.width || 1024)) * rect.width;
                  const y = (point.y / (campusMap?.height || 683)) * rect.height;
                  return (
                    <circle
                      key={index}
                      cx={x}
                      cy={y}
                      r="5"
                      fill="#0066ff"
                      stroke="white"
                      strokeWidth="2"
                    />
                  );
                })}
              </svg>
            )}
          </div>
        </CardContent>
      </Card>

          {existingPolygons.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Existing Polygons ({existingPolygons.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {existingPolygons.map((polygon: any) => (
                    <div
                      key={polygon.id}
                      className="flex items-center justify-between p-3 border rounded hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-6 h-6 rounded border"
                          style={{ backgroundColor: polygon.fillColor }}
                        />
                        <div>
                          <div className="font-medium">Room {polygon.label}</div>
                          <div className="text-sm text-slate-500">
                            {JSON.parse(polygon.polygonCoordinates).length} points
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deletePolygonMutation.mutate(polygon.id)}
                        data-testid={`button-delete-${polygon.label}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
