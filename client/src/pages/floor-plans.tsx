import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Settings, Bed, Bath, Square, MapPin } from "lucide-react";
import InteractiveFloorPlanViewer from "@/components/floor-plans/InteractiveFloorPlanViewer";

export default function FloorPlansPage() {
  const [selectedCampus, setSelectedCampus] = useState<string>("");
  const [bedroomsFilter, setBedroomsFilter] = useState<string>("any");
  const [floorPlanFilter, setFloorPlanFilter] = useState<string>("any");
  const [sqftFilter, setSqftFilter] = useState<string>("any");
  const [careLevelFilter, setCareLevelFilter] = useState<string>("any");
  const [highlightedUnitId, setHighlightedUnitId] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  // Fetch locations for campus selector
  const { data: locationsData } = useQuery({
    queryKey: ['/api/locations'],
  });

  // Auto-select first campus when locations load
  useEffect(() => {
    const locations = locationsData?.locations || [];
    if (locations.length > 0 && !selectedCampus) {
      setSelectedCampus(locations[0].id);
    }
  }, [locationsData, selectedCampus]);
  
  // Fetch rent roll data for the selected campus
  const { data: rentRollData = [], isLoading: isLoadingUnits } = useQuery({
    queryKey: [`/api/rent-roll-data/location/${selectedCampus}`],
    enabled: !!selectedCampus,
  });

  // Fetch campus map
  const { data: result, isLoading: isLoadingMap } = useQuery({
    queryKey: [`/api/campus-maps/${selectedCampus}`],
    enabled: !!selectedCampus,
  });
  
  const locations = locationsData?.locations || [];
  const campusMap = result?.campusMap;

  // Get unique floor plan types from the data
  const uniqueFloorPlans = useMemo(() => {
    const plans = new Set(rentRollData
      .map((u: any) => u.size || '')
      .filter((size: string) => size));
    return Array.from(plans).sort();
  }, [rentRollData]);

  // Get unique care levels from the data
  const uniqueCareLevels = useMemo(() => {
    const levels = new Set(rentRollData
      .map((u: any) => u.serviceLine || '')
      .filter((line: string) => line));
    return Array.from(levels).sort();
  }, [rentRollData]);

  // Filter units based on selected filters
  const filteredUnits = useMemo(() => {
    return rentRollData.filter((unit: any) => {
      // Bedroom filter
      if (bedroomsFilter !== "any") {
        const size = unit.size || '';
        const unitBedrooms = 
          size.toLowerCase().includes('studio') || size.toLowerCase().includes('companion') ? 'studio' :
          size.toLowerCase().includes('one bedroom') || size.toLowerCase().includes('1 bedroom') ? '1' :
          size.toLowerCase().includes('two bedroom') || size.toLowerCase().includes('2 bedroom') ? '2' :
          size.toLowerCase().includes('three bedroom') || size.toLowerCase().includes('3 bedroom') ? '3' : 'other';
        if (unitBedrooms !== bedroomsFilter) return false;
      }
      
      // Floor Plan filter
      if (floorPlanFilter !== "any" && unit.size !== floorPlanFilter) {
        return false;
      }
      
      // Square footage filter (mock implementation - would need actual sqft data)
      if (sqftFilter !== "any") {
        // This would require actual square footage data in the unit object
        // For now, we'll use a mock implementation based on bedroom count
        const size = unit.size || '';
        const estimatedSqft = 
          size.toLowerCase().includes('studio') ? 400 :
          size.toLowerCase().includes('one bedroom') ? 700 :
          size.toLowerCase().includes('two bedroom') ? 1000 : 1200;
          
        switch(sqftFilter) {
          case 'lt500':
            if (estimatedSqft >= 500) return false;
            break;
          case '500-750':
            if (estimatedSqft < 500 || estimatedSqft > 750) return false;
            break;
          case '750-1000':
            if (estimatedSqft < 750 || estimatedSqft > 1000) return false;
            break;
          case 'gt1000':
            if (estimatedSqft <= 1000) return false;
            break;
        }
      }
      
      // Care Level filter
      if (careLevelFilter !== "any" && unit.serviceLine !== careLevelFilter) {
        return false;
      }
      
      return true;
    });
  }, [rentRollData, bedroomsFilter, floorPlanFilter, sqftFilter, careLevelFilter]);

  const handleResetFilters = () => {
    setBedroomsFilter("any");
    setFloorPlanFilter("any");
    setSqftFilter("any");
    setCareLevelFilter("any");
  };

  const handleUnitClick = (unitId: string) => {
    setHighlightedUnitId(unitId);
    // Could also trigger highlighting in the floor plan viewer
  };

  // Helper function to get bedroom/bath count from size string
  const parseUnitDetails = (size: string) => {
    const lowerSize = size?.toLowerCase() || '';
    const beds = 
      lowerSize.includes('studio') || lowerSize.includes('companion') ? 'Studio' :
      lowerSize.includes('one bedroom') || lowerSize.includes('1 bedroom') ? '1 Bed' :
      lowerSize.includes('two bedroom') || lowerSize.includes('2 bedroom') ? '2 Bed' :
      lowerSize.includes('three bedroom') || lowerSize.includes('3 bedroom') ? '3 Bed' : 'Studio';
    
    // Mock bath count - would need actual data
    const baths = beds === 'Studio' ? '1 Bath' :
                  beds === '1 Bed' ? '1 Bath' :
                  beds === '2 Bed' ? '2 Bath' : '2 Bath';
    
    // Mock square footage - would need actual data
    const sqft = 
      beds === 'Studio' ? '450' :
      beds === '1 Bed' ? '750' :
      beds === '2 Bed' ? '1,180' : '1,500';
    
    return { beds, baths, sqft };
  };

  // Helper to get service line display name
  const getServiceLineDisplay = (serviceLine: string) => {
    switch(serviceLine) {
      case 'AL': return 'Assisted Living';
      case 'AL/MC': return 'Assisted Living / Memory Care';
      case 'HC': return 'Health Care';
      case 'HC/MC': return 'Health Care / Memory Care';
      case 'IL': return 'Independent Living';
      case 'SL': return 'Senior Living';
      default: return serviceLine;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setLocation('/')}
                className="hover:bg-gray-100"
                data-testid="button-back"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setLocation(selectedCampus ? `/floor-plans-admin?campus=${selectedCampus}` : '/floor-plans-admin')}
                className="hover:bg-gray-100"
                data-testid="button-admin"
              >
                <Settings className="h-4 w-4 mr-2" />
                Admin
              </Button>
            </div>
            <Select value={selectedCampus} onValueChange={setSelectedCampus}>
              <SelectTrigger className="w-64" data-testid="select-campus">
                <SelectValue placeholder="Select a campus..." />
              </SelectTrigger>
              <SelectContent>
                {locations.map((location: any) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Title Section */}
          <div className="text-center py-4">
            <h1 className="text-3xl font-light text-gray-900 mb-2">
              Explore Floor Plans
            </h1>
            <p className="text-gray-600">
              Use our interactive tools below to see floor plans, units and availability at each campus.
            </p>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {!selectedCampus ? (
        <div className="flex items-center justify-center min-h-[600px]">
          <div className="text-center">
            <MapPin className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">
              No Campus Selected
            </h3>
            <p className="text-gray-500">
              Select a campus from the dropdown above to view floor plans
            </p>
          </div>
        </div>
      ) : (
        <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Filters and Unit List (1/3 width) */}
            <div className="lg:col-span-1 space-y-6">
              {/* Filter Section */}
              <Card className="shadow-sm">
                <CardContent className="p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Filters</h3>
                  <div className="space-y-4">
                    {/* Bedrooms Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Bedrooms
                      </label>
                      <Select value={bedroomsFilter} onValueChange={setBedroomsFilter}>
                        <SelectTrigger data-testid="filter-bedrooms">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any</SelectItem>
                          <SelectItem value="studio">Studio</SelectItem>
                          <SelectItem value="1">One Bedroom</SelectItem>
                          <SelectItem value="2">Two Bedroom</SelectItem>
                          <SelectItem value="3">Three Bedroom</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Floor Plan Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Floor Plan
                      </label>
                      <Select value={floorPlanFilter} onValueChange={setFloorPlanFilter}>
                        <SelectTrigger data-testid="filter-floor-plan">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any</SelectItem>
                          {uniqueFloorPlans.map((plan) => (
                            <SelectItem key={plan} value={plan}>{plan}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Square Footage Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Square Footage
                      </label>
                      <Select value={sqftFilter} onValueChange={setSqftFilter}>
                        <SelectTrigger data-testid="filter-sqft">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any</SelectItem>
                          <SelectItem value="lt500">&lt; 500</SelectItem>
                          <SelectItem value="500-750">500-750</SelectItem>
                          <SelectItem value="750-1000">750-1000</SelectItem>
                          <SelectItem value="gt1000">&gt; 1000</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Care Level Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Care Level
                      </label>
                      <Select value={careLevelFilter} onValueChange={setCareLevelFilter}>
                        <SelectTrigger data-testid="filter-care-level">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">Any</SelectItem>
                          {uniqueCareLevels.map((level) => (
                            <SelectItem key={level} value={level}>
                              {getServiceLineDisplay(level)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Reset Button */}
                    <Button 
                      variant="outline"
                      onClick={handleResetFilters}
                      className="w-full"
                      data-testid="button-reset-filters"
                    >
                      Reset Filters
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Unit List Section */}
              <Card className="shadow-sm">
                <CardContent className="p-6">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">
                    {filteredUnits.length} Matches
                  </h3>
                  <ScrollArea className="h-[500px] pr-4">
                    {isLoadingUnits ? (
                      <div className="space-y-3">
                        {[...Array(5)].map((_, i) => (
                          <Skeleton key={i} className="h-32 w-full" />
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {filteredUnits.map((unit: any) => {
                          const details = parseUnitDetails(unit.size);
                          const rate = unit.streetRate || unit.moduloSuggestedRate || unit.rentAndCareRate || 0;
                          
                          return (
                            <Card 
                              key={unit.id} 
                              className={`cursor-pointer transition-all hover:shadow-md ${
                                highlightedUnitId === unit.id ? 'ring-2 ring-blue-500' : ''
                              }`}
                              onClick={() => handleUnitClick(unit.id)}
                              data-testid={`unit-card-${unit.roomNumber}`}
                            >
                              <CardContent className="p-4">
                                <div className="flex justify-between items-start mb-2">
                                  <div className="font-semibold text-gray-900">
                                    HOME {unit.roomNumber} - {getServiceLineDisplay(unit.serviceLine)}
                                  </div>
                                  <Badge 
                                    className={unit.occupiedYN ? "bg-gray-500" : "bg-green-500"}
                                  >
                                    {unit.occupiedYN ? 'Occupied' : 'Available'}
                                  </Badge>
                                </div>
                                
                                <div className="text-sm text-gray-600 mb-2">
                                  {unit.size || 'Studio'}
                                </div>
                                
                                <div className="flex items-center gap-4 text-sm text-gray-700 mb-2">
                                  <span className="flex items-center gap-1">
                                    <Bed className="h-4 w-4" />
                                    {details.beds}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Bath className="h-4 w-4" />
                                    {details.baths}
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Square className="h-4 w-4" />
                                    {details.sqft} sq. ft.
                                  </span>
                                </div>
                                
                                <div className="text-lg font-semibold text-gray-900">
                                  ${rate.toLocaleString()}/month
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            {/* Right Column - Floor Plan Viewer (2/3 width) */}
            <div className="lg:col-span-2">
              <Card className="shadow-sm h-full min-h-[700px]">
                <CardContent className="p-0 h-full">
                  {isLoadingMap ? (
                    <div className="h-full flex items-center justify-center bg-gray-50">
                      <div className="text-center">
                        <Skeleton className="h-16 w-16 rounded-full mx-auto mb-4" />
                        <p className="text-gray-500">Loading floor plan...</p>
                      </div>
                    </div>
                  ) : campusMap ? (
                    <InteractiveFloorPlanViewer campusMap={campusMap} />
                  ) : (
                    <div className="h-full flex items-center justify-center bg-gray-50">
                      <div className="text-center">
                        <MapPin className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500">No floor plan available</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}