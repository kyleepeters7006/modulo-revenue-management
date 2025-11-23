import { useState, useEffect } from "react";
import Navigation from "@/components/navigation";
import RateCardTable from "@/components/dashboard/rate-card-table";
import PricingHistory from "@/components/dashboard/pricing-history";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ChevronDown, X, Download, Calculator } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// Helper functions for localStorage persistence - using shared key for cross-page sync
const saveFiltersToStorage = (filters: any) => {
  try {
    localStorage.setItem('appFilters', JSON.stringify(filters));
  } catch (error) {
    console.warn('Failed to save filters to localStorage:', error);
  }
};

const loadFiltersFromStorage = () => {
  try {
    const stored = localStorage.getItem('appFilters');
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.warn('Failed to load filters from localStorage:', error);
    return null;
  }
};

export default function RateCard() {
  // Check for URL parameters first
  const urlParams = new URLSearchParams(window.location.search);
  const urlLocation = urlParams.get('location');
  const urlServiceLine = urlParams.get('serviceLine');
  const urlUnit = urlParams.get('unit');  // New parameter for specific unit filtering
  
  // Load initial state from URL params, then localStorage, or use defaults
  const savedFilters = loadFiltersFromStorage();
  const [selectedServiceLine, setSelectedServiceLine] = useState<string>(
    urlServiceLine || savedFilters?.serviceLine || "All"
  );
  const [selectedRegions, setSelectedRegions] = useState<string[]>(savedFilters?.regions || []);
  const [selectedDivisions, setSelectedDivisions] = useState<string[]>(savedFilters?.divisions || []);
  const [selectedLocations, setSelectedLocations] = useState<string[]>(
    urlLocation ? [urlLocation] : (savedFilters?.locations || [])
  );
  const [selectedUnit, setSelectedUnit] = useState<string | null>(urlUnit); // Track selected unit
  const [isExporting, setIsExporting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobProgress, setJobProgress] = useState<{
    percentage: number;
    current: number;
    total: number;
    message: string;
  } | null>(null);
  const { toast } = useToast();

  // Save filters to localStorage whenever they change
  useEffect(() => {
    const filters = {
      serviceLine: selectedServiceLine,
      regions: selectedRegions,
      divisions: selectedDivisions,
      locations: selectedLocations
    };
    saveFiltersToStorage(filters);
  }, [selectedServiceLine, selectedRegions, selectedDivisions, selectedLocations]);

  // Service line options - matches backend serviceLineEnum, plus "All" option
  const serviceLines = ["All", "HC", "HC/MC", "AL", "AL/MC", "SL", "VIL"];

  // Fetch locations data for filters
  const { data: locationsData } = useQuery({
    queryKey: ["/api/locations"],
  });

  // Extract unique regions, divisions, and locations - sorted alphabetically
  const regions = (locationsData?.regions || []).sort((a, b) => a.localeCompare(b));
  const divisions = (locationsData?.divisions || []).sort((a, b) => a.localeCompare(b));
  const locations = (locationsData?.locations?.map((loc: any) => loc.name) || []).sort((a, b) => a.localeCompare(b));

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

  // Function to check job status
  const checkJobStatus = async (jobId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/pricing/job-status/${jobId}`);
        const data = await response.json();
        
        console.log(`Job ${jobId} status:`, data.status, 'Progress:', data.progress);
        
        if (data.status === 'completed') {
          clearInterval(pollInterval);
          setIsGenerating(false);
          setJobProgress(null);
          toast({
            title: "Modulo Calculation Complete",
            description: `Successfully generated pricing for ${data.progress?.total || data.result?.totalUnits || 0} units.`,
          });
          // Invalidate rate card data to refresh the table
          queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
        } else if (data.status === 'failed') {
          clearInterval(pollInterval);
          setIsGenerating(false);
          setJobProgress(null);
          toast({
            title: "Calculation Failed",
            description: data.error || "Failed to generate Modulo pricing suggestions.",
            variant: "destructive",
          });
        } else if (data.status === 'processing') {
          // Update progress - handle the actual data structure
          const progress = data.progress || {};
          const percentage = progress.percentage || 0;
          const current = progress.current || 0;
          const total = progress.total || 0;
          
          // Generate appropriate message based on progress
          let message = 'Processing...';
          if (percentage > 0) {
            message = `Processing batch ${progress.currentBatch || 0} of ${progress.totalBatches || 0}`;
          } else {
            message = 'Initializing calculation...';
          }
          
          setJobProgress({
            percentage,
            current,
            total,
            message
          });
        }
      } catch (error) {
        console.error('Error checking job status:', error);
      }
    }, 2000); // Poll every 2 seconds
    
    // Return the interval so it can be cleared if needed
    return pollInterval;
  };

  // Generate Modulo mutation using optimized endpoint
  const generateModuloMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('/api/pricing/generate-modulo-optimized', 'POST', {
        month: '2025-10', // Using October 2025 as default month with data
        serviceLine: selectedServiceLine !== 'All' ? selectedServiceLine : undefined,
        regions: selectedRegions.length > 0 ? selectedRegions : undefined,
        divisions: selectedDivisions.length > 0 ? selectedDivisions : undefined,
        locations: selectedLocations.length > 0 ? selectedLocations : undefined,
      });
      return response;
    },
    onMutate: () => {
      setIsGenerating(true);
      setJobProgress({
        percentage: 0,
        current: 0,
        total: 0,
        message: 'Starting calculation...'
      });
    },
    onSuccess: (data) => {
      if (data.jobId) {
        toast({
          title: "Calculation Started",
          description: "Processing pricing suggestions in the background...",
        });
        // Start polling for job status
        checkJobStatus(data.jobId);
      }
    },
    onError: (error) => {
      setIsGenerating(false);
      setJobProgress(null);
      toast({
        title: "Calculation Failed",
        description: "Failed to start Modulo pricing calculation. Please try again.",
        variant: "destructive",
      });
      console.error('Generate Modulo error:', error);
    },
  });

  // Export handler
  const handleExport = async () => {
    try {
      setIsExporting(true);
      
      // Build query parameters
      const params = new URLSearchParams();
      if (selectedRegions.length > 0) {
        selectedRegions.forEach(region => params.append('regions', region));
      }
      if (selectedDivisions.length > 0) {
        selectedDivisions.forEach(division => params.append('divisions', division));
      }
      if (selectedLocations.length > 0) {
        selectedLocations.forEach(location => params.append('locations', location));
      }
      
      // Fetch the export
      const response = await fetch(`/api/export/rate-card?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error('Export failed');
      }
      
      // Get the filename from the Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = 'rate-card-export.csv';
      if (contentDisposition) {
        const matches = /filename="([^"]+)"/.exec(contentDisposition);
        if (matches && matches[1]) {
          filename = matches[1];
        }
      }
      
      // Create a blob and download it
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "Export Successful",
        description: `Rate card data exported to ${filename}`,
      });
    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: "Export Failed",
        description: "Failed to export rate card data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2" data-testid="text-page-title">
                Rate Card & Pricing
              </h1>
              <p className="text-gray-600" data-testid="text-page-subtitle">
                Review current rates, Modulo suggestions, and AI recommendations
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button 
                onClick={handleExport}
                disabled={isExporting}
                variant="outline"
                className="flex items-center gap-2"
                data-testid="button-export-rate-card"
              >
                <Download className="h-4 w-4" />
                {isExporting ? 'Exporting...' : 'Export to CSV'}
              </Button>
              {jobProgress && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium text-blue-900">{jobProgress.message}</span>
                    <span className="text-sm text-blue-700">
                      {jobProgress.current} / {jobProgress.total} units ({jobProgress.percentage}%)
                    </span>
                  </div>
                  <Progress value={jobProgress.percentage} className="h-2" />
                </div>
              )}
            </div>
          </div>
          
          {/* Filters */}
          <div className="mt-6 space-y-4">
            {/* Region, Division, Location Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                    <div className="p-4 space-y-2">
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
            </div>

            {/* Service Line Filter */}
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-3">Service Line:</h3>
              <div className="flex flex-wrap gap-2">
                {serviceLines.map((serviceLine) => (
                  <Button
                    key={serviceLine}
                    variant={selectedServiceLine === serviceLine ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedServiceLine(serviceLine)}
                    data-testid={`button-serviceline-${serviceLine.toLowerCase()}`}
                    className="text-xs"
                  >
                    {serviceLine === "All" ? "All Service Lines" : serviceLine}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <RateCardTable 
          selectedServiceLine={selectedServiceLine}
          selectedRegions={selectedRegions}
          selectedDivisions={selectedDivisions}
          selectedLocations={selectedLocations}
          selectedUnit={selectedUnit}
        />

        {/* Pricing Change History */}
        <div className="mt-8">
          <PricingHistory />
        </div>
      </div>
    </div>
  );
}