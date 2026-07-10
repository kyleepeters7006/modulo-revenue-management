import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ChevronDown, X, Loader2, Save, HeartPulse, Sparkles, RefreshCw } from "lucide-react";
import Navigation from "@/components/navigation";
import { RuleDesigner } from "@/components/dashboard/rule-designer";
import AiRuleGenerator from "@/components/dashboard/ai-rule-generator";
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

  // Auto-scroll to rule designer when navigated from analytics with scrollTo=rules
  useEffect(() => {
    const scrollTo = urlParams.get('scrollTo');
    if (scrollTo === 'rules') {
      const el = document.getElementById('rule-designer-section');
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
      } else {
        // Element may not be rendered yet — wait for paint
        setTimeout(() => {
          document.getElementById('rule-designer-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 800);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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


        <PricingCommentaryCard
          selectedServiceLine={selectedServiceLine}
          selectedLocations={selectedLocations}
          selectedRegions={selectedRegions}
          selectedDivisions={selectedDivisions}
        />

        <div className="space-y-6 sm:space-y-8">
          <ReferenceDataTable
            selectedServiceLine={selectedServiceLine}
            selectedRegions={selectedRegions}
            selectedDivisions={selectedDivisions}
            selectedLocations={selectedLocations}
          />

          <div id="rule-designer-section" className="scroll-mt-4">
          <RuleDesigner
            locationId={selectedLocationId}
            serviceLine={selectedServiceLine === "All" ? undefined : selectedServiceLine}
            locationName={selectedLocations.length === 1 ? selectedLocations[0] : undefined}
            aiGenerator={
              <AiRuleGenerator
                locationId={selectedLocationId}
                selectedServiceLine={selectedServiceLine}
                selectedRegions={selectedRegions}
                selectedDivisions={selectedDivisions}
                selectedLocations={selectedLocations}
              />
            }
          />
          </div>

          <RulePerformanceTable
            selectedServiceLine={selectedServiceLine}
            selectedRegions={selectedRegions}
            selectedDivisions={selectedDivisions}
            selectedLocations={selectedLocations}
          />

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

// ── helpers ──────────────────────────────────────────────────────────────────
function parseBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1
      ? <strong key={i} className="font-semibold text-gray-900">{part}</strong>
      : <span key={i}>{part}</span>
  );
}

// ── Strategy Overview strip ───────────────────────────────────────────────────
interface StrategyOverviewData {
  summary: string;
  pricingTrend: string;
  rulesSummary: string;
  rules: { name: string; strategy: string }[];
  generatedAt: string;
}

interface PricingCommentaryCardProps {
  selectedServiceLine: string;
  selectedLocations: string[];
  selectedRegions: string[];
  selectedDivisions: string[];
}

function PricingCommentaryCard({ selectedServiceLine, selectedLocations, selectedRegions, selectedDivisions }: PricingCommentaryCardProps) {
  // Build query params to pass filters to the endpoint
  const params = new URLSearchParams();
  if (selectedServiceLine && selectedServiceLine !== 'All') params.set('serviceLine', selectedServiceLine);
  selectedLocations.forEach(l => params.append('locations', l));
  selectedRegions.forEach(r => params.append('regions', r));
  selectedDivisions.forEach(d => params.append('divisions', d));
  const qs = params.toString();

  const { data, isLoading, refetch, isFetching } = useQuery<StrategyOverviewData>({
    queryKey: ["/api/pricing-controls/commentary", selectedServiceLine, selectedLocations.join(','), selectedRegions.join(','), selectedDivisions.join(',')],
    queryFn: () => fetch(`/api/pricing-controls/commentary${qs ? '?' + qs : ''}`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const hasData = data && (data.summary || data.rules?.length > 0);

  return (
    <div className="rounded-xl border border-teal-200/70 bg-gradient-to-br from-teal-50/60 via-white to-slate-50/40 shadow-sm mb-6 overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-teal-100/80 bg-teal-50/50">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-teal-600/10">
            <Sparkles className="h-3.5 w-3.5 text-teal-600" />
          </div>
          <span className="text-sm font-semibold text-teal-800 tracking-wide uppercase" style={{ letterSpacing: '0.05em' }}>
            Strategy Overview
          </span>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs text-teal-600 hover:text-teal-800 transition-colors disabled:opacity-40"
          title="Refresh overview"
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* body */}
      <div className="px-5 py-5 space-y-5">
        {isLoading ? (
          <div className="space-y-4">
            <div className="h-4 rounded bg-gray-200 animate-pulse w-full" />
            <div className="h-4 rounded bg-gray-200 animate-pulse w-4/5" />
            <div className="space-y-2 pt-1">
              {[70, 85, 60, 75].map((w, i) => (
                <div key={i} className="h-3.5 rounded bg-gray-100 animate-pulse" style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
        ) : !hasData ? (
          <p className="text-sm text-gray-400 italic">No overview available — add pricing rules to generate insights.</p>
        ) : (
          <>
            {/* 1 — Occupancy & revenue summary */}
            {data.summary && (
              <p className="text-[15px] leading-relaxed text-gray-800 font-medium">
                {parseBold(data.summary)}
              </p>
            )}

            {/* 2 — 6-month pricing trend */}
            {data.pricingTrend && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-teal-600 mb-1.5">Pricing Trends · Last 6 Months</p>
                <p className="text-[14px] leading-relaxed text-gray-700">{parseBold(data.pricingTrend)}</p>
              </div>
            )}

            {/* 3 — Active rules */}
            {(data.rulesSummary || data.rules?.length > 0) && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-teal-600 mb-1.5">
                  Active Rules · {data.rules?.length || 0} configured
                </p>
                {data.rulesSummary && (
                  <p className="text-[14px] leading-relaxed text-gray-700 mb-3">{parseBold(data.rulesSummary)}</p>
                )}
                {data.rules?.length > 0 && (
                  <ul className="space-y-2">
                    {data.rules.map((rule, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <div className="flex items-start gap-1.5 shrink-0 pt-[4px]">
                          <div className="w-[3px] rounded-full bg-teal-400/60 self-stretch" style={{ minHeight: '14px' }} />
                          <div className="h-[6px] w-[6px] rounded-full bg-teal-500 mt-[3px] shrink-0" />
                        </div>
                        <div>
                          <span className="text-[13px] font-semibold text-gray-800">{rule.name}</span>
                          <span className="text-[13px] text-gray-500 mx-1">—</span>
                          <span className="text-[13px] text-gray-600">{parseBold(rule.strategy)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* footer */}
      {data?.generatedAt && !isLoading && (
        <div className="px-5 pb-3 text-[11px] text-gray-400">
          Generated {new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {" · "}Updates automatically when rules change
        </div>
      )}
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
  const [panelOpen, setPanelOpen] = useState(false);

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
      <CardHeader
        className="pb-4 cursor-pointer select-none hover:bg-gray-50 rounded-t-lg transition-colors"
        onClick={() => setPanelOpen(o => !o)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5 text-rose-500" />
            <CardTitle className="text-lg">Level 2 Care Rates</CardTitle>
          </div>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${panelOpen ? '' : '-rotate-90'}`} />
        </div>
        <CardDescription>
          Set the posted Level 2 care rate per location and service line. These rates are used in the competitor adjustment formula (adjustedRate = base + theirCareL2 − ourCareL2 + …) so the pricing breakdown shows the correct "ours" value without re-uploading rent roll data.
        </CardDescription>
      </CardHeader>
      {panelOpen && (
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
      )}
    </Card>
  );
}