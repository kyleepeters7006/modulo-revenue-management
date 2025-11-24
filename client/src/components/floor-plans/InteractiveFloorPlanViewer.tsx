import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ZoomIn, ZoomOut, Maximize2, Edit3, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface InteractiveFloorPlanViewerProps {
  campusMap: any;
  units?: any[];
  highlightedUnitId?: string | null;
  selectedUnitId?: string | null;
  onUnitClick?: (unitId: string) => void;
}

interface UnitDetails {
  roomNumber: string;
  roomType: string;
  streetRate?: number;
  occupiedYN: boolean;
  daysVacant: number;
  moduloSuggestedRate?: number;
  rentAndCareRate?: number;
  size: string;
  serviceLine?: string;
}

interface UnitPolygon {
  id: string;
  label: string;
  polygonCoordinates: string;
  fillColor: string;
  rentRollDataId: string;
}

export default function InteractiveFloorPlanViewer({ 
  campusMap,
  units = [],
  highlightedUnitId: propHighlightedUnitId,
  selectedUnitId: propSelectedUnitId,
  onUnitClick: propOnUnitClick
}: InteractiveFloorPlanViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [editMode, setEditMode] = useState(false);
  const [editingUnit, setEditingUnit] = useState<any | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});
  const [draggingPolygonId, setDraggingPolygonId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [tempPolygonPosition, setTempPolygonPosition] = useState<{[key: string]: {x: number, y: number}}>({});
  const [showBookingDialog, setShowBookingDialog] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(propSelectedUnitId || null);
  const isDraggingRef = useRef(false);
  const draggingPolygonIdRef = useRef<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const tempPolygonPositionRef = useRef<{[key: string]: {x: number, y: number}}>({});
  const svgElementRef = useRef<SVGSVGElement | null>(null);
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const lastTouchDistance = useRef<number | null>(null);
  const { toast } = useToast();

  // Fetch unit polygons for this map
  const { data: polygons = [] } = useQuery<UnitPolygon[]>({
    queryKey: [`/api/unit-polygons/map/${campusMap.id}`],
    enabled: !!campusMap.id,
  });

  // Fetch all units for this campus to determine occupancy colors
  const { data: allUnitsData } = useQuery<any[]>({
    queryKey: [`/api/rent-roll-data/location/${campusMap.locationId}`],
    enabled: !!campusMap.locationId,
  });
  
  const allUnits = allUnitsData || [];

  // Fetch unit details when hovering (disabled during drag)
  const { data: hoveredUnit } = useQuery<UnitDetails>({
    queryKey: [`/api/rent-roll-data/${hoveredUnitId}`],
    enabled: !!hoveredUnitId && !isDraggingRef.current,
  });

  // Fetch unit details for booking dialog
  const { data: selectedUnit } = useQuery<UnitDetails>({
    queryKey: [`/api/rent-roll-data/${selectedUnitId}`],
    enabled: !!selectedUnitId,
  });

  // Close edit dialog when edit mode is disabled
  useEffect(() => {
    if (!editMode && editingUnit) {
      setEditingUnit(null);
    }
  }, [editMode, editingUnit]);

  // Cleanup window listeners on unmount
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, []);

  // Handle pinch zoom
  useEffect(() => {
    const container = svgContainerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const distance = Math.hypot(
          touch2.clientX - touch1.clientX,
          touch2.clientY - touch1.clientY
        );
        lastTouchDistance.current = distance;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && lastTouchDistance.current) {
        e.preventDefault();
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const distance = Math.hypot(
          touch2.clientX - touch1.clientX,
          touch2.clientY - touch1.clientY
        );
        
        const scale = distance / lastTouchDistance.current;
        setZoom(prevZoom => {
          const newZoom = prevZoom * scale;
          return Math.min(Math.max(newZoom, 0.5), 3);
        });
        
        lastTouchDistance.current = distance;
      }
    };

    const handleTouchEnd = () => {
      lastTouchDistance.current = null;
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 0.25, 0.5));
  };

  const handleResetZoom = () => {
    setZoom(1);
  };

  const handlePolygonHover = (unitId: string, event: React.MouseEvent) => {
    setHoveredUnitId(unitId);
    const rect = svgContainerRef.current?.getBoundingClientRect();
    if (rect) {
      // Calculate position with smart viewport bounds checking
      const tooltipWidth = 280; // Slightly larger than minWidth to account for padding
      const tooltipHeight = 150; // Approximate height
      const offset = 15;
      
      let x = event.clientX - rect.left + offset;
      let y = event.clientY - rect.top + offset;
      
      // Check right edge - if tooltip would go off-screen, position it to the left of cursor
      if (x + tooltipWidth > rect.width) {
        x = event.clientX - rect.left - tooltipWidth - offset;
      }
      
      // Check bottom edge - if tooltip would go off-screen, position it above cursor
      if (y + tooltipHeight > rect.height) {
        y = event.clientY - rect.top - tooltipHeight - offset;
      }
      
      // Ensure tooltip doesn't go off left edge
      if (x < 0) {
        x = offset;
      }
      
      // Ensure tooltip doesn't go off top edge
      if (y < 0) {
        y = offset;
      }
      
      setTooltipPosition({ x, y });
    }
  };

  const handlePolygonLeave = () => {
    setHoveredUnitId(null);
  };

  const handlePolygonClick = async (rentRollDataId: string) => {
    if (draggingPolygonId) return;
    
    // Call parent callback if provided
    if (propOnUnitClick) {
      propOnUnitClick(rentRollDataId);
    }
    
    // In edit mode: open edit form
    if (editMode) {
      try {
        const unit: any = await apiRequest(`/api/rent-roll-data/${rentRollDataId}`, 'GET');
        setEditingUnit(unit);
        setEditFormData({
          streetRate: unit.streetRate,
          occupiedYN: unit.occupiedYN ? 'yes' : 'no',
        });
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to load unit details",
          variant: "destructive",
        });
      }
    } else if (!propOnUnitClick) {
      // Only show booking dialog if no parent click handler provided
      setSelectedUnitId(rentRollDataId);
      setShowBookingDialog(true);
    }
  };

  const handlePolygonMouseDown = (polygon: UnitPolygon, event: React.MouseEvent) => {
    if (!editMode) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    const svgElement = (event.currentTarget as SVGElement).ownerSVGElement;
    if (!svgElement) return;
    
    // Store SVG element ref for window listeners
    svgElementRef.current = svgElement;
    
    const pt = svgElement.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const svgP = pt.matrixTransform(svgElement.getScreenCTM()?.inverse());
    
    const coordinates = JSON.parse(polygon.polygonCoordinates);
    const centerX = coordinates.reduce((sum: number, coord: number[]) => sum + coord[0], 0) / coordinates.length;
    const centerY = coordinates.reduce((sum: number, coord: number[]) => sum + coord[1], 0) / coordinates.length;
    
    const offset = {
      x: svgP.x - centerX,
      y: svgP.y - centerY
    };
    
    setDragOffset(offset);
    dragOffsetRef.current = offset;
    
    setDraggingPolygonId(polygon.id);
    draggingPolygonIdRef.current = polygon.id;
    isDraggingRef.current = true;
    
    // Clear tooltip immediately when drag starts
    setHoveredUnitId(null);
    
    // Add window listeners for smooth tracking
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  };

  // Window-level mouse move handler for smooth tracking (uses refs to avoid stale closures)
  const handleWindowMouseMove = (event: MouseEvent) => {
    if (!draggingPolygonIdRef.current || !editMode || !svgElementRef.current) return;
    
    const pt = svgElementRef.current.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const svgP = pt.matrixTransform(svgElementRef.current.getScreenCTM()?.inverse());
    
    const newPos = {
      x: svgP.x - dragOffsetRef.current.x,
      y: svgP.y - dragOffsetRef.current.y
    };
    
    // Update both state and ref
    tempPolygonPositionRef.current = {
      ...tempPolygonPositionRef.current,
      [draggingPolygonIdRef.current]: newPos
    };
    
    setTempPolygonPosition(tempPolygonPositionRef.current);
  };

  const handleMouseMove = (event: React.MouseEvent) => {
    if (!draggingPolygonId || !editMode) return;
    
    const svgElement = (event.target as SVGElement).ownerSVGElement;
    if (!svgElement) return;
    
    const pt = svgElement.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const svgP = pt.matrixTransform(svgElement.getScreenCTM()?.inverse());
    
    setTempPolygonPosition({
      ...tempPolygonPosition,
      [draggingPolygonId]: {
        x: svgP.x - dragOffset.x,
        y: svgP.y - dragOffset.y
      }
    });
  };

  // Window-level mouse up handler to finish drag and clean up (uses refs to avoid stale closures)
  const handleWindowMouseUp = async () => {
    try {
      if (!draggingPolygonIdRef.current || !editMode) return;
      
      const newPosition = tempPolygonPositionRef.current[draggingPolygonIdRef.current];
      if (!newPosition) return;
      
      const polygon = polygons.find((p: any) => p.id === draggingPolygonIdRef.current);
      if (!polygon) return;
      
      const coordinates = JSON.parse(polygon.polygonCoordinates);
      const centerX = coordinates.reduce((sum: number, coord: number[]) => sum + coord[0], 0) / coordinates.length;
      const centerY = coordinates.reduce((sum: number, coord: number[]) => sum + coord[1], 0) / coordinates.length;
      
      const deltaX = newPosition.x - centerX;
      const deltaY = newPosition.y - centerY;
      
      const newCoordinates = coordinates.map((coord: number[]) => [
        coord[0] + deltaX,
        coord[1] + deltaY
      ]);
      
      // Use ref value for API call
      await apiRequest(`/api/unit-polygons/${draggingPolygonIdRef.current}`, 'PATCH', {
        polygonCoordinates: JSON.stringify(newCoordinates)
      });
      
      queryClient.invalidateQueries({
        queryKey: [`/api/unit-polygons/map/${campusMap.id}`]
      });
      
      toast({
        title: "Success",
        description: `Room ${polygon.label} repositioned successfully`,
      });
      
      setTempPolygonPosition({});
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update polygon position",
        variant: "destructive",
      });
    } finally {
      // Always clean up drag state and listeners
      setDraggingPolygonId(null);
      setTempPolygonPosition({});
      draggingPolygonIdRef.current = null;
      tempPolygonPositionRef.current = {};
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    }
  };

  const handleMouseUp = async () => {
    // Delegate to window handler for consistency
    await handleWindowMouseUp();
  };

  const handleSaveEdit = async () => {
    if (!editingUnit) return;

    // Validate rate
    const rate = parseFloat(editFormData.streetRate);
    if (isNaN(rate) || rate <= 0) {
      toast({
        title: "Validation Error",
        description: "Please enter a valid positive monthly rate",
        variant: "destructive",
      });
      return;
    }

    try {
      await apiRequest(`/api/rent-roll-data/${editingUnit.id}`, 'PATCH', {
        streetRate: rate,
        occupiedYN: editFormData.occupiedYN === 'yes',
      });

      // Invalidate all rent-roll-data queries to refresh all views
      // Use predicate to match both string and array query keys
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key: unknown = query.queryKey;
          if (typeof key === 'string') {
            return key.includes('/api/rent-roll-data');
          }
          if (Array.isArray(key)) {
            return key.some((k: unknown) => typeof k === 'string' && k.includes('/api/rent-roll-data'));
          }
          return false;
        },
      });

      toast({
        title: "Success",
        description: `Unit ${editingUnit.roomNumber} updated successfully`,
      });

      setEditingUnit(null);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update unit",
        variant: "destructive",
      });
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Get unique room types for legend
  const roomTypeLegend = Array.from(
    new Set(polygons.map((p: any) => {
      const unitId = p.rentRollDataId;
      const parts = unitId.split('-');
      return parts[parts.length - 2]; // Get room type from unit ID
    }))
  );

  const getLegendColor = (type: string) => {
    const colors: Record<string, string> = {
      'Studio': '#93c5fd',
      '1BR': '#fde047',
      '2BR': '#fca5a5',
      'SP': '#86efac',
    };
    return colors[type] || '#d1d5db';
  };

  const getLegendLabel = (type: string) => {
    const labels: Record<string, string> = {
      'Studio': 'Studio',
      '1BR': 'One Bedroom',
      '2BR': 'Two Bedroom',
      'SP': 'Semi-Private',
    };
    return labels[type] || type;
  };

  // Get color based on care level and occupancy status
  const getOccupancyColor = (rentRollDataId: string): string => {
    // First check in passed units (from filters)
    const unit = units.find((u: any) => u.id === rentRollDataId) || 
                 allUnits.find((u: any) => u.id === rentRollDataId);
    if (!unit) return '#9ca3af'; // Grey default
    
    // Check if this unit is highlighted or selected
    if (rentRollDataId === propHighlightedUnitId || rentRollDataId === propSelectedUnitId) {
      return '#fbbf24'; // Amber color for highlighted/selected
    }
    
    // If care-level based coloring is desired (when units are passed)
    if (units.length > 0 && unit.serviceLine) {
      const isVacant = !unit.occupiedYN || unit.occupiedYn?.toLowerCase() !== 'y';
      // Use care level colors with different opacity for occupied/vacant
      switch(unit.serviceLine) {
        case 'IL': return isVacant ? '#60a5fa' : '#94a3b8'; // Blue variants
        case 'AL': return isVacant ? '#4ade80' : '#94a3b8'; // Green variants
        case 'AL/MC': return isVacant ? '#c084fc' : '#94a3b8'; // Purple variants
        case 'HC': return isVacant ? '#fb923c' : '#94a3b8'; // Orange variants
        case 'HC/MC': return isVacant ? '#f87171' : '#94a3b8'; // Red variants
        case 'SL': return isVacant ? '#2dd4bf' : '#94a3b8'; // Teal variants
        default: return isVacant ? '#6bcf7f' : '#9ca3af'; // Default green/grey
      }
    }
    
    // Fallback to simple occupancy colors
    return unit.occupiedYN ? '#9ca3af' : '#6bcf7f';
  };

  return (
    <div className="h-full w-full flex flex-col bg-slate-50">
      {/* Floor Plan */}
      <div className="flex-1 bg-white p-4 overflow-auto relative">
        <div 
          ref={svgContainerRef}
          style={{ 
            touchAction: 'pan-x pan-y pinch-zoom',
            transform: `scale(${zoom})`,
            transformOrigin: 'top center',
            transition: 'transform 0.2s ease-out',
          }}
        >
          {campusMap ? (
            <div className="relative w-full" style={{ minHeight: '600px' }}>
              {/* Base aerial image layer */}
              {campusMap.baseImageUrl && (
                <img
                  src={campusMap.baseImageUrl}
                  alt={campusMap.name}
                  className="absolute top-0 left-0 w-full h-auto"
                  style={{
                    display: 'block',
                    maxHeight: '800px',
                    objectFit: 'contain',
                  }}
                />
              )}
              
              {/* SVG content layer for demo floor plans */}
              {campusMap.svgContent && !campusMap.baseImageUrl && (
                <div 
                  dangerouslySetInnerHTML={{ __html: campusMap.svgContent }}
                  className="w-full h-auto"
                  style={{
                    maxHeight: '800px',
                  }}
                />
              )}
              
              {/* SVG overlay layer for interactive polygons */}
              <svg
                viewBox={`0 0 ${campusMap.width || 1920} ${campusMap.height || 1080}`}
                className="absolute top-0 left-0 w-full h-auto"
                style={{
                  maxHeight: '800px',
                  pointerEvents: 'none',
                }}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
              >
                {/* Interactive polygon overlays */}
                {polygons.map((polygon: any) => {
                  let coordinates = JSON.parse(polygon.polygonCoordinates);
                  
                  // Apply temporary position if dragging this polygon
                  if (draggingPolygonId === polygon.id && tempPolygonPosition[polygon.id]) {
                    const centerX = coordinates.reduce((sum: number, coord: number[]) => sum + coord[0], 0) / coordinates.length;
                    const centerY = coordinates.reduce((sum: number, coord: number[]) => sum + coord[1], 0) / coordinates.length;
                    const newPos = tempPolygonPosition[polygon.id];
                    const deltaX = newPos.x - centerX;
                    const deltaY = newPos.y - centerY;
                    coordinates = coordinates.map((coord: number[]) => [coord[0] + deltaX, coord[1] + deltaY]);
                  }
                  
                  const points = coordinates.map((coord: number[]) => coord.join(',')).join(' ');
                  const isDragging = draggingPolygonId === polygon.id;
                  
                  return (
                    <polygon
                      key={polygon.id}
                      points={points}
                      fill={getOccupancyColor(polygon.rentRollDataId)}
                      fillOpacity={isDragging ? 0.9 : (hoveredUnitId === polygon.rentRollDataId ? 0.9 : 0.7)}
                      stroke="none"
                      strokeWidth="0"
                      className={`transition-all ${editMode ? 'cursor-move' : 'cursor-pointer'} ${isDragging ? '' : 'hover:fill-opacity-90'}`}
                      style={{ pointerEvents: 'auto' }}
                      onMouseDown={(e) => handlePolygonMouseDown(polygon, e)}
                      onMouseEnter={(e) => !isDragging && handlePolygonHover(polygon.rentRollDataId, e)}
                      onMouseMove={(e) => {
                        if (isDragging) return;
                        const rect = svgContainerRef.current?.getBoundingClientRect();
                        if (rect && hoveredUnitId === polygon.rentRollDataId) {
                          // Smart positioning to keep tooltip in viewport
                          const tooltipWidth = 280;
                          const tooltipHeight = 150;
                          const offset = 15;
                          
                          let x = e.clientX - rect.left + offset;
                          let y = e.clientY - rect.top + offset;
                          
                          if (x + tooltipWidth > rect.width) {
                            x = e.clientX - rect.left - tooltipWidth - offset;
                          }
                          if (y + tooltipHeight > rect.height) {
                            y = e.clientY - rect.top - tooltipHeight - offset;
                          }
                          if (x < 0) x = offset;
                          if (y < 0) y = offset;
                          
                          setTooltipPosition({ x, y });
                        }
                      }}
                      onMouseLeave={() => !isDragging && handlePolygonLeave()}
                      onClick={() => !isDragging && handlePolygonClick(polygon.rentRollDataId)}
                      data-testid={`polygon-unit-${polygon.label}`}
                    />
                  );
                })}
              </svg>
            </div>
          ) : (
            <div className="flex items-center justify-center h-96 bg-slate-100 rounded-lg">
              <p className="text-slate-500">No floor plan available</p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          {/* Book Now Button - Customer Facing */}
          <div className="bg-white/90 rounded-lg shadow-md">
            <Button 
              variant="default"
              size="lg" 
              onClick={() => setShowBookingDialog(true)}
              data-testid="button-book-now"
              className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white font-semibold px-6"
            >
              Book Now
            </Button>
          </div>

          {/* Edit Mode Toggle */}
          <div className="bg-white/90 rounded-lg p-1 shadow-md">
            <Button 
              variant={editMode ? "default" : "ghost"}
              size="sm" 
              onClick={() => setEditMode(!editMode)}
              data-testid="button-edit-mode"
              className={`h-10 w-10 p-0 ${editMode ? 'bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white' : ''}`}
              title={editMode ? "Exit Edit Mode" : "Enter Edit Mode"}
            >
              {editMode ? <X className="h-5 w-5" /> : <Edit3 className="h-5 w-5" />}
            </Button>
          </div>

          {/* Zoom Controls */}
          <div className="bg-white/90 rounded-lg p-1 shadow-md">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleZoomIn}
              disabled={zoom >= 3}
              data-testid="button-zoom-in"
              className="h-8 w-8 p-0"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleResetZoom}
              data-testid="button-reset-zoom"
              className="h-8 w-8 p-0"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
              data-testid="button-zoom-out"
              className="h-8 w-8 p-0"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Edit Mode Indicator */}
        {editMode && (
          <div className="absolute top-4 left-4 bg-[var(--trilogy-teal)] text-white px-4 py-2 rounded-lg shadow-md">
            <div className="flex items-center gap-2">
              <Edit3 className="h-4 w-4" />
              <span className="font-medium">Edit Mode Active</span>
              <span className="text-sm opacity-90">• Drag rooms to reposition • Click to edit details</span>
            </div>
          </div>
        )}

          {/* Tooltip - hidden during drag */}
          {hoveredUnit && hoveredUnitId && !isDraggingRef.current && (
            <div
              className="absolute bg-white shadow-xl rounded-lg border p-4 z-50 pointer-events-auto"
              style={{
                left: `${tooltipPosition.x + 15}px`,
                top: `${tooltipPosition.y + 15}px`,
                minWidth: '260px',
              }}
              data-testid="unit-tooltip"
              onMouseEnter={() => setHoveredUnitId(hoveredUnitId)}
              onMouseLeave={() => setHoveredUnitId(null)}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between border-b pb-2">
                  <h4 className="font-semibold text-base">Unit {hoveredUnit.roomNumber}</h4>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    hoveredUnit.occupiedYN 
                      ? 'bg-red-100 text-red-700' 
                      : 'bg-green-100 text-green-700'
                  }`}>
                    {hoveredUnit.occupiedYN ? 'Occupied' : 'Available'}
                  </span>
                </div>

                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Type:</span>
                    <span className="font-medium text-slate-900">{hoveredUnit.roomType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Current Rate:</span>
                    <span className="font-semibold text-[var(--trilogy-teal)]">
                      {formatCurrency(hoveredUnit.streetRate || 0)}
                    </span>
                  </div>
                  {!hoveredUnit.occupiedYN && hoveredUnit.daysVacant > 0 && (
                    <div className="flex justify-between pt-1 border-t">
                      <span className="text-slate-600">Days Vacant:</span>
                      <span className={`font-medium ${
                        hoveredUnit.daysVacant > 30 ? 'text-red-600' : 'text-amber-600'
                      }`}>
                        {hoveredUnit.daysVacant} days
                      </span>
                    </div>
                  )}
                </div>

                {/* Book Now button - only show in view mode */}
                {!editMode && (
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedUnitId(hoveredUnitId);
                      setShowBookingDialog(true);
                      setHoveredUnitId(null);
                    }}
                    className="w-full mt-2 bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white font-semibold"
                    size="sm"
                    data-testid="button-book-now-tooltip"
                  >
                    {hoveredUnit.occupiedYN ? 'Join Waitlist' : 'Book Now'}
                  </Button>
                )}
              </div>
            </div>
          )}
      </div>

      {/* Legend - Bottom - Customer Facing Occupancy Status */}
      <div className="bg-white border-t px-6 py-3">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <div 
              className="w-5 h-5 rounded border border-slate-300"
              style={{ backgroundColor: '#6bcf7f' }}
            />
            <span className="text-sm text-slate-700 font-medium">Available</span>
          </div>
          <div className="flex items-center gap-2">
            <div 
              className="w-5 h-5 rounded border border-slate-300"
              style={{ backgroundColor: '#9ca3af' }}
            />
            <span className="text-sm text-slate-700 font-medium">Reserved</span>
          </div>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editingUnit} onOpenChange={(open) => !open && setEditingUnit(null)}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-edit-unit">
          <DialogHeader>
            <DialogTitle>Edit Unit {editingUnit?.roomNumber}</DialogTitle>
            <DialogDescription>
              Update pricing and availability for this unit
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-street-rate">Monthly Rate ($)</Label>
              <Input
                id="edit-street-rate"
                type="number"
                value={editFormData.streetRate || ''}
                onChange={(e) => setEditFormData({ ...editFormData, streetRate: e.target.value })}
                placeholder="Enter monthly rate"
                data-testid="input-edit-rate"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-status">Status</Label>
              <select
                id="edit-status"
                value={editFormData.occupiedYN || 'no'}
                onChange={(e) => setEditFormData({ ...editFormData, occupiedYN: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
                data-testid="select-edit-status"
              >
                <option value="no">Available</option>
                <option value="yes">Occupied</option>
              </select>
            </div>

            <div className="bg-slate-50 p-3 rounded-md text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-600">Room Type:</span>
                  <p className="font-medium">{editingUnit?.roomType}</p>
                </div>
                <div>
                  <span className="text-slate-600">Floor Plan:</span>
                  <p className="font-medium">{editingUnit?.size}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setEditingUnit(null)}
              data-testid="button-cancel-edit"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)]"
              data-testid="button-save-edit"
            >
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Book Now - Coming Soon Dialog */}
      <Dialog open={showBookingDialog} onOpenChange={(open) => {
        setShowBookingDialog(open);
        if (!open) setSelectedUnitId(null);
      }}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto" data-testid="dialog-unit-booking">
          {selectedUnit ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-2xl">Room {selectedUnit.roomNumber}</DialogTitle>
                <DialogDescription>
                  {selectedUnit.roomType} • {selectedUnit.size}
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 p-3 rounded">
                    <p className="text-xs text-slate-600 mb-1">Current Rate</p>
                    <p className="text-xl font-semibold text-slate-900">
                      ${Math.round(selectedUnit.streetRate || selectedUnit.moduloSuggestedRate || selectedUnit.rentAndCareRate || 0).toLocaleString()}/mo
                    </p>
                  </div>
                  {selectedUnit.moduloSuggestedRate && (
                    <div className="bg-[var(--trilogy-teal)]/10 p-3 rounded border border-[var(--trilogy-teal)]">
                      <p className="text-xs text-[var(--trilogy-navy)] mb-1">Modulo Rate</p>
                      <p className="text-xl font-semibold text-[var(--trilogy-navy)]">
                        ${Math.round(selectedUnit.moduloSuggestedRate).toLocaleString()}/mo
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <div className={`px-3 py-1 rounded-full text-sm font-medium ${
                    selectedUnit.occupiedYN 
                      ? 'bg-slate-200 text-slate-700' 
                      : 'bg-green-100 text-green-700'
                  }`}>
                    {selectedUnit.occupiedYN ? 'Occupied' : 'Vacant'}
                  </div>
                  {!selectedUnit.occupiedYN && selectedUnit.daysVacant > 0 && (
                    <span className="text-sm text-slate-600">
                      Vacant for {selectedUnit.daysVacant} days
                    </span>
                  )}
                </div>

                <div className="bg-slate-50 p-4 rounded-lg text-center">
                  <p className="text-sm text-slate-700 mb-3">
                    <strong>Ready to schedule a tour?</strong>
                  </p>
                  <p className="text-2xl font-semibold text-[var(--trilogy-teal)] mb-2">
                    1-800-TRILOGY
                  </p>
                  <p className="text-xs text-slate-600">
                    Our friendly staff is ready to help you find the perfect home.
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                {selectedUnit.occupiedYN ? (
                  <Button
                    onClick={() => {
                      toast({
                        title: "Join Waitlist",
                        description: "Please call us at 1-800-TRILOGY to join the waitlist for this room.",
                      });
                      setShowBookingDialog(false);
                    }}
                    className="flex-1 bg-slate-600 hover:bg-slate-700"
                    data-testid="button-join-waitlist"
                  >
                    Join Waitlist
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      toast({
                        title: "Schedule Tour",
                        description: `Please call us at 1-800-TRILOGY to schedule a tour of Room ${selectedUnit.roomNumber}.`,
                      });
                      setShowBookingDialog(false);
                    }}
                    className="flex-1 bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)]"
                    data-testid="button-schedule-tour"
                  >
                    Schedule Tour
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => setShowBookingDialog(false)}
                  data-testid="button-close-booking"
                >
                  Close
                </Button>
              </div>
            </>
          ) : (
            <div className="py-8 text-center">
              <p className="text-slate-500">Loading unit details...</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
