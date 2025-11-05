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
}

interface UnitDetails {
  roomNumber: string;
  roomType: string;
  streetRate: number;
  occupiedYN: boolean;
  daysVacant: number;
  moduloSuggestedRate?: number;
  size: string;
}

interface UnitPolygon {
  id: string;
  label: string;
  polygonCoordinates: string;
  fillColor: string;
  rentRollDataId: string;
}

export default function InteractiveFloorPlanViewer({ campusMap }: InteractiveFloorPlanViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [editMode, setEditMode] = useState(false);
  const [editingUnit, setEditingUnit] = useState<any | null>(null);
  const [editFormData, setEditFormData] = useState<any>({});
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const lastTouchDistance = useRef<number | null>(null);
  const { toast } = useToast();

  // Fetch unit polygons for this map
  const { data: polygons = [] } = useQuery<UnitPolygon[]>({
    queryKey: [`/api/unit-polygons/map/${campusMap.id}`],
    enabled: !!campusMap.id,
  });

  // Fetch unit details when hovering
  const { data: hoveredUnit } = useQuery<UnitDetails>({
    queryKey: [`/api/rent-roll-data/${hoveredUnitId}`],
    enabled: !!hoveredUnitId,
  });

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
    if (!editMode) return;
    
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
  };

  const handleSaveEdit = async () => {
    if (!editingUnit) return;

    try {
      await apiRequest(`/api/rent-roll-data/${editingUnit.id}`, 'PATCH', {
        streetRate: parseFloat(editFormData.streetRate),
        occupiedYN: editFormData.occupiedYN === 'yes',
      });

      queryClient.invalidateQueries({ queryKey: [`/api/rent-roll-data/${editingUnit.id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/rent-roll-data/location`] });

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
              
              {/* SVG overlay layer for interactive polygons */}
              <svg
                viewBox={`0 0 ${campusMap.width || 1920} ${campusMap.height || 1080}`}
                className="absolute top-0 left-0 w-full h-auto"
                style={{
                  maxHeight: '800px',
                  pointerEvents: 'none',
                }}
              >
                {/* Interactive polygon overlays */}
                {polygons.map((polygon: any) => {
                  const coordinates = JSON.parse(polygon.polygonCoordinates);
                  const points = coordinates.map((coord: number[]) => coord.join(',')).join(' ');
                  
                  return (
                    <polygon
                      key={polygon.id}
                      points={points}
                      fill={polygon.fillColor}
                      fillOpacity={hoveredUnitId === polygon.rentRollDataId ? 0.8 : 0.5}
                      stroke="#334155"
                      strokeWidth="2"
                      className="cursor-pointer transition-all hover:fill-opacity-80"
                      style={{ pointerEvents: 'auto' }}
                      onMouseEnter={(e) => handlePolygonHover(polygon.rentRollDataId, e)}
                      onMouseMove={(e) => {
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
                      onMouseLeave={handlePolygonLeave}
                      onClick={() => handlePolygonClick(polygon.rentRollDataId)}
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
              <span className="text-sm opacity-90">• Click any room to edit</span>
            </div>
          </div>
        )}

          {/* Tooltip */}
          {hoveredUnit && hoveredUnitId && (
            <div
              className="absolute bg-white shadow-xl rounded-lg border p-4 z-50 pointer-events-none"
              style={{
                left: `${tooltipPosition.x + 15}px`,
                top: `${tooltipPosition.y + 15}px`,
                minWidth: '260px',
              }}
              data-testid="unit-tooltip"
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
                      {formatCurrency(hoveredUnit.streetRate)}
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
              </div>
            </div>
          )}
      </div>

      {/* Legend - Bottom */}
      {roomTypeLegend.length > 0 && (
        <div className="bg-white border-t px-6 py-3">
          <div className="flex flex-wrap items-center gap-4">
            {roomTypeLegend.map((type: string) => (
              <div key={type} className="flex items-center gap-2">
                <div 
                  className="w-5 h-5 rounded border border-slate-300"
                  style={{ backgroundColor: getLegendColor(type) }}
                />
                <span className="text-sm text-slate-700">{getLegendLabel(type)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
    </div>
  );
}
