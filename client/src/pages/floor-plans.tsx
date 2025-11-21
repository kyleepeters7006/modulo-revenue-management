import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ArrowLeft, Settings, Bed, Bath, Square, MapPin, Search, X, ChevronDown, Filter, AlertCircle } from "lucide-react";
import { FixedSizeList as List } from "react-window";
import Highlighter from "react-highlight-words";
import InteractiveFloorPlanViewer from "@/components/floor-plans/InteractiveFloorPlanViewer";

// Memoized Unit Card Component for performance
const UnitCard = memo(({ 
  unit, 
  details, 
  rate, 
  isHighlighted, 
  onClick, 
  searchTerm,
  getServiceLineDisplay 
}: {
  unit: any;
  details: { beds: string; baths: string; sqft: string };
  rate: number;
  isHighlighted: boolean;
  onClick: () => void;
  searchTerm: string;
  getServiceLineDisplay: (line: string) => string;
}) => {
  const unitRef = useRef<HTMLDivElement>(null);

  // Smooth scroll to selected unit
  useEffect(() => {
    if (isHighlighted && unitRef.current) {
      unitRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, [isHighlighted]);

  return (
    <div ref={unitRef}>
      <Card 
        className={`cursor-pointer transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${
          isHighlighted ? 'ring-2 ring-blue-500 shadow-lg' : ''
        }`}
        onClick={onClick}
        data-testid={`unit-card-${unit.roomNumber}`}
        tabIndex={0}
        role="button"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
      >
        <CardContent className="p-4">
          <div className="flex justify-between items-start mb-2">
            <div className="font-semibold text-gray-900">
              <Highlighter
                highlightClassName="bg-yellow-200"
                searchWords={searchTerm ? searchTerm.split(' ') : []}
                textToHighlight={`HOME ${unit.roomNumber} - ${getServiceLineDisplay(unit.serviceLine)}`}
              />
            </div>
            <Badge 
              className={`transition-colors ${unit.occupiedYN ? "bg-gray-500" : "bg-green-500 animate-pulse"}`}
            >
              {unit.occupiedYN ? 'Occupied' : 'Available'}
            </Badge>
          </div>
          
          <div className="text-sm text-gray-600 mb-2">
            <Highlighter
              highlightClassName="bg-yellow-200"
              searchWords={searchTerm ? searchTerm.split(' ') : []}
              textToHighlight={unit.size || 'Studio'}
            />
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
    </div>
  );
});

UnitCard.displayName = 'UnitCard';

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export default function FloorPlansPage() {
  const [selectedCampus, setSelectedCampus] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [bedroomsFilter, setBedroomsFilter] = useState<string>("any");
  const [floorPlanFilter, setFloorPlanFilter] = useState<string>("any");
  const [sqftFilter, setSqftFilter] = useState<string>("any");
  const [careLevelFilter, setCareLevelFilter] = useState<string>("any");
  const [highlightedUnitId, setHighlightedUnitId] = useState<string | null>(null);
  const [selectedUnitIndex, setSelectedUnitIndex] = useState<number>(0);
  const [isFilterOpen, setIsFilterOpen] = useState(true); // For desktop collapsible
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false); // For mobile sheet
  const [, setLocation] = useLocation();
  const unitListRef = useRef<HTMLDivElement>(null);

  // Debounced search term for performance
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

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

  // Get unique floor plan types from the data - memoized for performance
  const uniqueFloorPlans = useMemo(() => {
    const plans = new Set(rentRollData
      .map((u: any) => u.size || '')
      .filter((size: string) => size));
    return Array.from(plans).sort();
  }, [rentRollData]);

  // Get unique care levels from the data - memoized for performance
  const uniqueCareLevels = useMemo(() => {
    const levels = new Set(rentRollData
      .map((u: any) => u.serviceLine || '')
      .filter((line: string) => line));
    return Array.from(levels).sort();
  }, [rentRollData]);

  // Calculate active filter count for badge
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (bedroomsFilter !== "any") count++;
    if (floorPlanFilter !== "any") count++;
    if (sqftFilter !== "any") count++;
    if (careLevelFilter !== "any") count++;
    if (debouncedSearchTerm) count++;
    return count;
  }, [bedroomsFilter, floorPlanFilter, sqftFilter, careLevelFilter, debouncedSearchTerm]);

  // Filter units based on selected filters and search term - optimized with useMemo
  const filteredUnits = useMemo(() => {
    return rentRollData.filter((unit: any) => {
      // Search filter
      if (debouncedSearchTerm) {
        const searchLower = debouncedSearchTerm.toLowerCase();
        const roomNumberMatch = unit.roomNumber?.toLowerCase().includes(searchLower);
        const serviceLineMatch = unit.serviceLine?.toLowerCase().includes(searchLower);
        const sizeMatch = unit.size?.toLowerCase().includes(searchLower);
        const serviceLineDisplayMatch = getServiceLineDisplay(unit.serviceLine).toLowerCase().includes(searchLower);
        
        if (!roomNumberMatch && !serviceLineMatch && !sizeMatch && !serviceLineDisplayMatch) {
          return false;
        }
      }

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
      
      // Square footage filter
      if (sqftFilter !== "any") {
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
  }, [rentRollData, bedroomsFilter, floorPlanFilter, sqftFilter, careLevelFilter, debouncedSearchTerm]);

  // Reset selected unit index when filters change
  useEffect(() => {
    setSelectedUnitIndex(0);
  }, [filteredUnits]);

  // Keyboard navigation for unit cards
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (!filteredUnits.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedUnitIndex((prev) => Math.min(prev + 1, filteredUnits.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedUnitIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && filteredUnits[selectedUnitIndex]) {
        e.preventDefault();
        handleUnitClick(filteredUnits[selectedUnitIndex].id);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [filteredUnits, selectedUnitIndex]);

  // Update highlighted unit when using keyboard navigation
  useEffect(() => {
    if (filteredUnits[selectedUnitIndex]) {
      setHighlightedUnitId(filteredUnits[selectedUnitIndex].id);
    }
  }, [selectedUnitIndex, filteredUnits]);

  const handleResetFilters = useCallback(() => {
    setSearchTerm("");
    setBedroomsFilter("any");
    setFloorPlanFilter("any");
    setSqftFilter("any");
    setCareLevelFilter("any");
    setSelectedUnitIndex(0);
  }, []);

  const handleUnitClick = useCallback((unitId: string) => {
    setHighlightedUnitId(unitId);
    const index = filteredUnits.findIndex((u: any) => u.id === unitId);
    if (index !== -1) {
      setSelectedUnitIndex(index);
    }
  }, [filteredUnits]);

  // Helper function to get bedroom/bath count from size string - memoized
  const parseUnitDetails = useCallback((size: string) => {
    const lowerSize = size?.toLowerCase() || '';
    const beds = 
      lowerSize.includes('studio') || lowerSize.includes('companion') ? 'Studio' :
      lowerSize.includes('one bedroom') || lowerSize.includes('1 bedroom') ? '1 Bed' :
      lowerSize.includes('two bedroom') || lowerSize.includes('2 bedroom') ? '2 Bed' :
      lowerSize.includes('three bedroom') || lowerSize.includes('3 bedroom') ? '3 Bed' : 'Studio';
    
    const baths = beds === 'Studio' ? '1 Bath' :
                  beds === '1 Bed' ? '1 Bath' :
                  beds === '2 Bed' ? '2 Bath' : '2 Bath';
    
    const sqft = 
      beds === 'Studio' ? '450' :
      beds === '1 Bed' ? '750' :
      beds === '2 Bed' ? '1,180' : '1,500';
    
    return { beds, baths, sqft };
  }, []);

  // Helper to get service line display name - memoized
  const getServiceLineDisplay = useCallback((serviceLine: string) => {
    switch(serviceLine) {
      case 'AL': return 'Assisted Living';
      case 'AL/MC': return 'Assisted Living / Memory Care';
      case 'HC': return 'Health Care';
      case 'HC/MC': return 'Health Care / Memory Care';
      case 'IL': return 'Independent Living';
      case 'SL': return 'Senior Living';
      default: return serviceLine;
    }
  }, []);

  // Filter controls component - reusable for both desktop and mobile
  const FilterControls = () => (
    <>
      {/* Search Input */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          type="text"
          placeholder="Search by room number, service line, or type..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 pr-10"
          data-testid="input-search"
        />
        {searchTerm && (
          <button
            onClick={() => setSearchTerm("")}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

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

        {/* Reset Button with active filter count badge */}
        <Button 
          variant="outline"
          onClick={handleResetFilters}
          className="w-full relative"
          data-testid="button-reset-filters"
        >
          Reset Filters
          {activeFilterCount > 0 && (
            <Badge className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center p-0 bg-blue-500">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </div>
    </>
  );

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
                <span className="hidden sm:inline">Back</span>
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setLocation(selectedCampus ? `/floor-plans-admin?campus=${selectedCampus}` : '/floor-plans-admin')}
                className="hover:bg-gray-100"
                data-testid="button-admin"
              >
                <Settings className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Admin</span>
              </Button>
              
              {/* Mobile Filter Button */}
              <Sheet open={isMobileFilterOpen} onOpenChange={setIsMobileFilterOpen}>
                <SheetTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="lg:hidden"
                    data-testid="button-mobile-filters"
                  >
                    <Filter className="h-4 w-4 mr-2" />
                    Filters
                    {activeFilterCount > 0 && (
                      <Badge className="ml-2 bg-blue-500">
                        {activeFilterCount}
                      </Badge>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[300px] sm:w-[400px]">
                  <SheetHeader>
                    <SheetTitle>Filters</SheetTitle>
                  </SheetHeader>
                  <div className="mt-6">
                    <FilterControls />
                  </div>
                </SheetContent>
              </Sheet>
            </div>
            
            <Select value={selectedCampus} onValueChange={setSelectedCampus}>
              <SelectTrigger className="w-[150px] sm:w-64" data-testid="select-campus">
                <SelectValue placeholder="Select campus..." />
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
            <h1 className="text-2xl sm:text-3xl font-light text-gray-900 mb-2">
              Explore Floor Plans
            </h1>
            <p className="text-sm sm:text-base text-gray-600">
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
            <div className="lg:col-span-1">
              <div className="sticky top-4 space-y-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
                {/* Desktop Filter Section - Collapsible and Sticky */}
                <div className="hidden lg:block">
                  <Card className="shadow-sm transition-all duration-300">
                    <Collapsible open={isFilterOpen} onOpenChange={setIsFilterOpen}>
                      <CollapsibleTrigger className="w-full">
                        <CardContent className="p-6 pb-4">
                          <div className="flex justify-between items-center">
                            <h3 className="text-lg font-medium text-gray-900">
                              Filters
                              {activeFilterCount > 0 && (
                                <Badge className="ml-2 bg-blue-500">
                                  {activeFilterCount} active
                                </Badge>
                              )}
                            </h3>
                            <ChevronDown className={`h-4 w-4 transition-transform ${isFilterOpen ? 'rotate-180' : ''}`} />
                          </div>
                        </CardContent>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <CardContent className="p-6 pt-0">
                          <FilterControls />
                        </CardContent>
                      </CollapsibleContent>
                    </Collapsible>
                  </Card>
                </div>

                {/* Unit List Section */}
                <Card className="shadow-sm">
                  <CardContent className="p-6">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">
                      {filteredUnits.length} {filteredUnits.length === 1 ? 'Match' : 'Matches'}
                    </h3>
                    
                    {/* No results message */}
                    {filteredUnits.length === 0 && !isLoadingUnits ? (
                      <div className="text-center py-12">
                        <AlertCircle className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-500 mb-4">
                          No units found matching your criteria
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleResetFilters}
                          data-testid="button-reset-filters-empty"
                        >
                          Clear all filters
                        </Button>
                      </div>
                    ) : (
                      <ScrollArea className="h-[500px] pr-4">
                        {isLoadingUnits ? (
                          <div className="space-y-3">
                            {[...Array(5)].map((_, i) => (
                              <Skeleton key={i} className="h-32 w-full animate-pulse" />
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-3" ref={unitListRef}>
                            {filteredUnits.map((unit: any, index: number) => {
                              const details = parseUnitDetails(unit.size);
                              const rate = unit.streetRate || unit.moduloSuggestedRate || unit.rentAndCareRate || 0;
                              
                              return (
                                <UnitCard
                                  key={unit.id}
                                  unit={unit}
                                  details={details}
                                  rate={rate}
                                  isHighlighted={highlightedUnitId === unit.id || selectedUnitIndex === index}
                                  onClick={() => handleUnitClick(unit.id)}
                                  searchTerm={debouncedSearchTerm}
                                  getServiceLineDisplay={getServiceLineDisplay}
                                />
                              );
                            })}
                          </div>
                        )}
                      </ScrollArea>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Right Column - Floor Plan Viewer (2/3 width) */}
            <div className="lg:col-span-2">
              <Card className="shadow-sm h-full min-h-[400px] lg:min-h-[700px]">
                <CardContent className="p-0 h-full">
                  {isLoadingMap ? (
                    <div className="h-full flex items-center justify-center bg-gray-50">
                      <div className="text-center">
                        <Skeleton className="h-16 w-16 rounded-full mx-auto mb-4 animate-pulse" />
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