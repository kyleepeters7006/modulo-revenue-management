import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ChevronDown, X, Sparkles, Target, Loader2, Save } from "lucide-react";
import Navigation from "@/components/navigation";
import PricingWeights from "@/components/dashboard/pricing-weights";
import { NaturalLanguageAdjustments } from "@/components/dashboard/natural-language-adjustments";
import AdjustmentRanges from "@/components/dashboard/adjustment-ranges";
import GuardrailsEditor from "@/components/dashboard/guardrails-editor";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

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

interface TargetGrowth {
  AL: string;
  HC: string;
  IL: string;
  "AL/MC": string;
  "HC/MC": string;
  SL: string;
}

interface GeneratedSettings {
  weights: {
    occupancyPressure: number;
    daysVacantDecay: number;
    competitorRates: number;
    seasonality: number;
    stockMarket: number;
    inquiryTourVolume: number;
  };
  guardrails: {
    maxIncreasePercent: number;
    maxDecreasePercent: number;
    minStreetRate: number;
    maxStreetRate: number;
  };
  attributeAdjustments: Record<string, number>;
  reasoning: string;
}

export default function PricingControls() {
  const { toast } = useToast();
  const urlParams = new URLSearchParams(window.location.search);
  const urlLocation = urlParams.get('location');
  const urlServiceLine = urlParams.get('serviceLine');
  
  const savedFilters = loadFiltersFromStorage();
  const [selectedServiceLine, setSelectedServiceLine] = useState<string>(
    urlServiceLine || savedFilters?.serviceLine || "All"
  );
  const [selectedRegions, setSelectedRegions] = useState<string[]>(savedFilters?.regions || []);
  const [selectedDivisions, setSelectedDivisions] = useState<string[]>(savedFilters?.divisions || []);
  const [selectedLocations, setSelectedLocations] = useState<string[]>(
    urlLocation ? [urlLocation] : (savedFilters?.locations || [])
  );

  const [targetGrowth, setTargetGrowth] = useState<TargetGrowth>({
    AL: "5",
    HC: "3",
    IL: "4",
    "AL/MC": "5",
    "HC/MC": "3",
    SL: "4"
  });
  const [generatedSettings, setGeneratedSettings] = useState<GeneratedSettings | null>(null);

  const generateSettingsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/pricing/targets/generate", "POST", {
        targets: targetGrowth,
        filters: {
          serviceLine: selectedServiceLine === "All" ? null : selectedServiceLine,
          regions: selectedRegions.length > 0 ? selectedRegions : null,
          divisions: selectedDivisions.length > 0 ? selectedDivisions : null,
          locations: selectedLocations.length > 0 ? selectedLocations : null
        }
      });
      return response.json();
    },
    onSuccess: (data) => {
      setGeneratedSettings(data);
      queryClient.invalidateQueries({ queryKey: ["/api/pricing/weights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/guardrails"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attribute-ratings"] });
      toast({
        title: "Settings Generated",
        description: "AI has analyzed your portfolio and generated optimized settings.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate AI settings. Please try again.",
        variant: "destructive"
      });
    }
  });

  const saveTargetsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/pricing/targets/save", "POST", {
        targets: targetGrowth,
        filters: {
          serviceLine: selectedServiceLine === "All" ? null : selectedServiceLine,
          regions: selectedRegions.length > 0 ? selectedRegions : null,
          divisions: selectedDivisions.length > 0 ? selectedDivisions : null,
          locations: selectedLocations.length > 0 ? selectedLocations : null
        }
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Targets Saved",
        description: `Successfully saved targets for ${data.locationsAffected} location(s) and ${data.serviceLines.length} service line(s).`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save revenue growth targets. Please try again.",
        variant: "destructive"
      });
    }
  });

  const handleTargetChange = (serviceLine: keyof TargetGrowth, value: string) => {
    const numValue = value.replace(/[^0-9.]/g, '');
    if (numValue === '' || (parseFloat(numValue) >= 0 && parseFloat(numValue) <= 25)) {
      setTargetGrowth(prev => ({ ...prev, [serviceLine]: numValue }));
    }
  };

  useEffect(() => {
    const filters = {
      serviceLine: selectedServiceLine,
      regions: selectedRegions,
      divisions: selectedDivisions,
      locations: selectedLocations
    };
    saveFiltersToStorage(filters);
  }, [selectedServiceLine, selectedRegions, selectedDivisions, selectedLocations]);

  const { data: locationsData } = useQuery<{
    locations?: Array<{ id: string; name: string }>;
    regions?: string[];
    divisions?: string[];
  }>({
    queryKey: ["/api/locations"],
  });

  const regions = locationsData?.regions || [];
  const divisions = locationsData?.divisions || [];
  const locations = locationsData?.locations?.map((loc) => loc.name) || [];

  const serviceLines = ["All", "AL", "HC", "IL", "AL/MC", "HC/MC", "SL"];

  const toggleSelection = (item: string, selected: string[], setSelected: (items: string[]) => void) => {
    if (selected.includes(item)) {
      setSelected(selected.filter(i => i !== item));
    } else {
      setSelected([...selected, item]);
    }
  };

  const removeSelection = (item: string, selected: string[], setSelected: (items: string[]) => void) => {
    setSelected(selected.filter(i => i !== item));
  };

  const clearAllSelection = (setSelected: (items: string[]) => void) => {
    setSelected([]);
  };

  const selectedLocationId = selectedLocations.length === 1 
    ? locationsData?.locations?.find((loc: any) => loc.name === selectedLocations[0])?.id 
    : undefined;

  const getScopeDescription = () => {
    if (selectedLocations.length === 0 && selectedServiceLine === "All") {
      return "Portfolio-wide defaults (applies to all locations and service lines)";
    }
    if (selectedLocations.length === 0 && selectedServiceLine !== "All") {
      return `Defaults for ${selectedServiceLine} service line (all locations)`;
    }
    if (selectedLocations.length === 1 && selectedServiceLine === "All") {
      return `All service lines at ${selectedLocations[0]}`;
    }
    if (selectedLocations.length === 1 && selectedServiceLine !== "All") {
      return `${selectedServiceLine} at ${selectedLocations[0]}`;
    }
    if (selectedLocations.length > 1) {
      return `${selectedLocations.length} locations selected - settings saved individually for each`;
    }
    return "Custom scope";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 pb-20 sm:py-8 sm:pb-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2" data-testid="text-page-title">
            Dynamic Pricing Controls
          </h1>
          <p className="text-sm sm:text-base text-gray-600" data-testid="text-page-subtitle">
            Configure pricing weights and guardrails for the Modulo algorithm
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                      {regions.map((region: string) => (
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
                      {divisions.map((division: string) => (
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
                      {locations.map((location: string) => (
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

            {/* Scope Indicator */}
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-600">Settings Scope:</span>
                <Badge variant="secondary" className="text-sm" data-testid="badge-scope">
                  {getScopeDescription()}
                </Badge>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {selectedLocations.length > 1 
                  ? "Note: Select a single location to configure specific settings. Currently showing portfolio defaults."
                  : "Settings saved at this level will apply to matching units during rate calculations."}
              </p>
            </div>
          </div>
        </div>

        {/* Target Annual Revenue Growth Section */}
        <Card className="mb-6" data-testid="card-target-growth">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-lg">Target Annual Revenue Growth</CardTitle>
            </div>
            <CardDescription>
              Set your target annual revenue growth percentage for each service line. AI will optimize weights, attributes, and guardrails to help achieve these targets.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Target % inputs for each service line */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {(["AL", "HC", "IL", "AL/MC", "HC/MC", "SL"] as const).map((sl) => {
                  const isDisabled = selectedServiceLine !== "All" && selectedServiceLine !== sl;
                  return (
                    <div key={sl} className={`space-y-1.5 ${isDisabled ? 'opacity-50' : ''}`}>
                      <label className="text-sm font-medium text-gray-700">{sl}</label>
                      <div className="relative">
                        <Input
                          type="text"
                          value={targetGrowth[sl]}
                          onChange={(e) => handleTargetChange(sl, e.target.value)}
                          disabled={isDisabled}
                          className="pr-8 text-right"
                          data-testid={`input-target-${sl.toLowerCase().replace('/', '-')}`}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Save and Generate Buttons */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pt-4 border-t border-gray-100">
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => saveTargetsMutation.mutate()}
                    disabled={saveTargetsMutation.isPending}
                    data-testid="button-save-targets"
                  >
                    {saveTargetsMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save Targets
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => generateSettingsMutation.mutate()}
                    disabled={generateSettingsMutation.isPending}
                    data-testid="button-generate-settings"
                  >
                    {generateSettingsMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Analyzing Portfolio...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        Generate Weights, Attribute Values & Guardrails
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  Save targets to apply to selected locations, or Generate to let AI optimize settings
                </p>
              </div>

              {/* Generated Settings Display */}
              {generatedSettings && (
                <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-100" data-testid="card-generated-results">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles className="h-4 w-4 text-blue-600" />
                    <h4 className="font-semibold text-gray-900">AI-Generated Recommendations</h4>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="bg-white/80 rounded-md p-3">
                      <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">Pricing Weights</h5>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between"><span>Occupancy Pressure:</span><span className="font-medium">{generatedSettings.weights.occupancyPressure}%</span></div>
                        <div className="flex justify-between"><span>Days Vacant Decay:</span><span className="font-medium">{generatedSettings.weights.daysVacantDecay}%</span></div>
                        <div className="flex justify-between"><span>Competitor Rates:</span><span className="font-medium">{generatedSettings.weights.competitorRates}%</span></div>
                        <div className="flex justify-between"><span>Seasonality:</span><span className="font-medium">{generatedSettings.weights.seasonality}%</span></div>
                        <div className="flex justify-between"><span>Stock Market:</span><span className="font-medium">{generatedSettings.weights.stockMarket}%</span></div>
                        <div className="flex justify-between"><span>Inquiry Volume:</span><span className="font-medium">{generatedSettings.weights.inquiryTourVolume}%</span></div>
                      </div>
                    </div>
                    
                    <div className="bg-white/80 rounded-md p-3">
                      <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">Guardrails</h5>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between"><span>Max Increase:</span><span className="font-medium">{generatedSettings.guardrails.maxIncreasePercent}%</span></div>
                        <div className="flex justify-between"><span>Max Decrease:</span><span className="font-medium">{generatedSettings.guardrails.maxDecreasePercent}%</span></div>
                        <div className="flex justify-between"><span>Min Street Rate:</span><span className="font-medium">${generatedSettings.guardrails.minStreetRate}</span></div>
                        <div className="flex justify-between"><span>Max Street Rate:</span><span className="font-medium">${generatedSettings.guardrails.maxStreetRate}</span></div>
                      </div>
                    </div>
                    
                    <div className="bg-white/80 rounded-md p-3">
                      <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">Attribute Adjustments</h5>
                      <div className="space-y-1 text-sm">
                        {Object.entries(generatedSettings.attributeAdjustments).slice(0, 5).map(([attr, val]) => (
                          <div key={attr} className="flex justify-between">
                            <span className="capitalize">{attr.replace(/([A-Z])/g, ' $1').trim()}:</span>
                            <span className={`font-medium ${val >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {val >= 0 ? '+' : ''}{val}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-white/80 rounded-md p-3">
                    <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">AI Reasoning</h5>
                    <p className="text-sm text-gray-700">{generatedSettings.reasoning}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6 sm:space-y-8">
          <PricingWeights 
            locationId={selectedLocationId} 
            serviceLine={selectedServiceLine === "All" ? undefined : selectedServiceLine}
          />
          <NaturalLanguageAdjustments 
            locationId={selectedLocationId}
            serviceLine={selectedServiceLine === "All" ? undefined : selectedServiceLine}
          />
          <AdjustmentRanges 
            locationId={selectedLocationId}
            serviceLine={selectedServiceLine === "All" ? undefined : selectedServiceLine}
          />
          <GuardrailsEditor 
            locationId={selectedLocationId}
            serviceLine={selectedServiceLine === "All" ? undefined : selectedServiceLine}
          />
        </div>
      </div>
    </div>
  );
}