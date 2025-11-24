import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Edit3, 
  X, 
  Wand2, 
  Save, 
  Upload, 
  MousePointer,
  Pentagon,
  Square,
  Circle,
  Move,
  Trash2,
  Loader2,
  Home,
  Bed,
  Eye,
  EyeOff,
  Search
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface FloorPlanEditorProps {
  campusMap: any;
  units: any[];
  onClose?: () => void;
}

interface Point {
  x: number;
  y: number;
}

interface RoomPolygon {
  id: string;
  points: Point[];
  label: string;
  unitId?: string;
  fillColor: string;
  strokeColor: string;
  temporary?: boolean;
}

type DrawingTool = 'select' | 'polygon' | 'rectangle' | 'circle' | 'ai-detect';

export default function FloorPlanEditor({ campusMap, units, onClose }: FloorPlanEditorProps) {
  const [zoom, setZoom] = useState(1);
  const [selectedTool, setSelectedTool] = useState<DrawingTool>('select');
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [roomPolygons, setRoomPolygons] = useState<RoomPolygon[]>([]);
  const [selectedPolygon, setSelectedPolygon] = useState<string | null>(null);
  const [draggedUnit, setDraggedUnit] = useState<any | null>(null);
  const [hoveredPolygon, setHoveredPolygon] = useState<string | null>(null);
  const [showPolygons, setShowPolygons] = useState(true);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [assignmentDialog, setAssignmentDialog] = useState<{open: boolean; polygon: RoomPolygon | null}>({
    open: false,
    polygon: null
  });
  const [searchTerm, setSearchTerm] = useState("");
  
  const svgRef = useRef<SVGSVGElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  // Fetch existing unit polygons
  const { data: existingPolygons = [], isLoading: isLoadingPolygons } = useQuery({
    queryKey: [`/api/unit-polygons/map/${campusMap.id}`],
    enabled: !!campusMap.id,
  });

  // Load existing polygons
  useEffect(() => {
    if (existingPolygons.length > 0) {
      const loadedPolygons = existingPolygons.map((p: any) => ({
        id: p.id,
        points: parsePolygonString(p.polygonCoordinates),
        label: p.label,
        unitId: p.rentRollDataId,
        fillColor: p.fillColor || 'rgba(59, 130, 246, 0.3)',
        strokeColor: '#3b82f6'
      }));
      setRoomPolygons(loadedPolygons);
    }
  }, [existingPolygons]);

  // Parse polygon string to points array
  const parsePolygonString = (coordString: string): Point[] => {
    if (!coordString) return [];
    return coordString.split(' ').map(coord => {
      const [x, y] = coord.split(',').map(Number);
      return { x, y };
    });
  };

  // Convert points to polygon string
  const pointsToString = (points: Point[]): string => {
    return points.map(p => `${p.x},${p.y}`).join(' ');
  };

  // Upload site plan image mutation
  const uploadImageMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('name', campusMap.name || 'Site Plan');
      formData.append('locationId', campusMap.locationId || '');
      formData.append('width', '1920');
      formData.append('height', '1080');
      formData.append('isTemplate', 'false');
      
      const response = await fetch('/api/campus-maps/upload-image', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) throw new Error('Upload failed');
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Image Uploaded",
        description: "Site plan image uploaded successfully. Refreshing...",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/campus-maps/${campusMap.locationId}`] });
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    },
    onError: (error) => {
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to upload image",
        variant: "destructive",
      });
    }
  });

  // Handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadImageMutation.mutate(file);
    }
  };

  // Save polygon mutation
  const savePolygonMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest(`/api/unit-polygons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Room polygon saved successfully",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/unit-polygons/map/${campusMap.id}`] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to save polygon: " + error,
        variant: "destructive",
      });
    },
  });

  // AI room detection mutation
  const detectRoomsMutation = useMutation({
    mutationFn: async (params: { campusMapId: string, strategy?: string }) => {
      // The endpoint expects multipart/form-data, not JSON
      const formData = new FormData();
      formData.append('campusMapId', params.campusMapId);
      formData.append('strategy', params.strategy || 'hybrid');
      
      return await fetch(`/api/floor-plans/detect-rooms`, {
        method: "POST",
        body: formData,
      }).then(res => res.json());
    },
    onSuccess: (data) => {
      if (data.detected && Array.isArray(data.detected)) {
        const newPolygons = data.detected.map((room: any, index: number) => ({
          id: `ai-room-${Date.now()}-${index}`,
          points: parsePolygonString(room.polygon),
          label: room.label || `Room ${index + 1}`,
          fillColor: 'rgba(16, 185, 129, 0.3)',
          strokeColor: '#10b981',
          temporary: true
        }));
        setRoomPolygons(prev => [...prev, ...newPolygons]);
        toast({
          title: "Rooms detected",
          description: `Found ${data.detected.length} rooms in the floor plan`,
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Detection failed",
        description: "Could not detect rooms: " + error,
        variant: "destructive",
      });
    },
  });

  // Handle canvas click for polygon drawing
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (selectedTool !== 'polygon' || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    
    setCurrentPoints(prev => [...prev, { x, y }]);
    
    if (!isDrawing) {
      setIsDrawing(true);
    }
  };

  // Complete polygon drawing
  const completePolygon = () => {
    if (currentPoints.length < 3) {
      toast({
        title: "Invalid polygon",
        description: "A polygon needs at least 3 points",
        variant: "destructive",
      });
      return;
    }
    
    const newPolygon: RoomPolygon = {
      id: `polygon-${Date.now()}`,
      points: currentPoints,
      label: `Room ${roomPolygons.length + 1}`,
      fillColor: 'rgba(59, 130, 246, 0.3)',
      strokeColor: '#3b82f6',
      temporary: true
    };
    
    setRoomPolygons(prev => [...prev, newPolygon]);
    setCurrentPoints([]);
    setIsDrawing(false);
    setSelectedTool('select');
  };

  // Handle drag and drop
  const handleDragStart = (e: React.DragEvent, unit: any) => {
    setDraggedUnit(unit);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', unit.roomNumber);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, polygon: RoomPolygon) => {
    e.preventDefault();
    
    if (!draggedUnit) return;
    
    // Assign unit to polygon
    const updatedPolygon = {
      ...polygon,
      unitId: draggedUnit.id,
      label: draggedUnit.roomNumber,
      fillColor: draggedUnit.occupiedYN ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'
    };
    
    setRoomPolygons(prev => 
      prev.map(p => p.id === polygon.id ? updatedPolygon : p)
    );
    
    // Save assignment
    savePolygonMutation.mutate({
      campusMapId: campusMap.id,
      label: draggedUnit.roomNumber,
      polygonCoordinates: pointsToString(polygon.points),
      fillColor: updatedPolygon.fillColor,
      rentRollDataId: draggedUnit.id
    });
    
    setDraggedUnit(null);
  };

  // AI Room Detection
  const detectRoomsWithAI = async () => {
    if (!campusMap.baseImageUrl && !campusMap.svgContent) {
      toast({
        title: "No floor plan",
        description: "Please upload a floor plan image first",
        variant: "destructive",
      });
      return;
    }
    
    setIsProcessingAI(true);
    
    try {
      // Use the existing detect-rooms endpoint
      await detectRoomsMutation.mutateAsync({
        campusMapId: campusMap.id,
        strategy: 'hybrid' // Use hybrid strategy for better results
      });
    } catch (error) {
      console.error('AI detection error:', error);
    } finally {
      setIsProcessingAI(false);
    }
  };

  // Save all polygons
  const saveAllPolygons = async () => {
    const temporaryPolygons = roomPolygons.filter(p => p.temporary);
    
    if (temporaryPolygons.length === 0) {
      toast({
        title: "No changes",
        description: "All polygons are already saved",
      });
      return;
    }
    
    for (const polygon of temporaryPolygons) {
      await savePolygonMutation.mutateAsync({
        campusMapId: campusMap.id,
        label: polygon.label,
        polygonCoordinates: pointsToString(polygon.points),
        fillColor: polygon.fillColor,
        rentRollDataId: polygon.unitId
      });
    }
    
    setRoomPolygons(prev => 
      prev.map(p => ({ ...p, temporary: false }))
    );
  };

  // Filter units based on search
  const filteredUnits = units.filter(unit =>
    unit.roomNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    unit.roomType?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex h-[90vh] gap-4">
      {/* Left Panel - Floor Plan */}
      <Card className="flex-1 flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Floor Plan Editor</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPolygons(!showPolygons)}
                title={showPolygons ? "Hide polygons" : "Show polygons"}
              >
                {showPolygons ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}
                title="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground w-12 text-center">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom(Math.min(3, zoom + 0.1))}
                title="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom(1)}
                title="Reset zoom"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        
        {/* Toolbar */}
        <div className="px-4 py-2 border-b">
          <div className="flex items-center gap-2">
            <div className="flex gap-1 p-1 bg-muted rounded-md">
              <Button
                variant={selectedTool === 'select' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSelectedTool('select')}
                title="Select tool"
              >
                <MousePointer className="h-4 w-4" />
              </Button>
              <Button
                variant={selectedTool === 'polygon' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSelectedTool('polygon')}
                title="Draw polygon"
              >
                <Pentagon className="h-4 w-4" />
              </Button>
              <Button
                variant={selectedTool === 'rectangle' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSelectedTool('rectangle')}
                title="Draw rectangle"
              >
                <Square className="h-4 w-4" />
              </Button>
              <Button
                variant={selectedTool === 'ai-detect' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => {
                  setSelectedTool('ai-detect');
                  detectRoomsWithAI();
                }}
                disabled={isProcessingAI}
                title="AI room detection"
              >
                {isProcessingAI ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
              </Button>
            </div>
            
            <Separator orientation="vertical" className="h-6" />
            
            {/* Upload Site Plan Image */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadImageMutation.isPending}
              title="Upload site plan image"
            >
              {uploadImageMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Upload className="h-4 w-4 mr-1" />
              )}
              Upload Image
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            
            <Separator orientation="vertical" className="h-6" />
            
            {isDrawing && (
              <>
                <Button
                  variant="default"
                  size="sm"
                  onClick={completePolygon}
                >
                  Complete Polygon
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCurrentPoints([]);
                    setIsDrawing(false);
                  }}
                >
                  Cancel
                </Button>
              </>
            )}
            
            {selectedPolygon && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRoomPolygons(prev => prev.filter(p => p.id !== selectedPolygon));
                    setSelectedPolygon(null);
                  }}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
            
            <div className="ml-auto">
              <Button
                onClick={saveAllPolygons}
                size="sm"
                disabled={!roomPolygons.some(p => p.temporary)}
              >
                <Save className="h-4 w-4 mr-1" />
                Save Changes
              </Button>
            </div>
          </div>
        </div>
        
        {/* Canvas Area */}
        <CardContent className="flex-1 overflow-auto p-4">
          <div 
            className="relative inline-block"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          >
            {/* Floor Plan Image or SVG */}
            {campusMap.baseImageUrl && (
              <img
                ref={imageRef}
                src={campusMap.baseImageUrl}
                alt="Floor Plan"
                className="max-w-full"
                style={{ display: 'block' }}
                onDragOver={handleDragOver}
              />
            )}
            {campusMap.svgContent && !campusMap.baseImageUrl && (
              <div
                dangerouslySetInnerHTML={{ __html: campusMap.svgContent }}
                className="w-full h-full"
                onDragOver={handleDragOver}
              />
            )}
            
            {/* SVG Overlay for Polygons */}
            <svg
              ref={svgRef}
              className="absolute top-0 left-0 w-full h-full"
              style={{
                pointerEvents: selectedTool === 'select' ? 'auto' : 'none',
                cursor: selectedTool === 'polygon' ? 'crosshair' : 'default'
              }}
              onClick={handleCanvasClick}
            >
              {showPolygons && roomPolygons.map(polygon => (
                <g
                  key={polygon.id}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, polygon)}
                  className="cursor-pointer"
                  onClick={() => setSelectedPolygon(polygon.id)}
                  onMouseEnter={() => setHoveredPolygon(polygon.id)}
                  onMouseLeave={() => setHoveredPolygon(null)}
                >
                  <polygon
                    points={pointsToString(polygon.points)}
                    fill={polygon.fillColor}
                    stroke={polygon.strokeColor}
                    strokeWidth={selectedPolygon === polygon.id ? 3 : hoveredPolygon === polygon.id ? 2 : 1}
                    opacity={polygon.temporary ? 0.5 : 0.7}
                  />
                  <text
                    x={polygon.points[0]?.x}
                    y={polygon.points[0]?.y}
                    fill={polygon.strokeColor}
                    fontSize="12"
                    fontWeight="bold"
                  >
                    {polygon.label}
                  </text>
                </g>
              ))}
              
              {/* Current drawing polygon */}
              {isDrawing && currentPoints.length > 0 && (
                <>
                  <polyline
                    points={pointsToString(currentPoints)}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="2"
                    strokeDasharray="5,5"
                  />
                  {currentPoints.map((point, index) => (
                    <circle
                      key={index}
                      cx={point.x}
                      cy={point.y}
                      r="4"
                      fill="#3b82f6"
                    />
                  ))}
                </>
              )}
            </svg>
          </div>
        </CardContent>
      </Card>
      
      {/* Right Panel - Unit List */}
      <Card className="w-80">
        <CardHeader>
          <CardTitle className="text-lg">Available Units</CardTitle>
          <CardDescription>
            Drag units to rooms on the floor plan
          </CardDescription>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search units..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(90vh-200px)]">
            <div className="space-y-2">
              {filteredUnits.map(unit => (
                <div
                  key={unit.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, unit)}
                  className={`p-3 border rounded-lg cursor-move hover:shadow-md transition-shadow ${
                    unit.occupiedYN ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'
                  }`}
                  data-testid={`draggable-unit-${unit.roomNumber}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold">{unit.roomNumber}</span>
                    <Badge variant={unit.occupiedYN ? "destructive" : "success"}>
                      {unit.occupiedYN ? "Occupied" : "Available"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex items-center gap-2">
                      <Bed className="h-3 w-3" />
                      <span>{unit.roomType}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Home className="h-3 w-3" />
                      <span>{unit.serviceLine}</span>
                    </div>
                    {unit.streetRate && (
                      <div className="font-medium text-primary">
                        ${unit.streetRate.toLocaleString()}/mo
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
      
      {/* Assignment Dialog */}
      <Dialog open={assignmentDialog.open} onOpenChange={(open) => 
        setAssignmentDialog({ open, polygon: null })
      }>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Unit to Room</DialogTitle>
            <DialogDescription>
              Select a unit to assign to {assignmentDialog.polygon?.label}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-96">
            <div className="space-y-2">
              {units.filter(u => !u.assignedPolygonId).map(unit => (
                <Button
                  key={unit.id}
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => {
                    if (assignmentDialog.polygon) {
                      handleDrop(
                        new DragEvent('drop') as any,
                        assignmentDialog.polygon
                      );
                      setAssignmentDialog({ open: false, polygon: null });
                    }
                  }}
                >
                  <span className="mr-2">{unit.roomNumber}</span>
                  <Badge variant="outline" className="ml-auto">
                    {unit.roomType}
                  </Badge>
                </Button>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}