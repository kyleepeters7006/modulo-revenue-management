import { useState, useEffect } from "react";
import Navigation from "@/components/navigation";
import { CompetitorMap } from "@/components/dashboard/competitor-map";
import CompetitorForm from "@/components/dashboard/competitor-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

// Helper functions for localStorage persistence - using shared key for cross-page sync
const saveCompetitorFiltersToStorage = (filters: any) => {
  try {
    localStorage.setItem('appFilters', JSON.stringify(filters));
  } catch (error) {
    console.warn('Failed to save competitor filters to localStorage:', error);
  }
};

const loadCompetitorFiltersFromStorage = () => {
  try {
    const stored = localStorage.getItem('appFilters');
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.warn('Failed to load competitor filters from localStorage:', error);
    return null;
  }
};

export default function CompetitorAnalysis() {
  // Check for URL parameters first
  const urlParams = new URLSearchParams(window.location.search);
  const urlLocation = urlParams.get('location');
  const urlServiceLine = urlParams.get('serviceLine');
  
  // Load initial state from URL params, then localStorage, or use defaults
  const savedFilters = loadCompetitorFiltersFromStorage();
  const [selectedRegions, setSelectedRegions] = useState<string[]>(savedFilters?.regions || []);
  const [selectedDivisions, setSelectedDivisions] = useState<string[]>(savedFilters?.divisions || []);
  const [selectedLocations, setSelectedLocations] = useState<string[]>(
    urlLocation ? [urlLocation] : (savedFilters?.locations || [])
  );
  // Support both URL param, savedFilters.serviceLines array, and singular serviceLine from other pages
  const initialServiceLines = urlServiceLine && urlServiceLine !== 'All' 
    ? [urlServiceLine] 
    : (savedFilters?.serviceLines?.length > 0 
        ? savedFilters.serviceLines 
        : (savedFilters?.serviceLine && savedFilters.serviceLine !== 'All' 
            ? [savedFilters.serviceLine] 
            : []));
  const [selectedServiceLines, setSelectedServiceLines] = useState<string[]>(initialServiceLines);

  // Save filters to localStorage whenever they change
  useEffect(() => {
    const filters = {
      serviceLine: "All", // Default service line for competitor page
      regions: selectedRegions,
      divisions: selectedDivisions,
      locations: selectedLocations,
      serviceLines: selectedServiceLines
    };
    saveCompetitorFiltersToStorage(filters);
  }, [selectedRegions, selectedDivisions, selectedLocations, selectedServiceLines]);

  // Fetch locations data for filters
  const { data: locationsData } = useQuery({
    queryKey: ["/api/locations"],
  });

  // Extract unique regions, divisions, and locations - sorted alphabetically
  const regions = (locationsData?.regions || []).sort((a, b) => a.localeCompare(b));
  const divisions = (locationsData?.divisions || []).sort((a, b) => a.localeCompare(b));
  const locations = (locationsData?.locations?.map((loc: any) => loc.name) || []).sort((a, b) => a.localeCompare(b));
  
  // Define service line options - matches backend serviceLineEnum
  const serviceLineOptions = ['HC', 'HC/MC', 'AL', 'AL/MC', 'SL', 'VIL'];

  // Helper functions for multi-select
  const toggleSelection = (value: string, currentSelection: string[], setter: (values: string[]) => void) => {
    if (currentSelection.includes(value)) {
      setter(currentSelection.filter(item => item !== value));
    } else {
      setter([...currentSelection, value]);
    }
  };

  const removeSelection = (value: string, currentSelection: string[], setter: (values: string[]) => void) => {
    setter(currentSelection.filter(item => item !== value));
  };

  const clearAllSelection = (setter: (values: string[]) => void) => {
    setter([]);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2" data-testid="text-page-title">
            Competitor Analysis
          </h1>
          <p className="text-gray-600" data-testid="text-page-subtitle">
            Geographic mapping and rate comparison with nearby competitors
          </p>
          
          {/* Filters */}
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Region Multi-Select */}
              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">Regions:</h3>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between"
                      data-testid="select-regions"
                    >
                      <span className="truncate">
                        {selectedRegions.length === 0
                          ? "All Regions"
                          : selectedRegions.length === 1
                          ? selectedRegions[0]
                          : `${selectedRegions.length} regions selected`}
                      </span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0">
                    <div className="p-4 space-y-2">
                      {selectedRegions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {selectedRegions.map((region) => (
                            <Badge key={region} variant="secondary" className="text-xs">
                              {region}
                              <X
                                className="h-3 w-3 ml-1 cursor-pointer"
                                onClick={() => removeSelection(region, selectedRegions, setSelectedRegions)}
                              />
                            </Badge>
                          ))}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => clearAllSelection(setSelectedRegions)}
                          >
                            Clear All
                          </Button>
                        </div>
                      )}
                      {regions.map((region) => (
                        <div key={region} className="flex items-center space-x-2">
                          <Checkbox
                            id={`region-${region}`}
                            checked={selectedRegions.includes(region)}
                            onCheckedChange={() => toggleSelection(region, selectedRegions, setSelectedRegions)}
                          />
                          <label htmlFor={`region-${region}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            {region}
                          </label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Division Multi-Select */}
              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">Divisions:</h3>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between"
                      data-testid="select-divisions"
                    >
                      <span className="truncate">
                        {selectedDivisions.length === 0
                          ? "All Divisions"
                          : selectedDivisions.length === 1
                          ? selectedDivisions[0]
                          : `${selectedDivisions.length} divisions selected`}
                      </span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0">
                    <div className="p-4 space-y-2">
                      {selectedDivisions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {selectedDivisions.map((division) => (
                            <Badge key={division} variant="secondary" className="text-xs">
                              {division}
                              <X
                                className="h-3 w-3 ml-1 cursor-pointer"
                                onClick={() => removeSelection(division, selectedDivisions, setSelectedDivisions)}
                              />
                            </Badge>
                          ))}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => clearAllSelection(setSelectedDivisions)}
                          >
                            Clear All
                          </Button>
                        </div>
                      )}
                      {divisions.map((division) => (
                        <div key={division} className="flex items-center space-x-2">
                          <Checkbox
                            id={`division-${division}`}
                            checked={selectedDivisions.includes(division)}
                            onCheckedChange={() => toggleSelection(division, selectedDivisions, setSelectedDivisions)}
                          />
                          <label htmlFor={`division-${division}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            {division}
                          </label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Location Multi-Select */}
              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">Locations:</h3>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between"
                      data-testid="select-locations"
                    >
                      <span className="truncate">
                        {selectedLocations.length === 0
                          ? "All Locations"
                          : selectedLocations.length === 1
                          ? selectedLocations[0]
                          : `${selectedLocations.length} locations selected`}
                      </span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0">
                    <div className="p-4 space-y-2 max-h-60 overflow-y-auto">
                      {selectedLocations.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {selectedLocations.map((location) => (
                            <Badge key={location} variant="secondary" className="text-xs">
                              {location}
                              <X
                                className="h-3 w-3 ml-1 cursor-pointer"
                                onClick={() => removeSelection(location, selectedLocations, setSelectedLocations)}
                              />
                            </Badge>
                          ))}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => clearAllSelection(setSelectedLocations)}
                          >
                            Clear All
                          </Button>
                        </div>
                      )}
                      {locations.map((location) => (
                        <div key={location} className="flex items-center space-x-2">
                          <Checkbox
                            id={`location-${location}`}
                            checked={selectedLocations.includes(location)}
                            onCheckedChange={() => toggleSelection(location, selectedLocations, setSelectedLocations)}
                          />
                          <label htmlFor={`location-${location}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            {location}
                          </label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Service Lines Multi-Select */}
              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">Service Lines:</h3>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between"
                      data-testid="select-service-lines"
                    >
                      <span className="truncate">
                        {selectedServiceLines.length === 0
                          ? "All Service Lines"
                          : selectedServiceLines.length === 1
                          ? selectedServiceLines[0]
                          : `${selectedServiceLines.length} service lines selected`}
                      </span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0">
                    <div className="p-4 space-y-2">
                      {selectedServiceLines.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {selectedServiceLines.map((serviceLine) => (
                            <Badge key={serviceLine} variant="secondary" className="text-xs">
                              {serviceLine}
                              <X
                                className="h-3 w-3 ml-1 cursor-pointer"
                                onClick={() => removeSelection(serviceLine, selectedServiceLines, setSelectedServiceLines)}
                              />
                            </Badge>
                          ))}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => clearAllSelection(setSelectedServiceLines)}
                          >
                            Clear All
                          </Button>
                        </div>
                      )}
                      {serviceLineOptions.map((serviceLine) => (
                        <div key={serviceLine} className="flex items-center space-x-2">
                          <Checkbox
                            id={`service-line-${serviceLine}`}
                            checked={selectedServiceLines.includes(serviceLine)}
                            onCheckedChange={() => toggleSelection(serviceLine, selectedServiceLines, setSelectedServiceLines)}
                          />
                          <label htmlFor={`service-line-${serviceLine}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            {serviceLine}
                          </label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile: Stack vertically */}
        <div className="block lg:hidden space-y-6">
          <CompetitorMap 
            selectedRegions={selectedRegions}
            selectedDivisions={selectedDivisions}
            selectedLocations={selectedLocations}
            selectedServiceLines={selectedServiceLines}
          />
          <CompetitorForm 
            selectedRegions={selectedRegions}
            selectedDivisions={selectedDivisions}
            selectedLocations={selectedLocations}
            selectedServiceLines={selectedServiceLines}
          />
        </div>
        
        {/* Desktop: Side by side */}
        <div className="hidden lg:grid lg:grid-cols-3 lg:gap-12">
          <div className="lg:col-span-2">
            <CompetitorMap 
              selectedRegions={selectedRegions}
              selectedDivisions={selectedDivisions}
              selectedLocations={selectedLocations}
              selectedServiceLines={selectedServiceLines}
            />
          </div>
          <div className="lg:col-span-1">
            <CompetitorForm 
              selectedRegions={selectedRegions}
              selectedDivisions={selectedDivisions}
              selectedLocations={selectedLocations}
              selectedServiceLines={selectedServiceLines}
            />
          </div>
        </div>
      </div>
    </div>
  );
}