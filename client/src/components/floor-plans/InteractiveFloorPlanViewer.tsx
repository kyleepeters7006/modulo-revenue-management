import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

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

export default function InteractiveFloorPlanViewer({ campusMap }: InteractiveFloorPlanViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const lastTouchDistance = useRef<number | null>(null);

  // Fetch unit polygons for this map
  const { data: polygons = [] } = useQuery({
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
      setTooltipPosition({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    }
  };

  const handlePolygonLeave = () => {
    setHoveredUnitId(null);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{campusMap?.name || 'Floor Plan'}</CardTitle>
            <CardDescription>
              Interactive campus floor plan - hover over units for details
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
              data-testid="button-zoom-out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleResetZoom}
              data-testid="button-reset-zoom"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleZoomIn}
              disabled={zoom >= 3}
              data-testid="button-zoom-in"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div 
          ref={svgContainerRef}
          className="relative w-full bg-slate-50 overflow-auto"
          style={{ 
            height: '700px',
            touchAction: 'pan-x pan-y pinch-zoom'
          }}
        >
          {/* SVG Container with zoom */}
          <div
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
              transition: 'transform 0.2s ease-out',
            }}
            className="inline-block"
          >
            {/* Combined SVG with base content and interactive overlays */}
            <svg
              viewBox={`0 0 ${campusMap?.width || 1200} ${campusMap?.height || 800}`}
              style={{
                display: 'block',
                width: `${campusMap?.width || 1200}px`,
                height: `${campusMap?.height || 800}px`,
              }}
            >
              {/* Base SVG content (rendered inline) */}
              {campusMap?.svgContent && (
                <g dangerouslySetInnerHTML={{ 
                  __html: campusMap.svgContent
                    .replace(/<svg[^>]*>/, '')
                    .replace(/<\/svg>/, '')
                }} />
              )}

              {/* Interactive polygon overlays */}
              {polygons.map((polygon: any) => {
                const coordinates = JSON.parse(polygon.polygonCoordinates);
                const points = coordinates.map((coord: number[]) => coord.join(',')).join(' ');
                
                return (
                  <polygon
                    key={polygon.id}
                    points={points}
                    fill={polygon.fillColor}
                    fillOpacity={hoveredUnitId === polygon.rentRollDataId ? 0.7 : 0.3}
                    stroke={polygon.strokeColor}
                    strokeWidth="2"
                    className="cursor-pointer transition-all hover:fill-opacity-70"
                    onMouseEnter={(e) => handlePolygonHover(polygon.rentRollDataId, e)}
                    onMouseMove={(e) => {
                      const rect = svgContainerRef.current?.getBoundingClientRect();
                      if (rect) {
                        setTooltipPosition({
                          x: e.clientX - rect.left,
                          y: e.clientY - rect.top,
                        });
                      }
                    }}
                    onMouseLeave={handlePolygonLeave}
                    data-testid={`polygon-unit-${polygon.label}`}
                  />
                );
              })}
            </svg>
          </div>

          {/* Tooltip */}
          {hoveredUnit && hoveredUnitId && (
            <div
              className="absolute bg-white shadow-lg rounded-lg border-2 border-[var(--trilogy-teal)] p-4 z-50 pointer-events-none"
              style={{
                left: `${tooltipPosition.x + 15}px`,
                top: `${tooltipPosition.y + 15}px`,
                minWidth: '280px',
              }}
              data-testid="unit-tooltip"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between border-b pb-2">
                  <h4 className="font-bold text-lg">Unit {hoveredUnit.roomNumber}</h4>
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
                    <span className="text-muted-foreground">Type:</span>
                    <span className="font-medium">{hoveredUnit.roomType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Size:</span>
                    <span className="font-medium">{hoveredUnit.size}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Current Rate:</span>
                    <span className="font-bold text-[var(--trilogy-teal)]">
                      {formatCurrency(hoveredUnit.streetRate)}
                    </span>
                  </div>
                  {hoveredUnit.moduloSuggestedRate && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Modulo Rate:</span>
                      <span className="font-medium text-purple-600">
                        {formatCurrency(hoveredUnit.moduloSuggestedRate)}
                      </span>
                    </div>
                  )}
                  {!hoveredUnit.occupiedYN && hoveredUnit.daysVacant > 0 && (
                    <div className="flex justify-between pt-1 border-t">
                      <span className="text-muted-foreground">Days Vacant:</span>
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

          {/* Zoom indicator */}
          <div className="absolute bottom-4 right-4 bg-white/90 px-3 py-1 rounded-full text-xs font-medium shadow-md">
            {Math.round(zoom * 100)}%
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
