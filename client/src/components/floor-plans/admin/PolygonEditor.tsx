import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Save, Trash2, Undo, Plus, X, Move, Edit, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import AutoDetectPolygons from "./AutoDetectPolygons";

interface PolygonEditorProps {
  campusMap: any;
  locationId: string;
}

interface Point {
  x: number;
  y: number;
}

type EditorMode = 'draw' | 'drag' | 'edit' | null;

export default function PolygonEditor({ campusMap, locationId }: PolygonEditorProps) {
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [fillColor, setFillColor] = useState("#ff6b6b");
  const [isDrawing, setIsDrawing] = useState(false);
  const [detectedPolygons, setDetectedPolygons] = useState<any[]>([]);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [selectedPolygon, setSelectedPolygon] = useState<any>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const [editingPointIndex, setEditingPointIndex] = useState<number | null>(null);
  const [showMobileControls, setShowMobileControls] = useState(false);
  const [draggedPolygon, setDraggedPolygon] = useState<any>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
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
      setSelectedPolygon(null);
    },
  });

  const updatePolygonMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => 
      apiRequest(`/api/unit-polygons/${id}`, 'PATCH', data),
    onSuccess: () => {
      toast({ title: "Success", description: "Polygon updated successfully" });
      queryClient.invalidateQueries({ queryKey: [`/api/unit-polygons/map/${campusMap?.id}`] });
      setEditorMode(null);
      setSelectedPolygon(null);
    },
    onError: (error) => {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    },
  });

  const getCoordinatesFromEvent = (e: React.MouseEvent | React.TouchEvent, imageElem: HTMLImageElement) => {
    const rect = imageElem.getBoundingClientRect();
    let clientX, clientY;

    if ('touches' in e) {
      const touch = e.touches[0] || e.changedTouches[0];
      clientX = touch.clientX;
      clientY = touch.clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = Math.round(((clientX - rect.left) / rect.width) * (campusMap?.width || 1024));
    const y = Math.round(((clientY - rect.top) / rect.height) * (campusMap?.height || 683));

    return { x, y, rawX: clientX - rect.left, rawY: clientY - rect.top };
  };

  const handleImageClick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imageRef.current) return;

    if (isDrawing) {
      const { x, y } = getCoordinatesFromEvent(e, imageRef.current);
      setCurrentPoints([...currentPoints, { x, y }]);
    }
  };

  const handleImageTouch = (e: React.TouchEvent<HTMLImageElement>) => {
    e.preventDefault();
    if (!imageRef.current) return;

    if (isDrawing) {
      const { x, y } = getCoordinatesFromEvent(e, imageRef.current);
      setCurrentPoints([...currentPoints, { x, y }]);
    }
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

  const handlePlaceDetectedPolygon = (polygon: any, dropPosition?: { x: number; y: number }) => {
    // Auto-select next available room if none selected
    let roomToUse = selectedRoomId;
    let selectedRoom = rentRollData.find((r: any) => r.id === selectedRoomId);
    
    if (!roomToUse && availableRooms.length > 0) {
      roomToUse = availableRooms[0].id;
      selectedRoom = availableRooms[0];
      setSelectedRoomId(roomToUse);
    }

    if (!roomToUse || !selectedRoom) {
      toast({
        title: "No rooms available",
        description: "All rooms have been mapped. Delete an existing polygon to free up a room.",
        variant: "destructive",
      });
      return;
    }

    // If drop position provided, adjust polygon coordinates to center at drop location
    let adjustedPoints = polygon.points;
    if (dropPosition && imageRef.current) {
      const rect = imageRef.current.getBoundingClientRect();
      // Convert screen coords to image coords
      const dropX = Math.round((dropPosition.x / rect.width) * (campusMap?.width || 1024));
      const dropY = Math.round((dropPosition.y / rect.height) * (campusMap?.height || 683));
      
      // Calculate polygon center
      const centerX = polygon.points.reduce((sum: number, p: number[]) => sum + p[0], 0) / polygon.points.length;
      const centerY = polygon.points.reduce((sum: number, p: number[]) => sum + p[1], 0) / polygon.points.length;
      
      // Offset to move center to drop position
      const offsetX = dropX - centerX;
      const offsetY = dropY - centerY;
      
      // Adjust all points
      adjustedPoints = polygon.points.map((p: number[]) => [p[0] + offsetX, p[1] + offsetY]);
    }

    const polygonData = {
      campusMapId: campusMap.id,
      rentRollDataId: roomToUse,
      label: selectedRoom.roomNumber,
      polygonCoordinates: JSON.stringify(adjustedPoints),
      fillColor: polygon.color,
      strokeColor: "#334155",
    };

    createPolygonMutation.mutate(polygonData);
    // Remove the polygon from detected list after placing it
    setDetectedPolygons(detectedPolygons.filter((p) => p !== polygon));
    
    toast({
      title: "Room placed",
      description: `Placed ${polygon.label} as Room ${selectedRoom.roomNumber}`,
    });
  };

  const handlePolygonClick = (polygon: any, e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if (editorMode === 'drag' || editorMode === 'edit') {
      setSelectedPolygon(polygon);
      setCurrentPoints(JSON.parse(polygon.polygonCoordinates).map((p: number[]) => ({ x: p[0], y: p[1] })));
      setShowMobileControls(true);
    }
  };

  const handleSaveEditedPolygon = () => {
    if (!selectedPolygon) return;

    const updatedData = {
      polygonCoordinates: JSON.stringify(currentPoints.map(p => [p.x, p.y])),
    };

    updatePolygonMutation.mutate({ id: selectedPolygon.id, data: updatedData });
  };

  const handlePointDrag = (pointIndex: number, e: React.MouseEvent | React.TouchEvent) => {
    if (editorMode !== 'edit' || !imageRef.current) return;
    
    const { x, y } = getCoordinatesFromEvent(e, imageRef.current);
    const newPoints = [...currentPoints];
    newPoints[pointIndex] = { x, y };
    setCurrentPoints(newPoints);
  };

  const handleStartDragMode = () => {
    setEditorMode('drag');
    setIsDrawing(false);
    toast({ title: "Drag Mode", description: "Tap a polygon to move it" });
  };

  const handleStartEditMode = () => {
    setEditorMode('edit');
    setIsDrawing(false);
    toast({ title: "Edit Mode", description: "Tap a polygon to edit its points" });
  };

  const handleCancelEdit = () => {
    setEditorMode(null);
    setSelectedPolygon(null);
    setCurrentPoints([]);
    setShowMobileControls(false);
  };

  const getPolygonPoints = (polygon: any) => {
    if (!imageRef.current) return "";
    const points = JSON.parse(polygon.polygonCoordinates);
    const rect = imageRef.current.getBoundingClientRect();
    return points
      .map((p: number[]) => {
        const x = (p[0] / (campusMap?.width || 1024)) * rect.width;
        const y = (p[1] / (campusMap?.height || 683)) * rect.height;
        return `${x},${y}`;
      })
      .join(" ");
  };

  const handleDragStart = (polygon: any, e: React.DragEvent) => {
    setDraggedPolygon(polygon);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(polygon));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    
    if (!draggedPolygon || !imageRef.current) return;
    
    const rect = imageRef.current.getBoundingClientRect();
    const dropX = e.clientX - rect.left;
    const dropY = e.clientY - rect.top;
    
    handlePlaceDetectedPolygon(draggedPolygon, { x: dropX, y: dropY });
    setDraggedPolygon(null);
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
            rentRollData={rentRollData}
            existingPolygons={existingPolygons}
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
            <Card className="bg-[var(--trilogy-teal)]/10 border-[var(--trilogy-teal)] border-2">
              <CardHeader>
                <CardTitle className="text-[var(--trilogy-navy)] flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                  AI Detected Presets ({detectedPolygons.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[var(--trilogy-dark-blue)] font-medium mb-3">
                  Drag and drop room boxes onto the floor plan below, or click to auto-place:
                </p>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {detectedPolygons.map((polygon, index) => (
                    <div
                      key={index}
                      draggable
                      onDragStart={(e) => handleDragStart(polygon, e)}
                      className="cursor-move"
                      data-testid={`draggable-preset-${index}`}
                    >
                      <Button
                        variant="outline"
                        className="h-auto p-3 w-full flex flex-col items-start gap-1 bg-white hover:bg-[var(--trilogy-teal)] hover:text-white border-[var(--trilogy-teal)] border-2 transition-all font-semibold"
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
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          
          <Card>
            <CardHeader>
              <CardTitle>Editor Tools</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
          {/* Mobile/Touch Editor Modes */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <Button
              variant={editorMode === null && !isDrawing ? "default" : "outline"}
              onClick={() => {
                setEditorMode(null);
                setIsDrawing(false);
                setSelectedPolygon(null);
              }}
              className="flex flex-col items-center py-6"
              data-testid="button-mode-select"
            >
              <Pencil className="h-5 w-5 mb-1" />
              <span className="text-xs">Select</span>
            </Button>
            <Button
              variant={editorMode === 'drag' ? "default" : "outline"}
              onClick={handleStartDragMode}
              className="flex flex-col items-center py-6"
              data-testid="button-mode-drag"
            >
              <Move className="h-5 w-5 mb-1" />
              <span className="text-xs">Move</span>
            </Button>
            <Button
              variant={editorMode === 'edit' ? "default" : "outline"}
              onClick={handleStartEditMode}
              className="flex flex-col items-center py-6"
              data-testid="button-mode-edit"
            >
              <Edit className="h-5 w-5 mb-1" />
              <span className="text-xs">Edit Points</span>
            </Button>
          </div>

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
                  className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white font-semibold"
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
                    className="border-2 border-[var(--trilogy-teal)] text-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)] hover:text-white font-semibold"
                    data-testid="button-undo"
                  >
                    <Undo className="h-4 w-4 mr-2" />
                    Undo Point
                  </Button>
                  <Button
                    variant="outline"
                    onClick={resetDrawing}
                    className="border-2 border-slate-400 text-slate-700 hover:bg-slate-100 font-semibold"
                    data-testid="button-cancel"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                  <Button
                    onClick={handleFinishDrawing}
                    disabled={currentPoints.length < 3}
                    className="bg-[var(--trilogy-navy)] hover:bg-[var(--trilogy-dark-blue)] text-white font-semibold shadow-lg"
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
          {editorMode && (
            <div className="mb-3 p-3 bg-blue-50 rounded border border-blue-200">
              <p className="text-sm font-medium text-blue-900">
                {editorMode === 'drag' && "Tap a room to move it"}
                {editorMode === 'edit' && "Tap a room to edit its corners"}
              </p>
            </div>
          )}
          <div 
            className="relative inline-block touch-none"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <img
              ref={imageRef}
              src={campusMap.baseImageUrl}
              alt="Floor plan"
              className={`max-w-full h-auto border-4 rounded transition-all ${
                isDraggingOver 
                  ? 'border-[var(--trilogy-teal)] shadow-lg' 
                  : isDrawing 
                    ? 'cursor-crosshair border-gray-300' 
                    : editorMode 
                      ? 'cursor-pointer border-gray-300' 
                      : 'border-gray-300'
              }`}
              onClick={handleImageClick}
              onTouchStart={handleImageTouch}
              data-testid="floor-plan-image"
            />
            {isDraggingOver && (
              <div className="absolute inset-0 bg-[var(--trilogy-teal)] bg-opacity-10 border-4 border-dashed border-[var(--trilogy-teal)] rounded pointer-events-none flex items-center justify-center">
                <div className="bg-white px-6 py-3 rounded-lg shadow-lg">
                  <p className="text-[var(--trilogy-teal)] font-semibold text-lg">Drop here to place room</p>
                </div>
              </div>
            )}
            
            {/* SVG overlay for existing polygons, current drawing, and edit mode */}
            <svg
              ref={svgRef}
              className="absolute top-0 left-0 w-full h-full"
              style={{ width: '100%', height: '100%', pointerEvents: editorMode ? 'auto' : 'none' }}
            >
              {/* Show existing polygons */}
              {existingPolygons.map((polygon: any) => (
                <g key={polygon.id}>
                  <polygon
                    points={getPolygonPoints(polygon)}
                    fill={polygon.fillColor}
                    fillOpacity={selectedPolygon?.id === polygon.id ? "0.7" : "0.3"}
                    stroke={selectedPolygon?.id === polygon.id ? "#0066ff" : polygon.strokeColor || "#334155"}
                    strokeWidth={selectedPolygon?.id === polygon.id ? "3" : "2"}
                    className={editorMode ? "cursor-pointer hover:fill-opacity-50" : ""}
                    onClick={(e) => handlePolygonClick(polygon, e)}
                    onTouchStart={(e) => handlePolygonClick(polygon, e)}
                    style={{ pointerEvents: editorMode ? 'auto' : 'none' }}
                    data-testid={`polygon-${polygon.label}`}
                  />
                  {/* Show polygon label */}
                  {imageRef.current && (() => {
                    const points = JSON.parse(polygon.polygonCoordinates);
                    const rect = imageRef.current.getBoundingClientRect();
                    const centerX = points.reduce((sum: number, p: number[]) => sum + p[0], 0) / points.length;
                    const centerY = points.reduce((sum: number, p: number[]) => sum + p[1], 0) / points.length;
                    const x = (centerX / (campusMap?.width || 1024)) * rect.width;
                    const y = (centerY / (campusMap?.height || 683)) * rect.height;
                    return (
                      <text
                        x={x}
                        y={y}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="white"
                        stroke="black"
                        strokeWidth="0.5"
                        fontSize="14"
                        fontWeight="bold"
                        style={{ pointerEvents: 'none' }}
                      >
                        {polygon.label}
                      </text>
                    );
                  })()}
                </g>
              ))}

              {/* Show current drawing or edited polygon */}
              {(isDrawing || (editorMode && selectedPolygon)) && currentPoints.length > 0 && (
                <>
                  <polygon
                    points={getSvgPoints()}
                    fill={selectedPolygon?.fillColor || fillColor}
                    fillOpacity="0.5"
                    stroke="#0066ff"
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
                        r={editorMode === 'edit' ? "8" : "5"}
                        fill={editorMode === 'edit' ? "#ff6b6b" : "#0066ff"}
                        stroke="white"
                        strokeWidth="2"
                        className={editorMode === 'edit' ? "cursor-move" : ""}
                        onMouseDown={editorMode === 'edit' ? (e) => handlePointDrag(index, e) : undefined}
                        onTouchStart={editorMode === 'edit' ? (e) => handlePointDrag(index, e) : undefined}
                        style={{ pointerEvents: editorMode === 'edit' ? 'auto' : 'none' }}
                        data-testid={`point-${index}`}
                      />
                    );
                  })}
                </>
              )}
            </svg>
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

      {/* Mobile Edit Dialog */}
      <Dialog open={showMobileControls && !!selectedPolygon} onOpenChange={setShowMobileControls}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Editing Room {selectedPolygon?.label}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {editorMode === 'edit' && (
              <div className="bg-blue-50 p-3 rounded">
                <p className="text-sm text-blue-900">
                  Drag the red circles on the floor plan to adjust the room shape
                </p>
              </div>
            )}
            {editorMode === 'drag' && (
              <div className="bg-blue-50 p-3 rounded">
                <p className="text-sm text-blue-900">
                  Tap and drag the highlighted room to move it
                </p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded border"
                style={{ backgroundColor: selectedPolygon?.fillColor }}
              />
              <div className="text-sm">
                <div className="font-medium">Room {selectedPolygon?.label}</div>
                <div className="text-slate-500">{currentPoints.length} points</div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleCancelEdit}
                className="flex-1"
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveEditedPolygon}
                className="flex-1 bg-[var(--trilogy-navy)]"
                disabled={updatePolygonMutation.isPending}
                data-testid="button-save-edit"
              >
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </Button>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (selectedPolygon) {
                  deletePolygonMutation.mutate(selectedPolygon.id);
                  setShowMobileControls(false);
                }
              }}
              className="w-full"
              data-testid="button-delete-mobile"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Room
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
