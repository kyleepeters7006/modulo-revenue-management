import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, RotateCcw, Save, Edit3, Trash2, Plus, Pentagon, Circle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface Point {
  x: number;
  y: number;
}

interface UnitShape {
  id: string;
  roomNumber: string;
  type: 'circle' | 'polygon';
  center: Point;
  radius?: number;
  points?: Point[];
  status: 'available' | 'occupied';
  serviceLine: string;
}

interface SimplifiedFloorPlanViewerProps {
  campusMap: any;
  units: any[];
  onUnitClick?: (unitId: string) => void;
}

const DEFAULT_RADIUS = 2.5;
const MIN_RADIUS = 1;
const MAX_RADIUS = 8;

export default function SimplifiedFloorPlanViewer({ 
  campusMap, 
  units = [],
  onUnitClick
}: SimplifiedFloorPlanViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [isEditMode, setIsEditMode] = useState(false);
  const [unitShapes, setUnitShapes] = useState<{[key: string]: UnitShape}>({});
  const [hoveredUnit, setHoveredUnit] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [isAddingMode, setIsAddingMode] = useState(false);
  const [showUnplacedUnits, setShowUnplacedUnits] = useState(false);
  const [lastClickPosition, setLastClickPosition] = useState<Point | null>(null);
  
  const [dragState, setDragState] = useState<{
    type: 'move' | 'resize' | 'vertex' | null;
    unitId: string | null;
    vertexIndex?: number;
    startPos?: Point;
  }>({ type: null, unitId: null });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const unplacedUnits = units.filter(unit => !unitShapes[unit.id]);
  const placedUnits = units.filter(unit => unitShapes[unit.id]);

  useEffect(() => {
    if (units.length > 0 && Object.keys(unitShapes).length === 0) {
      if (campusMap?.svgContent) {
        try {
          const savedData = JSON.parse(campusMap.svgContent);
          if (savedData.type === 'enhanced' && savedData.shapes) {
            setUnitShapes(savedData.shapes);
            return;
          }
          if (savedData.type === 'simplified' && savedData.positions) {
            const shapes: {[key: string]: UnitShape} = {};
            Object.entries(savedData.positions).forEach(([id, pos]: [string, any]) => {
              const unit = units.find(u => u.id === id);
              if (unit) {
                shapes[id] = {
                  id,
                  roomNumber: unit.roomNumber,
                  type: 'circle',
                  center: { x: pos.x, y: pos.y },
                  radius: DEFAULT_RADIUS,
                  status: unit.occupiedYN ? 'occupied' : 'available',
                  serviceLine: unit.serviceLine
                };
              }
            });
            setUnitShapes(shapes);
            return;
          }
        } catch (e) {
        }
      }
      
      const shapes: {[key: string]: UnitShape} = {};
      const cols = Math.ceil(Math.sqrt(units.length));
      const rows = Math.ceil(units.length / cols);
      
      units.forEach((unit, index) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        shapes[unit.id] = {
          id: unit.id,
          roomNumber: unit.roomNumber,
          type: 'circle',
          center: {
            x: (col * 100 / cols) + (50 / cols),
            y: (row * 100 / rows) + (50 / rows)
          },
          radius: DEFAULT_RADIUS,
          status: unit.occupiedYN ? 'occupied' : 'available',
          serviceLine: unit.serviceLine
        };
      });
      
      setUnitShapes(shapes);
    }
  }, [units, unitShapes, campusMap]);

  const handleUnitSelect = (unitId: string) => {
    if (isEditMode && !isAddingMode) {
      setSelectedUnit(selectedUnit === unitId ? null : unitId);
    }
  };

  const handleDeleteUnit = (unitIdToDelete?: string) => {
    const targetId = unitIdToDelete || selectedUnit;
    if (!targetId || !isEditMode) return;
    
    const newShapes = { ...unitShapes };
    delete newShapes[targetId];
    setUnitShapes(newShapes);
    if (selectedUnit === targetId) {
      setSelectedUnit(null);
    }
    
    toast({
      title: "Unit removed",
      description: "Unit marker removed. Click Save to persist changes.",
    });
  };

  const handlePlaceUnit = (unitId: string, x: number, y: number) => {
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;
    
    setUnitShapes(prev => ({
      ...prev,
      [unitId]: {
        id: unitId,
        roomNumber: unit.roomNumber,
        type: 'circle',
        center: { x: Math.max(5, Math.min(95, x)), y: Math.max(5, Math.min(95, y)) },
        radius: DEFAULT_RADIUS,
        status: unit.occupiedYN ? 'occupied' : 'available',
        serviceLine: unit.serviceLine
      }
    }));
    
    toast({
      title: "Unit placed",
      description: `Unit ${unit.roomNumber} placed. Click Save to persist changes.`,
    });
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!isAddingMode || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    setLastClickPosition({ x, y });
    setShowUnplacedUnits(true);
  };

  const getMousePosition = useCallback((e: MouseEvent | TouchEvent): Point | null => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0]?.clientY : e.clientY;
    if (clientX === undefined || clientY === undefined) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100
    };
  }, []);

  const handleDragStart = (unitId: string, type: 'move' | 'resize' | 'vertex', e: React.MouseEvent | React.TouchEvent, vertexIndex?: number) => {
    if (!isEditMode || isAddingMode) return;
    e.preventDefault();
    e.stopPropagation();
    
    const shape = unitShapes[unitId];
    if (!shape) return;
    
    const pos = getMousePosition(e.nativeEvent as MouseEvent);
    
    setDragState({
      type,
      unitId,
      vertexIndex,
      startPos: pos || shape.center
    });
  };

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!dragState.type || !dragState.unitId || !dragState.startPos) return;
    
    const pos = getMousePosition(e);
    if (!pos) return;
    
    const shape = unitShapes[dragState.unitId];
    if (!shape) return;
    
    if (dragState.type === 'move') {
      const dx = pos.x - dragState.startPos.x;
      const dy = pos.y - dragState.startPos.y;
      
      const newCenterX = Math.max(5, Math.min(95, shape.center.x + dx));
      const newCenterY = Math.max(5, Math.min(95, shape.center.y + dy));
      
      if (shape.type === 'polygon' && shape.points) {
        const newPoints = shape.points.map(p => ({
          x: Math.max(0, Math.min(100, p.x + dx)),
          y: Math.max(0, Math.min(100, p.y + dy))
        }));
        
        setUnitShapes(prev => ({
          ...prev,
          [dragState.unitId!]: {
            ...prev[dragState.unitId!],
            center: { x: newCenterX, y: newCenterY },
            points: newPoints
          }
        }));
      } else {
        setUnitShapes(prev => ({
          ...prev,
          [dragState.unitId!]: {
            ...prev[dragState.unitId!],
            center: { x: newCenterX, y: newCenterY }
          }
        }));
      }
      
      setDragState(prev => ({ ...prev, startPos: pos }));
    } else if (dragState.type === 'resize' && shape.type === 'circle') {
      const dx = pos.x - shape.center.x;
      const dy = pos.y - shape.center.y;
      const newRadius = Math.sqrt(dx * dx + dy * dy);
      
      setUnitShapes(prev => ({
        ...prev,
        [dragState.unitId!]: {
          ...prev[dragState.unitId!],
          radius: Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, newRadius))
        }
      }));
    } else if (dragState.type === 'vertex' && shape.type === 'polygon' && shape.points && dragState.vertexIndex !== undefined) {
      const newPoints = [...shape.points];
      newPoints[dragState.vertexIndex] = {
        x: Math.max(0, Math.min(100, pos.x)),
        y: Math.max(0, Math.min(100, pos.y))
      };
      
      setUnitShapes(prev => ({
        ...prev,
        [dragState.unitId!]: {
          ...prev[dragState.unitId!],
          points: newPoints
        }
      }));
    }
  }, [dragState, unitShapes, getMousePosition]);

  const handleDragEnd = useCallback(() => {
    setDragState({ type: null, unitId: null });
  }, []);

  useEffect(() => {
    if (dragState.type) {
      const handleMouseMove = (e: MouseEvent) => handleDragMove(e);
      const handleMouseUp = () => handleDragEnd();
      const handleTouchMove = (e: TouchEvent) => {
        e.preventDefault();
        handleDragMove(e);
      };
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
  }, [dragState.type, handleDragMove, handleDragEnd]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedUnit && isEditMode) {
        e.preventDefault();
        handleDeleteUnit();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedUnit, isEditMode]);

  const convertToPolygon = (unitId: string) => {
    const shape = unitShapes[unitId];
    if (!shape || shape.type !== 'circle') return;
    
    const r = (shape.radius || DEFAULT_RADIUS) * 1.2;
    const cx = shape.center.x;
    const cy = shape.center.y;
    
    const points: Point[] = [
      { x: cx - r, y: cy - r * 0.6 },
      { x: cx + r, y: cy - r * 0.6 },
      { x: cx + r, y: cy + r * 0.6 },
      { x: cx - r, y: cy + r * 0.6 }
    ];
    
    setUnitShapes(prev => ({
      ...prev,
      [unitId]: {
        ...prev[unitId],
        type: 'polygon',
        points,
        radius: undefined
      }
    }));
    
    toast({
      title: "Converted to polygon",
      description: "Drag corners to match the room shape. Right-click edges to add points.",
    });
  };

  const convertToCircle = (unitId: string) => {
    const shape = unitShapes[unitId];
    if (!shape || shape.type !== 'polygon') return;
    
    setUnitShapes(prev => ({
      ...prev,
      [unitId]: {
        ...prev[unitId],
        type: 'circle',
        radius: DEFAULT_RADIUS,
        points: undefined
      }
    }));
    
    toast({
      title: "Converted to circle",
      description: "Drag the edge handle to resize.",
    });
  };

  const addPolygonVertex = (unitId: string, edgeIndex: number, clickPos: Point) => {
    const shape = unitShapes[unitId];
    if (!shape || shape.type !== 'polygon' || !shape.points) return;
    
    const newPoints = [...shape.points];
    newPoints.splice(edgeIndex + 1, 0, clickPos);
    
    setUnitShapes(prev => ({
      ...prev,
      [unitId]: {
        ...prev[unitId],
        points: newPoints
      }
    }));
    
    toast({
      title: "Vertex added",
      description: "Drag the new vertex to position it.",
    });
  };

  const deletePolygonVertex = (unitId: string, vertexIndex: number) => {
    const shape = unitShapes[unitId];
    if (!shape || shape.type !== 'polygon' || !shape.points || shape.points.length <= 3) return;
    
    const newPoints = shape.points.filter((_, i) => i !== vertexIndex);
    
    setUnitShapes(prev => ({
      ...prev,
      [unitId]: {
        ...prev[unitId],
        points: newPoints
      }
    }));
    
    toast({
      title: "Vertex deleted",
      description: "Vertex removed from polygon.",
    });
  };

  const getPolygonCentroid = (points: Point[]): Point => {
    if (!points || points.length === 0) return { x: 50, y: 50 };
    const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
  };

  const handleSavePositions = async () => {
    try {
      const saveData = {
        type: 'enhanced',
        shapes: unitShapes,
        version: 2
      };
      
      await apiRequest('/api/campus-maps/unit-positions', 'POST', {
        campusMapId: campusMap.id,
        positions: saveData
      });
      
      toast({
        title: "Success",
        description: "Floor plan layout saved successfully",
      });
      
      setIsEditMode(false);
      setSelectedUnit(null);
      queryClient.invalidateQueries({ queryKey: [`/api/campus-maps/${campusMap.id}`] });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save floor plan layout",
        variant: "destructive"
      });
    }
  };

  const handleResetPositions = () => {
    const shapes: {[key: string]: UnitShape} = {};
    const cols = Math.ceil(Math.sqrt(units.length));
    const rows = Math.ceil(units.length / cols);
    
    units.forEach((unit, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      shapes[unit.id] = {
        id: unit.id,
        roomNumber: unit.roomNumber,
        type: 'circle',
        center: {
          x: (col * 100 / cols) + (50 / cols),
          y: (row * 100 / rows) + (50 / rows)
        },
        radius: DEFAULT_RADIUS,
        status: unit.occupiedYN ? 'occupied' : 'available',
        serviceLine: unit.serviceLine
      };
    });
    
    setUnitShapes(shapes);
    setSelectedUnit(null);
    
    toast({
      title: "Reset",
      description: "Floor plan reset to grid layout",
    });
  };

  const getUnitColor = (shape: UnitShape) => {
    if (shape.status === 'occupied') return '#94a3b8';
    
    switch(shape.serviceLine) {
      case 'AL':
      case 'AL/MC':
        return '#22c55e';
      case 'HC':
      case 'HC/MC':
        return '#16a34a';
      case 'SL':
      case 'IL':
        return '#15803d';
      default:
        return '#84cc16';
    }
  };

  const renderCircleShape = (shape: UnitShape, unit: any) => {
    const isBeingDragged = dragState.unitId === shape.id;
    const isHovered = hoveredUnit === shape.id;
    const isSelected = selectedUnit === shape.id;
    const radius = shape.radius || DEFAULT_RADIUS;
    const sizePx = radius * 12;
    
    return (
      <ContextMenuTrigger key={shape.id} asChild>
        <div
          className={`absolute transition-all ${
            isEditMode && !isAddingMode ? 'cursor-move' : isEditMode ? 'cursor-not-allowed' : 'cursor-pointer'
          } ${isBeingDragged ? 'z-50' : 'z-10'}`}
          style={{
            left: `${shape.center.x}%`,
            top: `${shape.center.y}%`,
            transform: 'translate(-50%, -50%)',
            transition: isBeingDragged ? 'none' : 'all 0.15s ease-out'
          }}
          onMouseDown={(e) => {
            if (isEditMode && !isAddingMode) {
              handleDragStart(shape.id, 'move', e);
            }
          }}
          onTouchStart={(e) => {
            if (isEditMode && !isAddingMode) {
              handleDragStart(shape.id, 'move', e);
            }
          }}
          onMouseEnter={() => setHoveredUnit(shape.id)}
          onMouseLeave={() => setHoveredUnit(null)}
          onClick={(e) => {
            e.stopPropagation();
            if (isEditMode && !isAddingMode) {
              handleUnitSelect(shape.id);
            } else if (!isEditMode) {
              onUnitClick?.(shape.id);
            }
          }}
          data-testid={`unit-circle-${shape.roomNumber}`}
        >
          <div
            className={`relative flex items-center justify-center rounded-full border-2 ${
              isHovered && !isEditMode ? 'scale-110' : ''
            } ${isBeingDragged ? 'scale-110 shadow-lg' : ''} ${
              isSelected ? 'ring-4 ring-blue-500 ring-offset-2' : ''
            }`}
            style={{
              width: `${sizePx}px`,
              height: `${sizePx}px`,
              minWidth: '24px',
              minHeight: '24px',
              backgroundColor: getUnitColor(shape) + '40',
              borderColor: getUnitColor(shape),
              transition: isBeingDragged ? 'none' : 'all 0.15s ease-out'
            }}
          >
            <span 
              className="font-semibold text-gray-900 text-center leading-tight"
              style={{ fontSize: `${Math.max(8, Math.min(12, sizePx / 3))}px` }}
            >
              {shape.roomNumber}
            </span>
          </div>

          {isEditMode && !isAddingMode && isSelected && (
            <div
              className="absolute w-4 h-4 bg-blue-500 border-2 border-white rounded-full cursor-se-resize shadow-md hover:scale-125 transition-transform"
              style={{
                right: `-${sizePx / 2 + 4}px`,
                top: '50%',
                transform: 'translateY(-50%)'
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleDragStart(shape.id, 'resize', e);
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
                handleDragStart(shape.id, 'resize', e);
              }}
              data-testid={`resize-handle-${shape.roomNumber}`}
            />
          )}

          {isHovered && !isEditMode && (
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none">
              <div className="bg-gray-900 text-white px-3 py-2 rounded-lg shadow-lg whitespace-nowrap text-sm">
                <div className="font-semibold">Unit {shape.roomNumber}</div>
                <div className="text-xs opacity-90">
                  {shape.status === 'occupied' ? 'Occupied' : 'Available'}
                </div>
                <div className="text-xs opacity-90">
                  {shape.serviceLine} - {unit?.size || 'Studio'}
                </div>
              </div>
              <div className="w-2 h-2 bg-gray-900 transform rotate-45 absolute left-1/2 -translate-x-1/2 -bottom-1" />
            </div>
          )}
        </div>
      </ContextMenuTrigger>
    );
  };

  const renderPolygonShape = (shape: UnitShape, unit: any) => {
    if (!shape.points || shape.points.length < 3) return null;
    
    const isBeingDragged = dragState.unitId === shape.id;
    const isHovered = hoveredUnit === shape.id;
    const isSelected = selectedUnit === shape.id;
    const centroid = getPolygonCentroid(shape.points);
    
    const minX = Math.min(...shape.points.map(p => p.x));
    const maxX = Math.max(...shape.points.map(p => p.x));
    const minY = Math.min(...shape.points.map(p => p.y));
    const maxY = Math.max(...shape.points.map(p => p.y));
    
    const pathData = shape.points.map((p, i) => 
      `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
    ).join(' ') + ' Z';
    
    return (
      <ContextMenuTrigger key={shape.id} asChild>
        <g
          className={`${isEditMode && !isAddingMode ? 'cursor-move' : isEditMode ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          onMouseEnter={() => setHoveredUnit(shape.id)}
          onMouseLeave={() => setHoveredUnit(null)}
          onClick={(e) => {
            e.stopPropagation();
            if (isEditMode && !isAddingMode) {
              handleUnitSelect(shape.id);
            } else if (!isEditMode) {
              onUnitClick?.(shape.id);
            }
          }}
          data-testid={`unit-polygon-${shape.roomNumber}`}
        >
          <path
            d={pathData}
            fill={getUnitColor(shape) + '40'}
            stroke={getUnitColor(shape)}
            strokeWidth={isSelected ? 0.4 : 0.25}
            className={`${isHovered && !isEditMode ? 'opacity-80' : ''} ${isSelected ? 'filter drop-shadow-md' : ''}`}
            style={{ transition: 'all 0.15s ease-out' }}
            onMouseDown={(e) => {
              if (isEditMode && !isAddingMode) {
                handleDragStart(shape.id, 'move', e as any);
              }
            }}
          />
          
          <text
            x={centroid.x}
            y={centroid.y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="font-semibold fill-gray-900 pointer-events-none select-none"
            style={{ fontSize: '0.9px' }}
          >
            {shape.roomNumber}
          </text>

          {isEditMode && !isAddingMode && isSelected && shape.points.map((point, index) => (
            <circle
              key={`vertex-${index}`}
              cx={point.x}
              cy={point.y}
              r={0.6}
              fill="#3b82f6"
              stroke="white"
              strokeWidth={0.15}
              className="cursor-pointer hover:scale-150"
              style={{ transition: 'transform 0.1s' }}
              onMouseDown={(e) => {
                e.stopPropagation();
                handleDragStart(shape.id, 'vertex', e as any, index);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (shape.points && shape.points.length > 3) {
                  deletePolygonVertex(shape.id, index);
                }
              }}
              data-testid={`vertex-handle-${shape.roomNumber}-${index}`}
            />
          ))}

          {isEditMode && !isAddingMode && isSelected && shape.points.map((point, index) => {
            const nextPoint = shape.points![(index + 1) % shape.points!.length];
            const midX = (point.x + nextPoint.x) / 2;
            const midY = (point.y + nextPoint.y) / 2;
            
            return (
              <circle
                key={`edge-${index}`}
                cx={midX}
                cy={midY}
                r={0.4}
                fill="#10b981"
                stroke="white"
                strokeWidth={0.1}
                className="cursor-pointer opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  addPolygonVertex(shape.id, index, { x: midX, y: midY });
                }}
                data-testid={`edge-add-${shape.roomNumber}-${index}`}
              />
            );
          })}
        </g>
      </ContextMenuTrigger>
    );
  };

  const renderShape = (shape: UnitShape) => {
    const unit = units.find(u => u.id === shape.id);
    
    if (shape.type === 'circle') {
      return (
        <ContextMenu key={shape.id}>
          {renderCircleShape(shape, unit)}
          <ContextMenuContent>
            {isEditMode && (
              <>
                <ContextMenuItem onClick={() => convertToPolygon(shape.id)}>
                  <Pentagon className="h-4 w-4 mr-2" />
                  Convert to Polygon
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleDeleteUnit(shape.id)} className="text-red-600">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Unit
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
      );
    }
    
    return null;
  };

  const renderPolygonContextMenu = (shape: UnitShape) => {
    const unit = units.find(u => u.id === shape.id);
    
    return (
      <ContextMenu key={shape.id}>
        {renderPolygonShape(shape, unit)}
        <ContextMenuContent>
          {isEditMode && (
            <>
              <ContextMenuItem onClick={() => convertToCircle(shape.id)}>
                <Circle className="h-4 w-4 mr-2" />
                Convert to Circle
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handleDeleteUnit(shape.id)} className="text-red-600">
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Unit
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const circleShapes = Object.values(unitShapes).filter(s => s.type === 'circle');
  const polygonShapes = Object.values(unitShapes).filter(s => s.type === 'polygon');

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
            transition: dragState.type ? 'none' : 'transform 0.2s ease-out'
          }}
          onClick={handleCanvasClick}
        >
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

          {circleShapes.map(shape => renderShape(shape))}

          {polygonShapes.length > 0 && (
            <svg 
              className="absolute inset-0 w-full h-full pointer-events-auto"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{ zIndex: 15 }}
            >
              {polygonShapes.map(shape => renderPolygonContextMenu(shape))}
            </svg>
          )}

          <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg p-3 shadow-md z-20">
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

          {isEditMode && !isAddingMode && (
            <div className="absolute top-4 left-4 bg-yellow-100 border border-yellow-400 rounded-lg px-3 py-2 shadow-md z-20">
              <div className="flex items-center gap-2">
                <Edit3 className="h-4 w-4 text-yellow-700" />
                <span className="text-sm font-medium text-yellow-700">
                  {selectedUnit 
                    ? 'Drag to move. Right-click for options. Press Delete to remove.' 
                    : 'Click a unit to select. Drag to move. Right-click for shape options.'}
                </span>
              </div>
            </div>
          )}

          {isAddingMode && (
            <div className="absolute top-4 left-4 bg-blue-100 border border-blue-400 rounded-lg px-3 py-2 shadow-md z-20">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-blue-700" />
                <span className="text-sm font-medium text-blue-700">
                  Click anywhere to place a unit ({unplacedUnits.length} remaining)
                </span>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Sheet open={showUnplacedUnits} onOpenChange={setShowUnplacedUnits}>
        <SheetContent side="right" className="w-[400px]">
          <SheetHeader>
            <SheetTitle>Select Unit to Place</SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-[calc(100vh-100px)] mt-4">
            <div className="space-y-2 pr-4">
              {unplacedUnits.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">
                  All units have been placed on the floor plan
                </p>
              ) : (
                unplacedUnits.map(unit => (
                  <Card
                    key={unit.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => {
                      const pos = lastClickPosition || { x: 50, y: 50 };
                      handlePlaceUnit(unit.id, pos.x, pos.y);
                      setShowUnplacedUnits(false);
                      setLastClickPosition(null);
                    }}
                    data-testid={`unplaced-unit-${unit.roomNumber}`}
                  >
                    <CardContent className="p-3">
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="font-semibold text-sm">
                            Unit {unit.roomNumber}
                          </div>
                          <div className="text-xs text-gray-600">
                            {unit.serviceLine} - {unit.size || 'Studio'}
                          </div>
                        </div>
                        <div
                          className="w-6 h-6 rounded-full border-2"
                          style={{
                            backgroundColor: getUnitColor({
                              status: unit.occupiedYN ? 'occupied' : 'available',
                              serviceLine: unit.serviceLine
                            } as UnitShape) + '40',
                            borderColor: getUnitColor({
                              status: unit.occupiedYN ? 'occupied' : 'available',
                              serviceLine: unit.serviceLine
                            } as UnitShape)
                          }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
