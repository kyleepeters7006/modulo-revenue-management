import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, RotateCcw, Save, Edit3, Trash2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [isAddingMode, setIsAddingMode] = useState(false);
  const [showUnplacedUnits, setShowUnplacedUnits] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Get unplaced units (units that don't have positions yet)
  const unplacedUnits = units.filter(unit => !unitPositions[unit.id]);
  const placedUnits = units.filter(unit => unitPositions[unit.id]);

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

  const handleUnitSelect = (unitId: string) => {
    if (isEditMode && !isAddingMode) {
      setSelectedUnit(selectedUnit === unitId ? null : unitId);
    }
  };

  const handleDeleteUnit = () => {
    if (!selectedUnit || !isEditMode) return;
    
    const newPositions = { ...unitPositions };
    delete newPositions[selectedUnit];
    setUnitPositions(newPositions);
    setSelectedUnit(null);
    
    toast({
      title: "Unit removed",
      description: "Unit marker removed. Click Save to persist changes.",
    });
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!isAddingMode || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    // Find first unplaced unit to add
    if (unplacedUnits.length > 0) {
      const unitToAdd = unplacedUnits[0];
      setUnitPositions(prev => ({
        ...prev,
        [unitToAdd.id]: {
          x: Math.max(2, Math.min(98, x)),
          y: Math.max(2, Math.min(98, y))
        }
      }));
      
      toast({
        title: "Unit placed",
        description: `Unit ${unitToAdd.roomNumber} placed. Click Save to persist changes.`,
      });
    }
  };

  const handleDragStart = (unitId: string, e: React.MouseEvent | React.TouchEvent) => {
    if (!isEditMode || isAddingMode) return;
    e.preventDefault();
    e.stopPropagation();
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

  // Add keyboard support for Delete key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedUnit && isEditMode) {
        e.preventDefault();
        handleDeleteUnit();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedUnit, isEditMode]);

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
    <>
      <Card className="relative overflow-hidden">
        <div className="absolute top-4 right-4 z-20 flex gap-2 flex-wrap justify-end max-w-md">
          <Button
            onClick={() => setZoom(prev => Math.min(prev + 0.25, 3))}
            size="sm"
            variant="secondary"
            className="shadow-md"
            data-testid="button-zoom-in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => setZoom(prev => Math.max(prev - 0.25, 0.5))}
            size="sm"
            variant="secondary"
            className="shadow-md"
            data-testid="button-zoom-out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            onClick={() => setZoom(1)}
            size="sm"
            variant="secondary"
            className="shadow-md"
            data-testid="button-reset-zoom"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          {!isEditMode ? (
            <Button
              onClick={() => setIsEditMode(true)}
              size="sm"
              variant="secondary"
              className="shadow-md"
              data-testid="button-edit-layout"
            >
              <Edit3 className="h-4 w-4 mr-1" />
              Edit Layout
            </Button>
          ) : (
            <>
              {selectedUnit && (
                <Button
                  onClick={handleDeleteUnit}
                  size="sm"
                  variant="destructive"
                  className="shadow-md"
                  data-testid="button-delete-unit"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              )}
              {unplacedUnits.length > 0 && (
                <Button
                  onClick={() => {
                    setIsAddingMode(!isAddingMode);
                    setSelectedUnit(null);
                  }}
                  size="sm"
                  variant={isAddingMode ? "default" : "secondary"}
                  className="shadow-md"
                  data-testid="button-add-units"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Units ({unplacedUnits.length})
                </Button>
              )}
              <Button
                onClick={handleSavePositions}
                size="sm"
                variant="default"
                className="shadow-md"
                data-testid="button-save-positions"
              >
                <Save className="h-4 w-4 mr-1" />
                Save
              </Button>
              <Button
                onClick={handleResetPositions}
                size="sm"
                variant="secondary"
                className="shadow-md"
                data-testid="button-reset-positions"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset
              </Button>
              <Button
                onClick={() => {
                  setIsEditMode(false);
                  setSelectedUnit(null);
                  setIsAddingMode(false);
                }}
                size="sm"
                variant="outline"
                className="shadow-md"
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
            </>
          )}
        </div>

        <div
          ref={containerRef}
          className={`relative bg-gray-50 h-[600px] overflow-hidden ${
            isAddingMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
          }`}
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'center',
            transition: draggedUnit ? 'none' : 'transform 0.2s ease-out'
          }}
          onClick={handleCanvasClick}
        >
        {/* Floor plan background image or gradient */}
        {campusMap?.baseImageUrl ? (
          <img 
            src={campusMap.baseImageUrl}
            alt="Floor Plan"
            className="absolute inset-0 w-full h-full object-contain"
            style={{ 
              opacity: 0.9,
              pointerEvents: 'none'
            }}
          />
        ) : (
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
        )}

          {/* Unit circles - only render placed units */}
          {placedUnits.map(unit => {
            const position = unitPositions[unit.id];
            if (!position) return null;
            
            const isBeingDragged = draggedUnit === unit.id;
            const isHovered = hoveredUnit === unit.id;
            const isSelected = selectedUnit === unit.id;

            return (
              <div
                key={unit.id}
                className={`absolute transition-all ${
                  isEditMode && !isAddingMode ? 'cursor-move' : isEditMode ? 'cursor-not-allowed' : 'cursor-pointer'
                } ${isBeingDragged ? 'z-50' : 'z-10'}`}
                style={{
                  left: `${position.x}%`,
                  top: `${position.y}%`,
                  transform: 'translate(-50%, -50%)',
                  transition: isBeingDragged ? 'none' : 'all 0.2s ease-out'
                }}
                onMouseDown={(e) => {
                  if (isEditMode && !isAddingMode) {
                    handleDragStart(unit.id, e);
                  }
                }}
                onTouchStart={(e) => {
                  if (isEditMode && !isAddingMode) {
                    handleDragStart(unit.id, e);
                  }
                }}
                onMouseEnter={() => setHoveredUnit(unit.id)}
                onMouseLeave={() => setHoveredUnit(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isEditMode && !isAddingMode) {
                    handleUnitSelect(unit.id);
                  } else if (!isEditMode) {
                    onUnitClick?.(unit.id);
                  }
                }}
                data-testid={`unit-circle-${unit.roomNumber}`}
              >
                {/* Circle with unit number */}
                <div
                  className={`relative flex items-center justify-center rounded-full border-2 ${
                    isHovered ? 'scale-110' : ''
                  } ${isBeingDragged ? 'scale-125 shadow-lg' : ''} ${
                    isSelected ? 'ring-4 ring-blue-500' : ''
                  }`}
                  style={{
                    width: '30px',
                    height: '30px',
                    backgroundColor: getUnitColor(unit) + '40', // 40 = 25% opacity
                    borderColor: getUnitColor(unit),
                    transition: isBeingDragged ? 'none' : 'all 0.2s ease-out'
                  }}
                >
                  <span className="font-semibold text-[10px] text-gray-900">
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
          {isEditMode && !isAddingMode && (
            <div className="absolute top-4 left-4 bg-yellow-100 border border-yellow-400 rounded-lg px-3 py-2 shadow-md">
              <div className="flex items-center gap-2">
                <Edit3 className="h-4 w-4 text-yellow-700" />
                <span className="text-sm font-medium text-yellow-700">
                  {selectedUnit ? 'Click Delete or press Delete key to remove unit' : 'Drag units to reposition them'}
                </span>
              </div>
            </div>
          )}

          {/* Adding mode indicator */}
          {isAddingMode && (
            <div className="absolute top-4 left-4 bg-blue-100 border border-blue-400 rounded-lg px-3 py-2 shadow-md">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-blue-700" />
                <span className="text-sm font-medium text-blue-700">
                  Click anywhere to place next unit ({unplacedUnits.length} remaining)
                </span>
              </div>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}