import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, RotateCcw, Save, Edit3, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface DraggableUnit {
  id: string;
  roomNumber: string;
  x: number; // percentage position (0-100)
  y: number; // percentage position (0-100)
  occupied: boolean;
  serviceLine: string;
}

interface SimplifiedFloorPlanViewerProps {
  campusMap: any;
  units: any[];
  onUnitClick?: (unitId: string) => void;
}

export default function SimplifiedFloorPlanViewer({ 
  campusMap, 
  units = [],
  onUnitClick
}: SimplifiedFloorPlanViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [isEditMode, setIsEditMode] = useState(false);
  const [draggedUnit, setDraggedUnit] = useState<string | null>(null);
  const [unitPositions, setUnitPositions] = useState<{[key: string]: {x: number, y: number}}>({});
  const [hoveredUnit, setHoveredUnit] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Initialize unit positions - try to load saved positions first
  useEffect(() => {
    if (units.length > 0 && Object.keys(unitPositions).length === 0) {
      // Check if campusMap has saved positions
      if (campusMap?.svgContent) {
        try {
          const savedData = JSON.parse(campusMap.svgContent);
          if (savedData.type === 'simplified' && savedData.positions) {
            setUnitPositions(savedData.positions);
            return;
          }
        } catch (e) {
          // Not JSON or different format, use default grid
        }
      }
      
      // Default grid layout if no saved positions
      const positions: {[key: string]: {x: number, y: number}} = {};
      const cols = Math.ceil(Math.sqrt(units.length));
      const rows = Math.ceil(units.length / cols);
      
      units.forEach((unit, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        positions[unit.id] = {
          x: (col * 100 / cols) + (50 / cols), // Center in column
          y: (row * 100 / rows) + (50 / rows)  // Center in row
        };
      });
      
      setUnitPositions(positions);
    }
  }, [units, unitPositions, campusMap]);

  const handleDragStart = (unitId: string, e: React.MouseEvent | React.TouchEvent) => {
    if (!isEditMode) return;
    e.preventDefault();
    setDraggedUnit(unitId);
  };

  const handleDragMove = (e: MouseEvent | TouchEvent) => {
    if (!draggedUnit || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    
    setUnitPositions(prev => ({
      ...prev,
      [draggedUnit]: { 
        x: Math.max(2, Math.min(98, x)), 
        y: Math.max(2, Math.min(98, y)) 
      }
    }));
  };

  const handleDragEnd = () => {
    setDraggedUnit(null);
  };

  // Add event listeners for drag
  useEffect(() => {
    if (draggedUnit) {
      const handleMouseMove = (e: MouseEvent) => handleDragMove(e);
      const handleMouseUp = () => handleDragEnd();
      const handleTouchMove = (e: TouchEvent) => handleDragMove(e);
      const handleTouchEnd = () => handleDragEnd();
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
      
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };
    }
  }, [draggedUnit]);

  const handleSavePositions = async () => {
    try {
      // Save positions to backend
      await apiRequest('/api/campus-maps/unit-positions', 'POST', {
        campusMapId: campusMap.id,
        positions: unitPositions
      });
      
      toast({
        title: "Success",
        description: "Unit positions saved successfully",
      });
      
      setIsEditMode(false);
      queryClient.invalidateQueries({ queryKey: [`/api/campus-maps/${campusMap.id}`] });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save unit positions",
        variant: "destructive"
      });
    }
  };

  const handleResetPositions = () => {
    const positions: {[key: string]: {x: number, y: number}} = {};
    const cols = Math.ceil(Math.sqrt(units.length));
    const rows = Math.ceil(units.length / cols);
    
    units.forEach((unit, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      positions[unit.id] = {
        x: (col * 100 / cols) + (50 / cols),
        y: (row * 100 / rows) + (50 / rows)
      };
    });
    
    setUnitPositions(positions);
    
    toast({
      title: "Reset",
      description: "Unit positions reset to grid layout",
    });
  };

  const getUnitColor = (unit: any) => {
    if (unit.occupiedYN) return '#94a3b8'; // Gray for occupied
    
    // Green shades based on service line
    switch(unit.serviceLine) {
      case 'AL':
      case 'AL/MC':
        return '#22c55e'; // Bright green
      case 'HC':
      case 'HC/MC':
        return '#16a34a'; // Medium green  
      case 'SL':
      case 'IL':
        return '#15803d'; // Dark green
      default:
        return '#84cc16'; // Light green
    }
  };

  return (
    <Card className="relative overflow-hidden">
      <div className="absolute top-4 right-4 z-20 flex gap-2">
        <Button
          onClick={() => setZoom(prev => Math.min(prev + 0.25, 3))}
          size="sm"
          variant="secondary"
          className="shadow-md"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          onClick={() => setZoom(prev => Math.max(prev - 0.25, 0.5))}
          size="sm"
          variant="secondary"
          className="shadow-md"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          onClick={() => setZoom(1)}
          size="sm"
          variant="secondary"
          className="shadow-md"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        {!isEditMode ? (
          <Button
            onClick={() => setIsEditMode(true)}
            size="sm"
            variant="secondary"
            className="shadow-md"
          >
            <Edit3 className="h-4 w-4 mr-1" />
            Edit Layout
          </Button>
        ) : (
          <>
            <Button
              onClick={handleSavePositions}
              size="sm"
              variant="default"
              className="shadow-md"
            >
              <Save className="h-4 w-4 mr-1" />
              Save
            </Button>
            <Button
              onClick={handleResetPositions}
              size="sm"
              variant="secondary"
              className="shadow-md"
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset
            </Button>
            <Button
              onClick={() => setIsEditMode(false)}
              size="sm"
              variant="outline"
              className="shadow-md"
            >
              Cancel
            </Button>
          </>
        )}
      </div>

      <div
        ref={containerRef}
        className="relative bg-gray-50 h-[600px] cursor-grab active:cursor-grabbing overflow-hidden"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: 'center',
          transition: draggedUnit ? 'none' : 'transform 0.2s ease-out'
        }}
      >
        {/* Simple gradient background to represent the floor plan */}
        <div 
          className="absolute inset-0 bg-gradient-to-br from-slate-100 via-gray-100 to-stone-100"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0, 0, 0, 0.03) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0, 0, 0, 0.03) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px'
          }}
        />

        {/* Unit circles */}
        {units.map(unit => {
          const position = unitPositions[unit.id] || { x: 50, y: 50 };
          const isBeingDragged = draggedUnit === unit.id;
          const isHovered = hoveredUnit === unit.id;

          return (
            <div
              key={unit.id}
              className={`absolute transition-all ${
                isEditMode ? 'cursor-move' : 'cursor-pointer'
              } ${isBeingDragged ? 'z-50' : 'z-10'}`}
              style={{
                left: `${position.x}%`,
                top: `${position.y}%`,
                transform: 'translate(-50%, -50%)',
                transition: isBeingDragged ? 'none' : 'all 0.2s ease-out'
              }}
              onMouseDown={(e) => handleDragStart(unit.id, e)}
              onTouchStart={(e) => handleDragStart(unit.id, e)}
              onMouseEnter={() => setHoveredUnit(unit.id)}
              onMouseLeave={() => setHoveredUnit(null)}
              onClick={() => !isEditMode && onUnitClick?.(unit.id)}
            >
              {/* Circle with unit number */}
              <div
                className={`relative flex items-center justify-center rounded-full border-2 ${
                  isHovered ? 'scale-110' : ''
                } ${isBeingDragged ? 'scale-125 shadow-lg' : ''}`}
                style={{
                  width: '50px',
                  height: '50px',
                  backgroundColor: getUnitColor(unit) + '40', // 40 = 25% opacity
                  borderColor: getUnitColor(unit),
                  transition: isBeingDragged ? 'none' : 'all 0.2s ease-out'
                }}
              >
                <span className="font-semibold text-xs text-gray-900">
                  {unit.roomNumber}
                </span>
              </div>

              {/* Tooltip on hover */}
              {isHovered && !isEditMode && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none">
                  <div className="bg-gray-900 text-white px-3 py-2 rounded-lg shadow-lg whitespace-nowrap text-sm">
                    <div className="font-semibold">Unit {unit.roomNumber}</div>
                    <div className="text-xs opacity-90">
                      {unit.occupiedYN ? 'Occupied' : 'Available'}
                    </div>
                    <div className="text-xs opacity-90">
                      {unit.serviceLine} - {unit.size || 'Studio'}
                    </div>
                  </div>
                  <div className="w-2 h-2 bg-gray-900 transform rotate-45 absolute left-1/2 -translate-x-1/2 -bottom-1" />
                </div>
              )}
            </div>
          );
        })}

        {/* Legend */}
        <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg p-3 shadow-md">
          <div className="text-xs font-semibold mb-2">Unit Status</div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-green-500/40 border border-green-500" />
              <span className="text-xs">Available</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-gray-400/40 border border-gray-400" />
              <span className="text-xs">Occupied</span>
            </div>
          </div>
        </div>

        {/* Edit mode indicator */}
        {isEditMode && (
          <div className="absolute top-4 left-4 bg-yellow-100 border border-yellow-400 rounded-lg px-3 py-2 shadow-md">
            <div className="flex items-center gap-2">
              <Edit3 className="h-4 w-4 text-yellow-700" />
              <span className="text-sm font-medium text-yellow-700">
                Drag units to reposition them
              </span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}