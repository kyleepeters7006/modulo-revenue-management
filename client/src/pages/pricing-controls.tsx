import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ChevronDown, X, Sparkles, Target, Loader2, Save, Check, HeartPulse, TrendingUp, TrendingDown } from "lucide-react";
import Navigation from "@/components/navigation";
import { RuleDesigner } from "@/components/dashboard/rule-designer";
import { RulePerformanceTable } from "@/components/dashboard/rule-performance-table";
import ReferenceDataTable from "@/components/dashboard/reference-data-table";
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
  HC: string;
  "HC/MC": string;
  AL: string;
  "AL/MC": string;
  SL: string;
  VIL: string;
}

interface RuleSuggestion {
  suggestionId: string;
  name: string;
  intent: string;
  description: string;
  ruleDetail: string;
  serviceLine: string;
  locationId: string | null;
  unitsImpacted: number | null;
  monthlyImpact: number | null;
  annualImpact: number | null;
  elasticity: number | null;
  daysToSellAfter: number | null;
  predictedDaysToSellChange: number | null;
  elasticityMonthlyImpact: number | null;
  elasticityAnnualImpact: number | null;
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
    urlLocation ? [urlLocation] : (savedFilters?.locations?.length > 0 ? savedFilters.locations : ["Albany - 215"])
  );

  const [targetGrowth, setTargetGrowth] = useState<TargetGrowth>({
    HC: "3",
    "HC/MC": "3",
    AL: "5",
    "AL/MC": "5",
    SL: "4",
    VIL: "4"
  });
  // AI rule suggestions generated from revenue growth targets
  const [suggestions, setSuggestions] = useState<RuleSuggestion[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);

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

  // Generate AI rule suggestions to hit the revenue growth targets.
  // The backend works per (locationId, serviceLine, targetGrowthPercent); when
  // "All" service lines are selected we request suggestions for each line.
  const suggestRulesMutation = useMutation({
    mutationFn: async () => {
      const targetSLs = (selectedServiceLine === "All"
        ? (["HC", "HC/MC", "AL", "AL/MC", "SL", "VIL"] as const)
        : [selectedServiceLine]) as Array<keyof TargetGrowth>;

      const batches = await Promise.all(targetSLs.map(async (sl) => {
        const response = await apiRequest("/api/adjustment-rules/suggest", "POST", {
          locationId: selectedLocationId ?? null,
          serviceLine: sl,
          targetGrowthPercent: targetGrowth[sl] ? Number(targetGrowth[sl]) : undefined,
        });
        const data = await response.json();
        return (data.suggestions || []) as RuleSuggestion[];
      }));
      return batches.flat();
    },
    onSuccess: (data) => {
      setSuggestions(data);
      setHasGenerated(true);
      toast({
        title: data.length ? "Suggestions ready" : "No suggestions",
        description: data.length
          ? `AI proposed ${data.length} pricing rule${data.length > 1 ? 's' : ''}. Review and accept the ones you want.`
          : "AI did not return any rule suggestions for this scope. Try a different location or service line.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Suggestion Failed",
        description: error.message || "Failed to generate rule suggestions. Please try again.",
        variant: "destructive"
      });
    }
  });

  const acceptSuggestionMutation = useMutation({
    mutationFn: async (s: RuleSuggestion) => {
      const response = await apiRequest("/api/adjustment-rules/suggestions/accept", "POST", {
        name: s.name,
        description: s.description,
        locationId: s.locationId ?? selectedLocationId ?? null,
        serviceLine: s.serviceLine,
      });
      return response.json();
    },
    onSuccess: (_data, s) => {
      setSuggestions(prev => prev.filter(x => x.suggestionId !== s.suggestionId));
      queryClient.invalidateQueries({ queryKey: ["/api/adjustment-rules"], exact: false });
      toast({
        title: "Rule created",
        description: `"${s.name}" was added to your rules.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Accept Failed",
        description: error.message || "Failed to create the rule. Please try again.",
        variant: "destructive"
      });
    }
  });

  const denySuggestionMutation = useMutation({
    mutationFn: async (s: RuleSuggestion) => {
      const response = await apiRequest("/api/adjustment-rules/suggestions/deny", "POST", {
        suggestionId: s.suggestionId,
      });
      return response.json();
    },
    onSuccess: (_data, s) => {
      setSuggestions(prev => prev.filter(x => x.suggestionId !== s.suggestionId));
    },
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
            Configure pricing rules and guardrails for the Rules Rate engine
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


        <div className="space-y-6 sm:space-y-8">
          <ReferenceDataTable
            selectedServiceLine={selectedServiceLine}
            selectedRegions={selectedRegions}
            selectedDivisions={selectedDivisions}
            selectedLocations={selectedLocations}
          />

          <RuleDesigner
            locationId={selectedLocationId}
            serviceLine={selectedServiceLine === "All" ? undefined : selectedServiceLine}
            locationName={selectedLocations.length === 1 ? selectedLocations[0] : undefined}
          />

          <RulePerformanceTable
            selectedServiceLine={selectedServiceLine}
            selectedRegions={selectedRegions}
            selectedDivisions={selectedDivisions}
            selectedLocations={selectedLocations}
          />

          {/* Target Annual Revenue Growth Section */}
          <Card data-testid="card-target-growth">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-blue-600" />
                <CardTitle className="text-lg">Target Annual Revenue Growth</CardTitle>
              </div>
              <CardDescription>
                Set your target annual revenue growth percentage for each service line. AI will suggest pricing rules to help achieve these targets.
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
                        onClick={() => suggestRulesMutation.mutate()}
                        disabled={suggestRulesMutation.isPending}
                        data-testid="button-suggest-rules"
                      >
                        {suggestRulesMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Generating Suggestions...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4 mr-2" />
                            Suggest Rules with AI
                          </>
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500">
                      Save targets to persist them, or let AI propose pricing rules to reach your growth targets. Accepted suggestions become adjustment rules.
                    </p>
                  </div>
                </div>

                {/* AI Rule Suggestions */}
                {suggestRulesMutation.isPending && (
                  <div className="mt-6 p-6 bg-blue-50 rounded-lg border border-blue-100 flex items-center justify-center gap-3 text-sm text-blue-700">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analyzing your portfolio and drafting rule suggestions...
                  </div>
                )}

                {!suggestRulesMutation.isPending && hasGenerated && suggestions.length === 0 && (
                  <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-500" data-testid="text-no-suggestions">
                    No rule suggestions were returned for this scope. Try a different location or service line, then click Suggest Rules again.
                  </div>
                )}

                {suggestions.length > 0 && (
                  <div className="mt-6" data-testid="card-suggestions">
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className="h-4 w-4 text-blue-600" />
                      <h4 className="font-semibold text-gray-900">AI-Suggested Rules</h4>
                      <Badge variant="secondary" className="text-xs">{suggestions.length} pending</Badge>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">
                      Each suggestion becomes an adjustment rule when accepted. Estimated impact is based on price elasticity.
                    </p>
                    <div className="space-y-3">
                      {suggestions.map((s) => {
                        const monthly = s.monthlyImpact ?? 0;
                        const annual = s.annualImpact ?? 0;
                        const isPos = monthly >= 0;
                        const isAccepting = acceptSuggestionMutation.isPending && acceptSuggestionMutation.variables?.suggestionId === s.suggestionId;
                        const isDenying = denySuggestionMutation.isPending && denySuggestionMutation.variables?.suggestionId === s.suggestionId;
                        const busy = isAccepting || isDenying;
                        return (
                          <div
                            key={s.suggestionId}
                            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                            data-testid={`suggestion-${s.suggestionId}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-semibold text-gray-900">{s.name}</span>
                                  <Badge variant="outline" className="text-[10px] font-medium">{s.serviceLine}</Badge>
                                </div>
                                {s.intent && <p className="text-xs text-gray-500 mt-1 leading-relaxed">{s.intent}</p>}
                                <p className="text-xs font-mono text-gray-700 bg-gray-50 border border-gray-100 rounded px-2 py-1.5 mt-2">{s.ruleDetail}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button
                                  size="sm"
                                  className="h-8 gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                                  onClick={() => acceptSuggestionMutation.mutate(s)}
                                  disabled={busy}
                                  data-testid={`button-accept-${s.suggestionId}`}
                                >
                                  {isAccepting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                  Accept
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8 gap-1.5 text-gray-600"
                                  onClick={() => denySuggestionMutation.mutate(s)}
                                  disabled={busy}
                                  data-testid={`button-deny-${s.suggestionId}`}
                                >
                                  {isDenying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                                  Deny
                                </Button>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                              <div className="rounded-md bg-gray-50 border border-gray-100 px-2.5 py-1.5 text-center">
                                <p className="text-sm font-semibold text-gray-900">{(s.unitsImpacted ?? 0).toLocaleString()}</p>
                                <p className="text-[10px] uppercase tracking-wide text-gray-400">Units</p>
                              </div>
                              <div className="rounded-md bg-gray-50 border border-gray-100 px-2.5 py-1.5 text-center">
                                <p className={`text-sm font-semibold inline-flex items-center justify-center gap-1 ${isPos ? 'text-green-700' : 'text-red-700'}`}>
                                  {isPos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                                  {isPos ? '+' : '-'}${Math.abs(Math.round(monthly)).toLocaleString()}
                                </p>
                                <p className="text-[10px] uppercase tracking-wide text-gray-400">Monthly</p>
                              </div>
                              <div className="rounded-md bg-gray-50 border border-gray-100 px-2.5 py-1.5 text-center">
                                <p className={`text-sm font-semibold ${annual >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                                  {annual >= 0 ? '+' : '-'}${Math.abs(Math.round(annual)).toLocaleString()}
                                </p>
                                <p className="text-[10px] uppercase tracking-wide text-gray-400">Annual</p>
                              </div>
                              <div className="rounded-md bg-gray-50 border border-gray-100 px-2.5 py-1.5 text-center">
                                <p className="text-sm font-semibold text-gray-900">{s.elasticity != null ? s.elasticity.toFixed(1) : '—'}</p>
                                <p className="text-[10px] uppercase tracking-wide text-gray-400">Elasticity</p>
                              </div>
                            </div>
                            {(s.daysToSellAfter != null || s.predictedDaysToSellChange != null) && (
                              <p className="text-[11px] text-gray-500 mt-2">
                                {s.daysToSellAfter != null && <>Projected days-to-sell: <span className="font-medium text-gray-700">{Math.round(s.daysToSellAfter)}</span> </>}
                                {s.predictedDaysToSellChange != null && (
                                  <>({s.predictedDaysToSellChange >= 0 ? '+' : ''}{Math.round(s.predictedDaysToSellChange)} days vs. today)</>
                                )}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <GuardrailsEditor 
            locationId={selectedLocationId}
            serviceLine={selectedServiceLine === "All" ? undefined : selectedServiceLine}
          />
          <CareLevel2RatesPanel />
        </div>
      </div>
    </div>
  );
}

interface CareLevelRateRow {
  id: string;
  locationId: string;
  locationName: string;
  serviceLine: string;
  level2Rate: number;
  clientId: string | null;
}

const ALL_SERVICE_LINES = ["HC", "HC/MC", "AL", "AL/MC", "SL", "VIL"] as const;

function CareLevel2RatesPanel() {
  const { toast } = useToast();

  const { data: locationsData } = useQuery<{ locations?: Array<{ id: string; name: string }> }>({
    queryKey: ["/api/locations"],
  });

  const { data: existingRates = [], isLoading } = useQuery<CareLevelRateRow[]>({
    queryKey: ["/api/care-level-rates"],
  });

  // Active service lines per location: locationId → string[]
  const { data: locationServiceLines = {} } = useQuery<Record<string, string[]>>({
    queryKey: ["/api/locations/service-lines"],
  });

  // Map of "locationId|serviceLine" → rate value string (for in-progress edits)
  const [pendingRates, setPendingRates] = useState<Record<string, string>>({});
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [filterLocation, setFilterLocation] = useState<string>("");
  const [filterSL, setFilterSL] = useState<string>("All");

  // Build a quick-lookup map for existing rates
  const existingMap = new Map<string, number>(
    existingRates.map(r => [`${r.locationId}|${r.serviceLine}`, r.level2Rate])
  );

  const allLocations = locationsData?.locations ?? [];
  const filteredLocations = filterLocation
    ? allLocations.filter(l => l.name.toLowerCase().includes(filterLocation.toLowerCase()))
    : allLocations;

  const getKey = (locationId: string, sl: string) => `${locationId}|${sl}`;

  const getDisplayValue = (locationId: string, sl: string): string => {
    const key = getKey(locationId, sl);
    if (pendingRates[key] !== undefined) return pendingRates[key];
    const existing = existingMap.get(key);
    return existing != null ? String(existing) : "";
  };

  const handleChange = (locationId: string, sl: string, value: string) => {
    const numVal = value.replace(/[^0-9.]/g, "");
    setPendingRates(prev => ({ ...prev, [getKey(locationId, sl)]: numVal }));
  };

  const saveMutation = useMutation({
    mutationFn: async ({ locationId, serviceLine, level2Rate }: { locationId: string; serviceLine: string; level2Rate: number }) => {
      const res = await apiRequest("/api/care-level-rates", "POST", { locationId, serviceLine, level2Rate });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/care-level-rates"] });
    },
  });

  const handleSave = async (locationId: string, locationName: string, sl: string) => {
    const key = getKey(locationId, sl);
    const raw = pendingRates[key] ?? String(existingMap.get(key) ?? "");
    const rate = parseFloat(raw);
    if (isNaN(rate) || rate < 0) {
      toast({ title: "Invalid rate", description: "Please enter a valid dollar amount.", variant: "destructive" });
      return;
    }
    setSavingKeys(prev => new Set(prev).add(key));
    try {
      await saveMutation.mutateAsync({ locationId, serviceLine: sl, level2Rate: rate });
      setPendingRates(prev => { const n = { ...prev }; delete n[key]; return n; });
      toast({ title: "Saved", description: `Level 2 care rate for ${locationName} ${sl} set to $${rate.toFixed(0)}.` });
    } catch {
      toast({ title: "Save Failed", description: "Could not save rate. Please try again.", variant: "destructive" });
    } finally {
      setSavingKeys(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  };

  // Determine which service lines to show in the column filter buttons
  const activeSLsAcrossAll = new Set<string>();
  for (const sls of Object.values(locationServiceLines)) {
    sls.forEach(sl => activeSLsAcrossAll.add(sl));
  }
  // Fall back to all if data not loaded yet
  const displayableSLs = activeSLsAcrossAll.size > 0
    ? ALL_SERVICE_LINES.filter(sl => activeSLsAcrossAll.has(sl))
    : [...ALL_SERVICE_LINES];
  const filterableSLs = filterSL === "All" ? displayableSLs : [filterSL];

  return (
    <Card data-testid="card-care-level-rates">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <HeartPulse className="h-5 w-5 text-rose-500" />
          <CardTitle className="text-lg">Level 2 Care Rates</CardTitle>
        </div>
        <CardDescription>
          Set the posted Level 2 care rate per location and service line. These rates are used in the competitor adjustment formula (adjustedRate = base + theirCareL2 − ourCareL2 + …) so the pricing breakdown shows the correct "ours" value without re-uploading rent roll data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <Input
            placeholder="Filter by location name…"
            value={filterLocation}
            onChange={e => setFilterLocation(e.target.value)}
            className="max-w-xs text-sm"
          />
          <div className="flex flex-wrap gap-1">
            {["All", ...displayableSLs].map(sl => (
              <Button
                key={sl}
                variant={filterSL === sl ? "default" : "outline"}
                size="sm"
                className="text-xs"
                onClick={() => setFilterSL(sl)}
              >
                {sl === "All" ? "All Service Lines" : sl}
              </Button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : filteredLocations.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">No locations found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 pr-4 font-medium text-gray-600 min-w-[200px]">Location</th>
                  {filterableSLs.map(sl => (
                    <th key={sl} className="text-center py-2 px-2 font-medium text-gray-600 min-w-[110px]">{sl}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLocations.map(loc => {
                  // Only show columns for service lines active at this location
                  const activeSLsForLoc = locationServiceLines[loc.id] ?? [...ALL_SERVICE_LINES];
                  const colsToShow = filterableSLs.filter(sl => activeSLsForLoc.includes(sl));
                  if (colsToShow.length === 0) return null;
                  return (
                    <tr key={loc.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 pr-4 font-medium text-gray-800 truncate max-w-[220px]" title={loc.name}>
                        {loc.name}
                      </td>
                      {filterableSLs.map(sl => {
                        const isActive = activeSLsForLoc.includes(sl);
                        if (!isActive) {
                          return <td key={sl} className="py-2 px-2 text-center text-gray-300">—</td>;
                        }
                        const key = getKey(loc.id, sl);
                        const isSaving = savingKeys.has(key);
                        const displayVal = getDisplayValue(loc.id, sl);
                        const isDirty = pendingRates[key] !== undefined;
                        return (
                          <td key={sl} className="py-2 px-2">
                            <div className="flex items-center gap-1">
                              <div className="relative flex-1">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                                <Input
                                  className="pl-5 pr-2 text-xs h-8 text-right"
                                  value={displayVal}
                                  onChange={e => handleChange(loc.id, sl, e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") handleSave(loc.id, loc.name, sl); }}
                                  placeholder="—"
                                  data-testid={`input-care-l2-${loc.id}-${sl}`}
                                />
                              </div>
                              {isDirty && (
                                <Button
                                  size="sm"
                                  className="h-8 px-2 text-xs"
                                  onClick={() => handleSave(loc.id, loc.name, sl)}
                                  disabled={isSaving}
                                  data-testid={`button-save-care-l2-${loc.id}-${sl}`}
                                >
                                  {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                </Button>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}