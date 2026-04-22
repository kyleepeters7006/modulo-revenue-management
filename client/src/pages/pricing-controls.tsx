import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ChevronDown, X, Sparkles, Target, Loader2, Save, Check, Info } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  HC: string;
  "HC/MC": string;
  AL: string;
  "AL/MC": string;
  SL: string;
  VIL: string;
}

interface WeightExplanation {
  value: number;
  reason: string;
  metric?: string;
}

interface SettingsMetrics {
  occupancyRate: number;
  avgDaysVacant: number;
  competitorRate: number;
  avgPortfolioRate: number;
  salesVelocity: number;
  netChange: number;
  totalUnits: number;
  vacantUnits: number;
  unitsOver30DaysVacant: number;
  unitsOver60DaysVacant: number;
}

interface IndividualResult {
  locationId: string;
  locationName: string;
  serviceLine: string;
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
  adjustmentRanges?: {
    occupancyMin: number;
    occupancyMax: number;
    vacancyMin: number;
    vacancyMax: number;
    attributesMin: number;
    attributesMax: number;
    seasonalityMin: number;
    seasonalityMax: number;
    competitorMin: number;
    competitorMax: number;
  };
  attributeAdjustments: Record<string, number>;
  reasoning: string;
  metrics: SettingsMetrics;
}

interface GeneratedSettings {
  mode: 'portfolio' | 'individual';
  weights: {
    occupancyPressure: number;
    daysVacantDecay: number;
    competitorRates: number;
    seasonality: number;
    stockMarket: number;
    inquiryTourVolume: number;
  };
  weightExplanations?: {
    occupancyPressure?: WeightExplanation;
    daysVacantDecay?: WeightExplanation;
    competitorRates?: WeightExplanation;
    seasonality?: WeightExplanation;
    stockMarket?: WeightExplanation;
    inquiryTourVolume?: WeightExplanation;
  };
  guardrails: {
    maxIncreasePercent: number;
    maxDecreasePercent: number;
    minStreetRate: number;
    maxStreetRate: number;
  };
  adjustmentRanges?: {
    occupancyMin: number;
    occupancyMax: number;
    vacancyMin: number;
    vacancyMax: number;
    attributesMin: number;
    attributesMax: number;
    seasonalityMin: number;
    seasonalityMax: number;
    competitorMin: number;
    competitorMax: number;
  };
  attributeAdjustments: Record<string, number>;
  reasoning: string;
  metrics?: SettingsMetrics;
  individuals?: IndividualResult[];
  scopeCount?: number;
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
    HC: "3",
    "HC/MC": "3",
    AL: "5",
    "AL/MC": "5",
    SL: "4",
    VIL: "4"
  });
  const [generatedSettings, setGeneratedSettings] = useState<GeneratedSettings | null>(null);
  
  // Analyze individually toggle
  const [analyzeIndividually, setAnalyzeIndividually] = useState<boolean>(() => {
    try {
      return localStorage.getItem('analyzeIndividually') === 'true';
    } catch {
      return false;
    }
  });
  
  // Category toggles for applying recommendations
  const [enabledCategories, setEnabledCategories] = useState({
    weights: true,
    guardrails: true,
    adjustmentRanges: true
  });

  // Save analyzeIndividually to localStorage when changed
  const handleAnalyzeIndividuallyChange = (checked: boolean) => {
    setAnalyzeIndividually(checked);
    try {
      localStorage.setItem('analyzeIndividually', checked ? 'true' : 'false');
    } catch {}
  };

  const generateSettingsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/pricing/targets/generate", "POST", {
        targets: targetGrowth,
        analyzeIndividually,
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

  const applyRecommendationsMutation = useMutation({
    mutationFn: async () => {
      if (!generatedSettings) throw new Error("No recommendations to apply");
      
      // Build filtered recommendations based on enabled categories
      const filteredRecommendations: Partial<GeneratedSettings> = {
        reasoning: generatedSettings.reasoning,
        mode: generatedSettings.mode
      };
      if (enabledCategories.weights) {
        filteredRecommendations.weights = generatedSettings.weights;
      }
      if (enabledCategories.guardrails) {
        filteredRecommendations.guardrails = generatedSettings.guardrails;
      }
      if (enabledCategories.adjustmentRanges && generatedSettings.adjustmentRanges) {
        filteredRecommendations.adjustmentRanges = generatedSettings.adjustmentRanges;
      }
      
      // Include individual results for individual mode (only if at least one category is enabled)
      if (generatedSettings.mode === 'individual' && generatedSettings.individuals) {
        const hasEnabledCategory = enabledCategories.weights || enabledCategories.guardrails || enabledCategories.adjustmentRanges;
        if (hasEnabledCategory) {
          filteredRecommendations.individuals = generatedSettings.individuals.map(ind => {
            const filtered: Partial<IndividualResult> = {
              locationId: ind.locationId,
              locationName: ind.locationName,
              serviceLine: ind.serviceLine
            };
            if (enabledCategories.weights && ind.weights) filtered.weights = ind.weights;
            if (enabledCategories.guardrails && ind.guardrails) filtered.guardrails = ind.guardrails;
            if (enabledCategories.adjustmentRanges && ind.adjustmentRanges) filtered.adjustmentRanges = ind.adjustmentRanges;
            return filtered as IndividualResult;
          });
        }
      }
      
      const response = await apiRequest("/api/pricing/targets/apply", "POST", {
        recommendations: filteredRecommendations,
        enabledCategories,
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
      // Invalidate all related queries to refresh UI
      queryClient.invalidateQueries({ queryKey: ["/api/pricing/weights"] });
      queryClient.invalidateQueries({ queryKey: ["/api/guardrails"] });
      queryClient.invalidateQueries({ queryKey: ["/api/adjustment-ranges"] });
      queryClient.invalidateQueries({ queryKey: ["/api/attribute-ratings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/weights"] });
      
      const appliedItems: string[] = [];
      if (data.weightsUpdated > 0) appliedItems.push(`${data.weightsUpdated} weights`);
      if (data.guardrailsUpdated > 0) appliedItems.push(`${data.guardrailsUpdated} guardrails`);
      if (data.adjustmentRangesUpdated > 0) appliedItems.push(`${data.adjustmentRangesUpdated} adjustment ranges`);
      
      const modeLabel = data.mode === 'individual' ? ' (individual settings)' : '';
      toast({
        title: "Recommendations Applied",
        description: appliedItems.length > 0 
          ? `Applied to ${data.locationsAffected} location(s)${modeLabel}: ${appliedItems.join(', ')} updated.`
          : "No changes were applied.",
      });
      setGeneratedSettings(null);
    },
    onError: (error: any) => {
      toast({
        title: "Apply Failed",
        description: error.message || "Failed to apply recommendations. Please try again.",
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

  // Build query string for fetching targets
  const targetsQueryParams = new URLSearchParams();
  if (selectedServiceLine !== "All") targetsQueryParams.set("serviceLine", selectedServiceLine);
  if (selectedRegions.length > 0) targetsQueryParams.set("regions", selectedRegions.join(","));
  if (selectedDivisions.length > 0) targetsQueryParams.set("divisions", selectedDivisions.join(","));
  if (selectedLocations.length > 0) targetsQueryParams.set("locations", selectedLocations.join(","));
  
  // Fetch saved targets based on current filters
  const { data: savedTargetsData } = useQuery<{
    targets: Record<string, string>;
    locationsMatched: number;
    hasData: boolean;
  }>({
    queryKey: ["/api/pricing/targets", targetsQueryParams.toString()],
    queryFn: async () => {
      const response = await fetch(`/api/pricing/targets?${targetsQueryParams.toString()}`);
      return response.json();
    }
  });

  // Update target growth when saved targets are loaded
  useEffect(() => {
    if (savedTargetsData?.hasData && savedTargetsData.targets) {
      setTargetGrowth(prev => {
        const updated = { ...prev };
        for (const [sl, value] of Object.entries(savedTargetsData.targets)) {
          if (sl in updated) {
            updated[sl as keyof TargetGrowth] = value;
          }
        }
        return updated;
      });
    }
  }, [savedTargetsData]);

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

  const serviceLines = ["All", "HC", "HC/MC", "AL", "AL/MC", "SL", "VIL"];

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
                {(["HC", "HC/MC", "AL", "AL/MC", "SL", "VIL"] as const).map((sl) => {
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
              <div className="flex flex-col gap-4 pt-4 border-t border-gray-100">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
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
                          {analyzeIndividually ? 'Analyzing Each Scope...' : 'Analyzing Portfolio...'}
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
                
                {/* Analyze Individually Checkbox */}
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <Checkbox
                    id="analyze-individually"
                    checked={analyzeIndividually}
                    onCheckedChange={(checked) => handleAnalyzeIndividuallyChange(checked === true)}
                    data-testid="checkbox-analyze-individually"
                  />
                  <div>
                    <Label htmlFor="analyze-individually" className="text-sm font-medium cursor-pointer">
                      Analyze Locations/Service Lines Individually
                    </Label>
                    <p className="text-xs text-gray-500 mt-0.5">
                      When enabled, AI will generate specific recommendations for each location and service line combination. Displayed values show averages; individual settings are applied when saved.
                    </p>
                  </div>
                </div>
              </div>

              {/* Generated Settings Display */}
              {generatedSettings && (
                <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-100" data-testid="card-generated-results">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-blue-600" />
                      <h4 className="font-semibold text-gray-900">AI-Generated Recommendations</h4>
                      {generatedSettings.mode === 'individual' && generatedSettings.scopeCount && (
                        <Badge variant="secondary" className="text-xs">
                          {generatedSettings.scopeCount} scopes analyzed • Showing averages
                        </Badge>
                      )}
                    </div>
                    <Button
                      onClick={() => applyRecommendationsMutation.mutate()}
                      disabled={applyRecommendationsMutation.isPending}
                      className="bg-green-600 hover:bg-green-700"
                      data-testid="button-apply-recommendations"
                    >
                      {applyRecommendationsMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Applying...
                        </>
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          Apply Recommendations
                        </>
                      )}
                    </Button>
                  </div>
                  
                  {generatedSettings.mode === 'individual' && (
                    <p className="text-xs text-blue-700 bg-blue-100 p-2 rounded mb-3">
                      Individual settings will be saved for each location/service line combination when applied.
                    </p>
                  )}
                  
                  <p className="text-xs text-gray-600 mb-3">Toggle categories on/off to control which settings will be applied:</p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                    {/* Pricing Weights */}
                    <div className={`rounded-md p-3 border-2 transition-all ${enabledCategories.weights ? 'bg-white/80 border-blue-200' : 'bg-gray-100/50 border-gray-200 opacity-60'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="text-xs font-medium text-gray-500 uppercase">Pricing Weights</h5>
                        <Switch
                          checked={enabledCategories.weights}
                          onCheckedChange={(checked) => setEnabledCategories(prev => ({ ...prev, weights: checked }))}
                          data-testid="toggle-weights"
                        />
                      </div>
                      <TooltipProvider>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between items-center">
                            <span className="flex items-center gap-1">
                              Occupancy Pressure:
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3 w-3 text-gray-400 cursor-help hover:text-blue-500" />
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-xs p-2">
                                  <p className="text-xs font-medium mb-1">Occupancy: {generatedSettings.metrics?.occupancyRate ?? '—'}%</p>
                                  <p className="text-xs text-gray-600">Higher weight when occupancy is low to push for competitive pricing. Current: {generatedSettings.metrics?.totalUnits ?? '—'} units, {generatedSettings.metrics?.vacantUnits ?? '—'} vacant.</p>
                                </TooltipContent>
                              </Tooltip>
                            </span>
                            <span className="font-medium">{generatedSettings.weights.occupancyPressure}%</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="flex items-center gap-1">
                              Days Vacant Decay:
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3 w-3 text-gray-400 cursor-help hover:text-blue-500" />
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-xs p-2">
                                  <p className="text-xs font-medium mb-1">Avg Days Vacant: {generatedSettings.metrics?.avgDaysVacant ?? '—'}</p>
                                  <p className="text-xs text-gray-600">Higher weight when units stay vacant longer. Units 30+ days: {generatedSettings.metrics?.unitsOver30DaysVacant ?? '—'}, 60+ days: {generatedSettings.metrics?.unitsOver60DaysVacant ?? '—'}.</p>
                                </TooltipContent>
                              </Tooltip>
                            </span>
                            <span className="font-medium">{generatedSettings.weights.daysVacantDecay}%</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="flex items-center gap-1">
                              Competitor Rates:
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3 w-3 text-gray-400 cursor-help hover:text-blue-500" />
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-xs p-2">
                                  <p className="text-xs font-medium mb-1">Avg Competitor Rate: ${generatedSettings.metrics?.competitorRate ?? '—'}</p>
                                  <p className="text-xs text-gray-600">Weight based on available competitor data. Lower weight when data is sparse or when current rates are already well-positioned.</p>
                                </TooltipContent>
                              </Tooltip>
                            </span>
                            <span className="font-medium">{generatedSettings.weights.competitorRates}%</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="flex items-center gap-1">
                              Seasonality:
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3 w-3 text-gray-400 cursor-help hover:text-blue-500" />
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-xs p-2">
                                  <p className="text-xs font-medium mb-1">Seasonal Factor</p>
                                  <p className="text-xs text-gray-600">Adjusts for seasonal demand patterns. Spring/fall typically higher demand in senior living.</p>
                                </TooltipContent>
                              </Tooltip>
                            </span>
                            <span className="font-medium">{generatedSettings.weights.seasonality}%</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="flex items-center gap-1">
                              Stock Market:
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3 w-3 text-gray-400 cursor-help hover:text-blue-500" />
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-xs p-2">
                                  <p className="text-xs font-medium mb-1">Market Conditions</p>
                                  <p className="text-xs text-gray-600">Economic indicator weight. Lower weight as this is a secondary factor in senior living pricing.</p>
                                </TooltipContent>
                              </Tooltip>
                            </span>
                            <span className="font-medium">{generatedSettings.weights.stockMarket}%</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="flex items-center gap-1">
                              Inquiry Volume:
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Info className="h-3 w-3 text-gray-400 cursor-help hover:text-blue-500" />
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-xs p-2">
                                  <p className="text-xs font-medium mb-1">Sales Velocity: {generatedSettings.metrics?.salesVelocity ?? '—'} move-ins (30 days)</p>
                                  <p className="text-xs text-gray-600">Net change: {(generatedSettings.metrics?.netChange ?? 0) > 0 ? '+' : ''}{generatedSettings.metrics?.netChange ?? '—'}. Higher velocity allows more aggressive pricing.</p>
                                </TooltipContent>
                              </Tooltip>
                            </span>
                            <span className="font-medium">{generatedSettings.weights.inquiryTourVolume}%</span>
                          </div>
                        </div>
                      </TooltipProvider>
                    </div>
                    
                    {/* Guardrails */}
                    <div className={`rounded-md p-3 border-2 transition-all ${enabledCategories.guardrails ? 'bg-white/80 border-blue-200' : 'bg-gray-100/50 border-gray-200 opacity-60'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="text-xs font-medium text-gray-500 uppercase">Guardrails</h5>
                        <Switch
                          checked={enabledCategories.guardrails}
                          onCheckedChange={(checked) => setEnabledCategories(prev => ({ ...prev, guardrails: checked }))}
                          data-testid="toggle-guardrails"
                        />
                      </div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between"><span>Max Increase:</span><span className="font-medium">{generatedSettings.guardrails.maxIncreasePercent}%</span></div>
                        <div className="flex justify-between"><span>Max Decrease:</span><span className="font-medium">{generatedSettings.guardrails.maxDecreasePercent}%</span></div>
                        <div className="flex justify-between"><span>Min Street Rate:</span><span className="font-medium">${generatedSettings.guardrails.minStreetRate}</span></div>
                        <div className="flex justify-between"><span>Max Street Rate:</span><span className="font-medium">${generatedSettings.guardrails.maxStreetRate}</span></div>
                      </div>
                    </div>
                    
                    {/* Adjustment Ranges */}
                    {generatedSettings.adjustmentRanges && (
                      <div className={`rounded-md p-3 border-2 transition-all ${enabledCategories.adjustmentRanges ? 'bg-white/80 border-blue-200' : 'bg-gray-100/50 border-gray-200 opacity-60'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-xs font-medium text-gray-500 uppercase">Adjustment Ranges</h5>
                          <Switch
                            checked={enabledCategories.adjustmentRanges}
                            onCheckedChange={(checked) => setEnabledCategories(prev => ({ ...prev, adjustmentRanges: checked }))}
                            data-testid="toggle-adjustment-ranges"
                          />
                        </div>
                        <div className="space-y-1 text-sm">
                          <div className="flex justify-between"><span>Occupancy:</span><span className="font-medium">{(generatedSettings.adjustmentRanges.occupancyMin * 100).toFixed(0)}% to {(generatedSettings.adjustmentRanges.occupancyMax * 100).toFixed(0)}%</span></div>
                          <div className="flex justify-between"><span>Vacancy:</span><span className="font-medium">{(generatedSettings.adjustmentRanges.vacancyMin * 100).toFixed(0)}% to {(generatedSettings.adjustmentRanges.vacancyMax * 100).toFixed(0)}%</span></div>
                          <div className="flex justify-between"><span>Seasonality:</span><span className="font-medium">{(generatedSettings.adjustmentRanges.seasonalityMin * 100).toFixed(0)}% to {(generatedSettings.adjustmentRanges.seasonalityMax * 100).toFixed(0)}%</span></div>
                          <div className="flex justify-between"><span>Competitor:</span><span className="font-medium">{(generatedSettings.adjustmentRanges.competitorMin * 100).toFixed(0)}% to {(generatedSettings.adjustmentRanges.competitorMax * 100).toFixed(0)}%</span></div>
                        </div>
                      </div>
                    )}
                    
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