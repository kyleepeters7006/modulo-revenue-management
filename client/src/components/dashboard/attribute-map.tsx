import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface FloorMapUnit {
  Unit_ID: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FloorMap {
  image: string;
  units: FloorMapUnit[];
}

interface UnitAttributes {
  size: 'Studio' | 'One Bedroom' | 'Two Bedroom';
  location: 'West Wing' | 'East Wing' | 'Memory Care';
  view: 'Garden View' | 'Courtyard View' | 'Street View';
  renovated: boolean;
  premiumAmenities: string[];
}

// Demo attributes for each unit
const demoAttributes: Record<string, UnitAttributes> = {
  'AL101': { size: 'Studio', location: 'West Wing', view: 'Garden View', renovated: true, premiumAmenities: ['Kitchenette', 'Walk-in Shower'] },
  'AL102': { size: 'One Bedroom', location: 'West Wing', view: 'Garden View', renovated: false, premiumAmenities: ['Balcony'] },
  'AL103': { size: 'One Bedroom', location: 'West Wing', view: 'Courtyard View', renovated: true, premiumAmenities: ['Fireplace', 'Balcony'] },
  'AL104': { size: 'Two Bedroom', location: 'West Wing', view: 'Courtyard View', renovated: true, premiumAmenities: ['Fireplace', 'Walk-in Closet', 'Balcony'] },
  'AL105': { size: 'Studio', location: 'West Wing', view: 'Garden View', renovated: false, premiumAmenities: ['Kitchenette'] },
  'AL106': { size: 'One Bedroom', location: 'West Wing', view: 'Garden View', renovated: true, premiumAmenities: ['Walk-in Shower', 'Balcony'] },
  'AL107': { size: 'One Bedroom', location: 'West Wing', view: 'Courtyard View', renovated: false, premiumAmenities: ['Fireplace'] },
  'AL108': { size: 'Two Bedroom', location: 'West Wing', view: 'Courtyard View', renovated: true, premiumAmenities: ['Fireplace', 'Walk-in Closet', 'Premium Fixtures'] },
  
  'AL201': { size: 'Studio', location: 'East Wing', view: 'Street View', renovated: true, premiumAmenities: ['Kitchenette', 'Walk-in Shower'] },
  'AL202': { size: 'One Bedroom', location: 'East Wing', view: 'Street View', renovated: false, premiumAmenities: ['Balcony'] },
  'AL203': { size: 'Two Bedroom', location: 'East Wing', view: 'Street View', renovated: true, premiumAmenities: ['Premium Fixtures', 'Walk-in Closet'] },
  'AL204': { size: 'Studio', location: 'East Wing', view: 'Courtyard View', renovated: false, premiumAmenities: ['Kitchenette'] },
  'AL205': { size: 'One Bedroom', location: 'East Wing', view: 'Courtyard View', renovated: true, premiumAmenities: ['Fireplace', 'Walk-in Shower'] },
  'AL206': { size: 'Two Bedroom', location: 'East Wing', view: 'Courtyard View', renovated: true, premiumAmenities: ['Fireplace', 'Walk-in Closet', 'Premium Fixtures', 'Balcony'] },
  
  'MC01': { size: 'Studio', location: 'Memory Care', view: 'Garden View', renovated: true, premiumAmenities: ['Memory Care Features', 'Safety Systems'] },
  'MC02': { size: 'One Bedroom', location: 'Memory Care', view: 'Garden View', renovated: true, premiumAmenities: ['Memory Care Features', 'Safety Systems', 'Kitchenette'] },
  'MC03': { size: 'Studio', location: 'Memory Care', view: 'Courtyard View', renovated: false, premiumAmenities: ['Memory Care Features', 'Safety Systems'] },
  'MC04': { size: 'One Bedroom', location: 'Memory Care', view: 'Courtyard View', renovated: true, premiumAmenities: ['Memory Care Features', 'Safety Systems', 'Premium Fixtures'] },
};

const getAttributeColor = (unitId: string): string => {
  const attrs = demoAttributes[unitId];
  if (!attrs) return '#182042';
  
  // Color by renovated status
  if (attrs.renovated) return '#2563eb'; // Blue for renovated
  return '#dc2626'; // Red for not renovated
};

const getAttributeBadgeColor = (type: string, value: any): string => {
  switch (type) {
    case 'size':
      return value === 'Studio' ? 'bg-orange-500' : value === 'One Bedroom' ? 'bg-blue-500' : 'bg-purple-500';
    case 'location':
      return value === 'West Wing' ? 'bg-green-500' : value === 'East Wing' ? 'bg-indigo-500' : 'bg-red-500';
    case 'view':
      return value === 'Garden View' ? 'bg-emerald-500' : value === 'Courtyard View' ? 'bg-teal-500' : 'bg-gray-500';
    case 'renovated':
      return value ? 'bg-blue-500' : 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
};

export default function AttributeMap() {
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [filterAttribute, setFilterAttribute] = useState<string>('all');
  const [floorMap, setFloorMap] = useState<FloorMap | null>(null);

  useEffect(() => {
    // Load floor map data
    fetch('/data/floor_map.json')
      .then(res => res.json())
      .then(data => setFloorMap(data))
      .catch(err => console.error('Failed to load floor map:', err));
  }, []);

  const { data: rentRoll } = useQuery({
    queryKey: ["/api/status"],
  });

  if (!floorMap) {
    return (
      <Card className="dashboard-card">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-[var(--dashboard-text)]">
            Unit Attribute Map
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-[var(--dashboard-muted)]">Loading floor plan...</div>
        </CardContent>
      </Card>
    );
  }

  const selectedAttributes = selectedUnit ? demoAttributes[selectedUnit] : null;

  return (
    <Card className="dashboard-card">
      <CardHeader>
        <CardTitle className="text-xl font-semibold text-[var(--dashboard-text)] flex items-center justify-between">
          Unit Attribute Map
          <div className="flex gap-2">
            <Button
              variant={filterAttribute === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterAttribute('all')}
              className="text-xs"
            >
              All Units
            </Button>
            <Button
              variant={filterAttribute === 'renovated' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterAttribute('renovated')}
              className="text-xs"
            >
              Renovated
            </Button>
            <Button
              variant={filterAttribute === 'premium' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilterAttribute('premium')}
              className="text-xs"
            >
              Premium
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Floor Plan */}
          <div className="lg:col-span-2">
            <div className="relative w-full h-96 border border-[var(--dashboard-border)] rounded-lg overflow-hidden bg-[var(--dashboard-surface)]">
              <svg
                viewBox="0 0 1400 850"
                className="w-full h-full"
                style={{ background: '#0b0e1a' }}
              >
                {/* Background elements */}
                <rect x="80" y="370" width="1240" height="60" rx="8" fill="#12162a" stroke="#2a3158" strokeWidth="3"/>
                
                {/* West Wing */}
                <rect x="80" y="160" width="520" height="390" rx="10" fill="#12162a" stroke="#2a3158" strokeWidth="3"/>
                
                {/* East Wing */}
                <rect x="860" y="160" width="460" height="390" rx="10" fill="#12162a" stroke="#2a3158" strokeWidth="3"/>
                
                {/* Memory Care */}
                <rect x="560" y="520" width="300" height="230" rx="12" fill="#12162a" stroke="#2a3158" strokeWidth="3"/>
                
                {/* Common Areas */}
                <rect x="610" y="170" width="220" height="130" rx="8" fill="#121a38" stroke="#2a3158" strokeDasharray="6 6"/>
                <text x="640" y="225" fill="#c9d7ff" fontSize="18" fontFamily="Segoe UI, Roboto, sans-serif">Dining</text>
                <rect x="610" y="310" width="220" height="120" rx="8" fill="#121a38" stroke="#2a3158" strokeDasharray="6 6"/>
                <text x="650" y="375" fill="#c9d7ff" fontSize="18" fontFamily="Segoe UI, Roboto, sans-serif">Activity</text>
                <rect x="104" y="410" width="122" height="120" rx="8" fill="#121a38" stroke="#2a3158" strokeDasharray="6 6"/>
                <text x="122" y="478" fill="#c9d7ff" fontSize="18" fontFamily="Segoe UI, Roboto, sans-serif">Lobby</text>

                {/* Units */}
                {floorMap.units.map((unit) => {
                  const x = (unit.x / 100) * 1400;
                  const y = (unit.y / 100) * 850;
                  const width = (unit.w / 100) * 1400;
                  const height = (unit.h / 100) * 850;
                  
                  const attrs = demoAttributes[unit.Unit_ID];
                  let shouldShow = true;
                  
                  if (filterAttribute === 'renovated') {
                    shouldShow = attrs?.renovated || false;
                  } else if (filterAttribute === 'premium') {
                    shouldShow = (attrs?.premiumAmenities.length || 0) >= 2;
                  }
                  
                  if (!shouldShow) return null;
                  
                  return (
                    <Tooltip key={unit.Unit_ID}>
                      <TooltipTrigger asChild>
                        <g>
                          <rect
                            x={x}
                            y={y}
                            width={width}
                            height={height}
                            fill={getAttributeColor(unit.Unit_ID)}
                            stroke={selectedUnit === unit.Unit_ID ? '#6ea8fe' : '#2e3a6b'}
                            strokeWidth={selectedUnit === unit.Unit_ID ? 3 : 2}
                            className="cursor-pointer transition-all duration-200 hover:brightness-125"
                            onClick={() => setSelectedUnit(selectedUnit === unit.Unit_ID ? null : unit.Unit_ID)}
                          />
                          <text
                            x={x + width / 2}
                            y={y + height / 2 + 6}
                            fill="#c9d7ff"
                            fontSize="14"
                            fontFamily="Segoe UI, Roboto, sans-serif"
                            textAnchor="middle"
                            className="pointer-events-none"
                          >
                            {unit.Unit_ID}
                          </text>
                        </g>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="text-sm">
                          <div className="font-semibold">{unit.Unit_ID}</div>
                          {attrs && (
                            <div className="mt-1 space-y-1">
                              <div>{attrs.size}</div>
                              <div>{attrs.location}</div>
                              <div>{attrs.view}</div>
                              <div>{attrs.renovated ? 'Renovated' : 'Original'}</div>
                            </div>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
                
                <text x="30" y="45" fill="#6ea8fe" fontSize="26" fontFamily="Segoe UI, Roboto, sans-serif">
                  AL Demo – East &amp; West Wings + Memory Care
                </text>
              </svg>
            </div>
            
            {/* Legend */}
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-blue-600 rounded"></div>
                <span className="text-[var(--dashboard-text)]">Renovated</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-red-600 rounded"></div>
                <span className="text-[var(--dashboard-text)]">Original</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-blue-400 rounded"></div>
                <span className="text-[var(--dashboard-text)]">Selected</span>
              </div>
            </div>
          </div>

          {/* Unit Details */}
          <div className="space-y-4">
            {selectedUnit && selectedAttributes ? (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-[var(--dashboard-text)]">
                  Unit {selectedUnit}
                </h3>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-[var(--dashboard-muted)]">Size</label>
                    <Badge className={`ml-2 ${getAttributeBadgeColor('size', selectedAttributes.size)} text-white`}>
                      {selectedAttributes.size}
                    </Badge>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-[var(--dashboard-muted)]">Location</label>
                    <Badge className={`ml-2 ${getAttributeBadgeColor('location', selectedAttributes.location)} text-white`}>
                      {selectedAttributes.location}
                    </Badge>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-[var(--dashboard-muted)]">View</label>
                    <Badge className={`ml-2 ${getAttributeBadgeColor('view', selectedAttributes.view)} text-white`}>
                      {selectedAttributes.view}
                    </Badge>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-[var(--dashboard-muted)]">Status</label>
                    <Badge className={`ml-2 ${getAttributeBadgeColor('renovated', selectedAttributes.renovated)} text-white`}>
                      {selectedAttributes.renovated ? 'Renovated' : 'Original'}
                    </Badge>
                  </div>
                  
                  {selectedAttributes.premiumAmenities.length > 0 && (
                    <div>
                      <label className="text-sm font-medium text-[var(--dashboard-muted)]">Premium Amenities</label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {selectedAttributes.premiumAmenities.map((amenity) => (
                          <Badge key={amenity} variant="outline" className="text-xs">
                            {amenity}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center text-[var(--dashboard-muted)] py-8">
                <div className="mb-4">
                  <svg className="w-12 h-12 mx-auto text-[var(--dashboard-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-4m-5 0H3m2 0h4M9 7h6m-6 4h6m-6 4h6"/>
                  </svg>
                </div>
                <p>Click on a unit to view its attributes</p>
              </div>
            )}
            
            {/* Attribute Summary */}
            <div className="mt-6 p-4 bg-[var(--dashboard-bg)] rounded-lg">
              <h4 className="text-sm font-semibold text-[var(--dashboard-text)] mb-3">Summary</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--dashboard-muted)]">Total Units:</span>
                  <span className="text-[var(--dashboard-text)]">{floorMap.units.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--dashboard-muted)]">Renovated:</span>
                  <span className="text-[var(--dashboard-text)]">
                    {Object.values(demoAttributes).filter(attr => attr.renovated).length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--dashboard-muted)]">Premium Units:</span>
                  <span className="text-[var(--dashboard-text)]">
                    {Object.values(demoAttributes).filter(attr => attr.premiumAmenities.length >= 2).length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}