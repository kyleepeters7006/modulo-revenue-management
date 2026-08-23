import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { usePortalTooltip } from "@/hooks/usePortalTooltip";
import { describeCondition, zeroReasonLabel, zeroReasonDetail } from "@/lib/ruleZeroReason";
import { useLocation } from "wouter";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import { ChevronDown, X, Loader2, Save, HeartPulse, Sparkles, RefreshCw, TrendingUp, TrendingDown, Zap, Maximize2, Minimize2, ArrowUpRight, ArrowDownRight, Minus, CircleDot, Target, BarChart3, FileBarChart, Info, Building2 } from "lucide-react";
import Navigation from "@/components/navigation";
import { RuleDesigner, type RuleDesignerHelpers } from "@/components/dashboard/rule-designer";
import { StrategyReportModal } from "@/components/dashboard/pricing-reports";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

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
  const [, setLocation] = useLocation();
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
  const [strategyReportOpen, setStrategyReportOpen] = useState(false);
  const [ruleFocus, setRuleFocus] = useState<string | null>(null);
  const designerHelpersRef = useRef<RuleDesignerHelpers | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);

  // Auto-open the Strategy Report when navigated here with ?openReport=true
  // (e.g. from the Pricing Strategy Documentation card on Data Management)
  useEffect(() => {
    if (urlParams.get('openReport') === 'true') {
      setStrategyReportOpen(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const regions = locationsData?.regions || [];
  const divisions = locationsData?.divisions || [];
  const locations = locationsData?.locations?.map((loc) => loc.name) || [];

  // When the available locations change (e.g. after login/logout), drop any
  // selections that no longer exist in the current client's data.
  // We check whether anything actually changed before calling setState to avoid
  // spurious re-renders (and the cascade of query re-fires they trigger).
  useEffect(() => {
    if (!locationsData?.locations) return;
    const validNames = new Set(locations);
    const validRegions = new Set(regions);
    const validDivisions = new Set(divisions);
    setSelectedLocations(prev => {
      const next = prev.filter(l => validNames.has(l));
      return next.length === prev.length ? prev : next;
    });
    setSelectedRegions(prev => {
      const next = prev.filter(r => validRegions.has(r));
      return next.length === prev.length ? prev : next;
    });
    setSelectedDivisions(prev => {
      const next = prev.filter(d => validDivisions.has(d));
      return next.length === prev.length ? prev : next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationsData]);

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

      {/* Frog hero banner */}
      <div className="w-full h-24 sm:h-32 overflow-hidden">
        <img
          src="/frog.jpg"
          alt=""
          className="w-full h-full object-cover"
          style={{ objectPosition: "35% 55%" }}
        />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 pb-20 sm:py-8 sm:pb-8">
        <div className="mb-6 sm:mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2" data-testid="text-page-title">
              Dynamic Pricing Controls
            </h1>
            <p className="text-sm sm:text-base text-gray-600" data-testid="text-page-subtitle">
              Configure pricing rules and guardrails for the Rules Rate engine
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <Button
              size="sm"
              onClick={() => {
                if (designerHelpersRef.current) {
                  designerHelpersRef.current.showAiGenerator();
                } else {
                  document.getElementById('rule-designer-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
              className="gap-1.5 bg-teal-600 hover:bg-teal-700 text-white"
              data-testid="button-generate-pricing-rules"
            >
              <Sparkles className="h-4 w-4" />
              Generate Pricing Rules
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStrategyReportOpen(true)}
              className="gap-1.5 border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-teal-700 hover:border-teal-300"
            >
              <FileBarChart className="h-4 w-4" />
              Strategy Report
            </Button>
          </div>
        </div>

        <StrategyReportModal
          open={strategyReportOpen}
          onClose={() => setStrategyReportOpen(false)}
          selectedServiceLine={selectedServiceLine}
          selectedLocations={selectedLocations}
          selectedLocationId={selectedLocationId}
          selectedRegions={selectedRegions}
          selectedDivisions={selectedDivisions}
        />

        <div className="bg-white rounded-lg shadow-sm mb-6">
          {/* Filter header — always visible */}
          <button
            onClick={() => setFiltersOpen(o => !o)}
            className="w-full flex items-center justify-between px-6 py-4 group"
          >
            <div className="flex items-center gap-3">
              <span className="text-base font-semibold text-gray-900 group-hover:text-gray-700 transition-colors">Filters</span>
              {/* Active filter summary pills */}
              {(selectedRegions.length > 0 || selectedDivisions.length > 0 || selectedLocations.length > 0 || selectedServiceLine !== "All") && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedServiceLine !== "All" && (
                    <span className="text-[11px] font-medium bg-teal-50 text-teal-700 border border-teal-200 rounded px-1.5 py-0.5">{selectedServiceLine}</span>
                  )}
                  {selectedLocations.map(l => (
                    <span key={l} className="text-[11px] font-medium bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 max-w-[140px] truncate">{l}</span>
                  ))}
                  {selectedRegions.length > 0 && !selectedLocations.length && (
                    <span className="text-[11px] font-medium bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{selectedRegions.length} region{selectedRegions.length !== 1 ? 's' : ''}</span>
                  )}
                  {selectedDivisions.length > 0 && !selectedLocations.length && (
                    <span className="text-[11px] font-medium bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{selectedDivisions.length} division{selectedDivisions.length !== 1 ? 's' : ''}</span>
                  )}
                </div>
              )}
            </div>
            <ChevronDown className={`h-4 w-4 text-gray-400 group-hover:text-gray-600 transition-transform duration-200 ${filtersOpen ? '' : '-rotate-90'}`} />
          </button>

          {filtersOpen && <div className="px-6 pb-6 space-y-4 border-t border-gray-100 pt-4">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <div className="min-w-[150px] flex-1">
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
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[180px] p-0">
                    <div className="p-3 space-y-2">
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
                      <div className="max-h-[min(240px,40vh)] overflow-y-auto space-y-2 pr-1">
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
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="min-w-[150px] flex-1">
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
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[180px] p-0">
                    <div className="p-3 space-y-2">
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
                      <div className="max-h-[min(240px,40vh)] overflow-y-auto space-y-2 pr-1">
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
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="min-w-[150px] flex-1">
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
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[200px] p-0">
                    <div className="p-3 space-y-2">
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
                      <div className="max-h-[min(260px,40vh)] overflow-y-auto space-y-2 pr-1">
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
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
\              <div className="shrink-0 self-end">
                <h3 className="text-sm font-medium text-gray-900 mb-1.5">Service Line:</h3>
                <div className="flex flex-wrap gap-1.5">
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


            {/* Scope Indicator */}
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-600">Settings Scope:</span>
                <Badge variant="secondary" className="text-xs" data-testid="badge-scope">
                  {getScopeDescription()}
                </Badge>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {selectedLocations.length > 1 
                  ? "Note: Select a single location to configure specific settings. Currently showing portfolio defaults."
                  : "Settings saved at this level will apply to matching units during rate calculations."}
              </p>
            </div>
          </div>}
        </div>


        <PricingCommentaryCard
          selectedServiceLine={selectedServiceLine}
          selectedLocations={selectedLocations}
          selectedRegions={selectedRegions}
          selectedDivisions={selectedDivisions}
          selectedLocationId={selectedLocationId}
          onRuleCreated={() => designerHelpersRef.current?.refreshRules()}
          onDraftRule={(text) => {
            setRuleFocus(text);
            if (designerHelpersRef.current) {
              designerHelpersRef.current.showAiGenerator();
            } else {
              // Helpers not captured yet — at least bring the designer into view.
              document.getElementById('rule-designer-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }}
        />

        <div className="space-y-6 sm:space-y-8">
          <ReferenceDataTable
            selectedServiceLine={selectedServiceLine}
            selectedRegions={selectedRegions}
            selectedDivisions={selectedDivisions}
            selectedLocations={selectedLocations}
            onRuleCreated={() => designerHelpersRef.current?.refreshRules()}
          />

          <div id="rule-designer-section" className="scroll-mt-4">
          <RuleDesigner
            locationId={selectedLocationId}
            serviceLine={selectedServiceLine === "All" ? undefined : selectedServiceLine}
            locationName={selectedLocations.length === 1 ? selectedLocations[0] : undefined}
            selectedLocations={selectedLocations}
            selectedRegions={selectedRegions}
            selectedDivisions={selectedDivisions}
            aiGenerator={(helpers) => {
              designerHelpersRef.current = helpers;
              return (
                <AiRuleGenerator
                  locationId={selectedLocationId}
                  selectedServiceLine={selectedServiceLine}
                  selectedRegions={selectedRegions}
                  selectedDivisions={selectedDivisions}
                  selectedLocations={selectedLocations}
                  onEditSuggestion={helpers.editSuggestion}
                  onRuleAccepted={helpers.refreshRules}
                  focus={ruleFocus}
                  onFocusHandled={() => setRuleFocus(null)}
                />
              );
            }}
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

// ── Static lookup tables (defined once, outside all components) ──────────────
const SL_COLORS: Record<string, string> = {
  AL: 'bg-teal-100 text-teal-800', 'AL/MC': 'bg-blue-100 text-blue-800',
  HC: 'bg-orange-100 text-orange-800', 'HC/MC': 'bg-sky-100 text-sky-800',
  SL: 'bg-emerald-100 text-emerald-800', VIL: 'bg-slate-100 text-slate-700',
};
const SL_DISPLAY: Record<string, string> = { VIL: 'Patio Homes' };
const SL_FULL: Record<string, string> = {
  AL: 'Assisted Living', 'AL/MC': 'AL — Mem Care',
  HC: 'Health Care', 'HC/MC': 'HC — Mem Care',
  SL: 'Senior Living', VIL: 'Villas',
};
const PALETTE = ['#0d9488','#0369a1','#d97706','#0284c7','#16a34a','#dc2626','#0891b2','#ea580c','#0e7490','#b45309'];
const SCATTER_SL_COLORS: Record<string,string> = { AL:'#0d9488', 'AL/MC':'#1e3a5f', HC:'#d97706', 'HC/MC':'#0284c7', SL:'#16a34a', VIL:'#67e8f9' };
const RULE_GROUPS: Array<{
  id: string; label: string; description: string;
  icon: any; accent: string; badge: string;
}> = [
  { id: 'push', label: 'High Occ — Below Market', description: 'Street rate trails top comps → push aggressively to close the gap', icon: TrendingUp, accent: '#0d9488', badge: 'bg-teal-100 text-teal-800' },
  { id: 'hold', label: 'High Occ — Above Market', description: 'Already leading comps with strong occupancy → hold and protect the premium', icon: ArrowUpRight, accent: '#0284c7', badge: 'bg-blue-100 text-blue-800' },
  { id: 'ih-below-street', label: 'High Occ — In-House Below Street', description: 'High occupancy with in-house rates below street rates → raise street to grow the spread', icon: ArrowUpRight, accent: '#16a34a', badge: 'bg-green-100 text-green-800' },
  { id: 'ensure', label: 'Street Rate Catch-Up — Below In-House', description: 'Street rates below in-house rates → raise street to close the gap', icon: ArrowUpRight, accent: '#0891b2', badge: 'bg-cyan-100 text-cyan-800' },
  { id: 'concession-al', label: 'Low AL/MC Occ — Rate Concession', description: 'Low occupancy with excess vacancy → reduce rates to drive AL/MC move-ins', icon: TrendingDown, accent: '#dc2626', badge: 'bg-red-100 text-red-800' },
  { id: 'concession-sl', label: 'Low SL/VIL Occ — Market Align', description: 'Senior Living and Villas soft on occupancy, rates well above market → align down', icon: ArrowDownRight, accent: '#d97706', badge: 'bg-amber-100 text-amber-800' },
];
const genMiniDots = (count: number, r: number) => {
  const n = Math.min(count, 32);
  return Array.from({ length: n }, (_, i) => {
    const theta = i * 2.39996;
    const rad = Math.sqrt((i + 0.5) / n) * (r - 4);
    return { x: Math.cos(theta) * rad, y: Math.sin(theta) * rad };
  });
};

// ── Strategy Overview strip ───────────────────────────────────────────────────
interface StrategyOverviewData {
  summary: string;
  pricingTrend: string;
  recommendation?: string;
  rulesSummary: string;
  rules: { name: string; strategy: string; effectiveDate?: string | null }[];
  generatedAt: string;
}

interface PricingCommentaryCardProps {
  onDraftRule?: (recommendationText: string) => void;
  /** Called after a rule is created from this card (quick adjust) so non-React-Query rule lists refresh. */
  onRuleCreated?: () => void;
  selectedServiceLine: string;
  selectedLocations: string[];
  selectedRegions: string[];
  selectedDivisions: string[];
  selectedLocationId?: string;
}

function clientSpecScore(r: any): number {
  let score = 0;
  if (r.locationId) score += 4;
  const sls = Array.isArray(r.serviceLines) && r.serviceLines.length
    ? r.serviceLines : r.serviceLine ? [r.serviceLine] : [];
  if (sls.length > 0) score += 2;
  const rt = r.action?.filters?.roomType;
  if (Array.isArray(rt) && rt.length > 0) score += 1;
  return score;
}

function PricingCommentaryCard({ selectedServiceLine, selectedLocations, selectedRegions, selectedDivisions, selectedLocationId, onDraftRule, onRuleCreated }: PricingCommentaryCardProps) {
  const [, setLocation] = useLocation();
  const [selectedRule, setSelectedRule] = useState<any>(null);
  const [fullMapOpen, setFullMapOpen] = useState(false);
  // Coverage-map hover tooltip. It is portalled onto document.body and clamped
  // to the viewport rather than placed inside the dialog — see usePortalTooltip
  // for why in-dialog placement cannot keep this card fully visible.
  const {
    hoveredId: hoveredBubbleMap,
    pos: bubbleTipPos,
    scrollRef: bubbleMapScrollRef,
    tipRef: bubbleTipRef,
    onAnchorEnter: onBubbleEnter,
    onAnchorLeave: onBubbleLeave,
  } = usePortalTooltip({ open: fullMapOpen });
  const [impactDialogOpen, setImpactDialogOpen] = useState(false);
  const [expandedImpactRow, setExpandedImpactRow] = useState<string | null>(null);
  const ruleRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [scatterExpanded, setScatterExpanded] = useState(false);
  const [recsOpen, setRecsOpen] = useState(false);
  const [scatterOpen, setScatterOpen] = useState(false);
  const [openRuleGroups, setOpenRuleGroups] = useState<Record<string, boolean>>({});
  const [coverageRuleId, setCoverageRuleId] = useState<string | null>(null);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [highlightedSL, setHighlightedSL] = useState<string | null>(null);
  const [pinnedScatterPoint, setPinnedScatterPoint] = useState<any>(null);
  const [scatterPopupPos, setScatterPopupPos] = useState<{ x: number; y: number } | null>(null);

  const qs = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedServiceLine && selectedServiceLine !== 'All') params.set('serviceLine', selectedServiceLine);
    selectedLocations.forEach(l => params.append('locations', l));
    selectedRegions.forEach(r => params.append('regions', r));
    selectedDivisions.forEach(d => params.append('divisions', d));
    return params.toString();
  }, [selectedServiceLine, selectedLocations, selectedRegions, selectedDivisions]);

  const rulesQs = useMemo(() => {
    const p = new URLSearchParams();
    if (selectedLocationId) p.set('locationId', selectedLocationId);
    if (selectedServiceLine && selectedServiceLine !== 'All') p.set('serviceLine', selectedServiceLine);
    selectedLocations.forEach(l => p.append('locations', l));
    selectedRegions.forEach(r => p.append('regions', r));
    selectedDivisions.forEach(d => p.append('divisions', d));
    const s = p.toString();
    return s ? '?' + s : '';
  }, [selectedLocationId, selectedServiceLine, selectedLocations, selectedRegions, selectedDivisions]);

  const { data, isLoading, refetch, isFetching } = useQuery<StrategyOverviewData>({
    queryKey: ["/api/pricing-controls/commentary", selectedServiceLine, selectedLocations.join(','), selectedRegions.join(','), selectedDivisions.join(',')],
    queryFn: () => fetch(`/api/pricing-controls/commentary${qs ? '?' + qs : ''}`).then(r => r.json()),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: 1,
  });

  const { data: rulesData } = useQuery<any[]>({
    queryKey: ['/api/adjustment-rules', selectedLocationId ?? '', selectedServiceLine ?? '', selectedLocations.join(','), selectedRegions.join(','), selectedDivisions.join(',')],
    queryFn: () => fetch(`/api/adjustment-rules${rulesQs}`).then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const { data: compPositionRaw = [] } = useQuery<any[]>({
    queryKey: ['/api/pricing-controls/competitive-position', selectedServiceLine, selectedLocations.join(','), selectedRegions.join(','), selectedDivisions.join(',')],
    queryFn: () => fetch(`/api/pricing-controls/competitive-position${qs ? '?' + qs : ''}`).then(r => r.json()),
    staleTime: 10 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    placeholderData: keepPreviousData,
  });
  // Hide sub-50% occupancy points when no specific campuses are selected —
  // these are bad data (beds flipping between AL and IL skew occupancy) and
  // compress the chart. Explicitly filtering to a campus still shows everything.
  const compPositionData = compPositionRaw.filter((d: any) => {
    const occ = d.occupancy ?? 0;
    if (occ <= 0) return false;
    if (selectedLocations.length === 0 && occ < 65) return false;
    return true;
  });

  const { data: coverageData, isLoading: coverageLoading } = useQuery<any>({
    queryKey: ['/api/adjustment-rules', coverageRuleId, 'coverage'],
    queryFn: () => fetch(`/api/adjustment-rules/${coverageRuleId}/coverage`).then(r => r.json()),
    enabled: !!coverageRuleId,
    staleTime: 5 * 60 * 1000,
  });

  const quickAdjustMutation = useMutation({
    mutationFn: async ({ location, serviceLine, pct }: { location: string; serviceLine: string; pct: number }) => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch('/api/adjustment-rules/from-filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjustmentType: 'percentage',
          adjustmentValue: pct,
          effectiveDate: today,
          scope: { serviceLines: [serviceLine], locations: [location] },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['/api/adjustment-rules'] });
      onRuleCreated?.();
      toast({ title: `${vars.pct > 0 ? '+' : ''}${vars.pct}% rule created`, description: `${SL_DISPLAY[vars.serviceLine] || vars.serviceLine} at ${vars.location}` });
      setPinnedScatterPoint(null);
    },
    onError: (err: any) => {
      toast({ title: 'Rule creation failed', description: err.message, variant: 'destructive' });
    },
  });

  const handleScatterDotClick = (data: any, _index: number, event: any) => {
    const pt = data;
    if (!pt?.location) return;
    const clientX = event?.clientX ?? event?.nativeEvent?.clientX ?? 0;
    const clientY = event?.clientY ?? event?.nativeEvent?.clientY ?? 0;
    setPinnedScatterPoint(pt);
    setScatterPopupPos({ x: clientX, y: clientY });
  };

  // When viewing the full portfolio (no location/region/division filter), count every
  // toggled-on rule so the badge stays in sync with the list even for rules whose
  // conditions currently match nothing.  When a scope filter IS active, only count
  // rules that actually impact units within that scope — a rule with 0 affected units
  // at the filtered campus is not meaningfully "active" there.
  const activeRules = useMemo(() => {
    const hasFilter = selectedLocations.length > 0 || selectedRegions.length > 0 || selectedDivisions.length > 0;
    return (rulesData || []).filter((r: any) =>
      r.isActive && (!hasFilter || (r.affectedUnits ?? 0) > 0)
    );
  }, [rulesData, selectedLocations, selectedRegions, selectedDivisions]);

  // ── Latest-cycle-wins: detect rules superseded by a newer cycle ──
  // Two rules can supersede each other only when they have the SAME effective scope
  // (same locationId + serviceLine + room-type filter) AND one is from an older cycle.
  // Blanket portfolio rules (no scope) and targeted rules use separate cycle clocks so
  // a newer blanket rule can never cross out an older targeted rule.
  // Within the targeted tier, Campus A VIL rules and Campus B VIL rules are independent:
  // only rules with the exact same location+SL+RT scope compete in the same cycle clock.
  const supersededIds = useMemo(() => {
    // Key = tier + full scope so rules with different scopes never compete.
    function scopeKey(r: any): string {
      const tier = clientSpecScore(r) > 0 ? 'targeted' : 'blanket';
      const loc = r.locationId ?? '';
      const sl  = r.serviceLine ?? (Array.isArray(r.serviceLines) && r.serviceLines.length ? r.serviceLines.slice().sort().join('+') : '');
      const rt  = Array.isArray(r.action?.filters?.roomType)
        ? r.action.filters.roomType.slice().sort().join('+') : '';
      return `${tier}|${loc}|${sl}|${rt}`;
    }
    const latestCyclePerKey: Record<string, string> = {};
    activeRules.forEach((r: any) => {
      if (!r.effectiveDate) return;
      const key   = scopeKey(r);
      const month = String(r.effectiveDate).slice(0, 7);
      if (!latestCyclePerKey[key] || month > latestCyclePerKey[key]) latestCyclePerKey[key] = month;
    });
    const ids = new Set<string>();
    activeRules.forEach((r: any) => {
      if (!r.effectiveDate) return;
      const key   = scopeKey(r);
      const month = String(r.effectiveDate).slice(0, 7);
      const latest = latestCyclePerKey[key];
      if (latest && month < latest) ids.add(r.id);
    });
    return ids;
  }, [activeRules]);

  const overlapRuleIds = useMemo(() => new Set<string>(
    activeRules
      .filter((r: any) => (r.overlapExcludedUnits || 0) > 0 && !supersededIds.has(r.id))
      .map((r: any) => r.id)
  ), [activeRules, supersededIds]);

  const effectiveRules = useMemo(() => activeRules.filter((r: any) => !supersededIds.has(r.id)), [activeRules, supersededIds]);

  // ── Targeted-over-blanket: replacement semantics, each unit counted once ──
  // The backend dedup (specificity → priority → date) assigns each unit to the
  // most-specific qualifying rule before computing per-rule annualImpact.
  // Blanket rules (specificity 0) that were fully displaced by targeted rules
  // will have affectedUnits === 0 and already contribute $0 to the sum, but
  // we exclude them here to explicitly mirror the engine's Pass 3 suppression.
  const effectiveRulesForTotal = useMemo(() =>
    effectiveRules.filter((r: any) =>
      clientSpecScore(r) > 0          // targeted rules always count
      || (r.affectedUnits ?? 0) > 0  // blanket rules only count when they have leftover units
    ),
  [effectiveRules]);

  const { totalAnnualImpact, positiveImpact, negativeImpact, totalSteadyState } = useMemo(() => ({
    totalAnnualImpact: effectiveRulesForTotal.reduce((s: number, r: any) => s + (r.annualImpact || 0), 0),
    positiveImpact:    effectiveRulesForTotal.filter((r: any) => (r.annualImpact || 0) > 0).reduce((s: number, r: any) => s + r.annualImpact, 0),
    negativeImpact:    effectiveRulesForTotal.filter((r: any) => (r.annualImpact || 0) < 0).reduce((s: number, r: any) => s + r.annualImpact, 0),
    totalSteadyState:  effectiveRulesForTotal.reduce((s: number, r: any) => s + (r.steadyStateAnnualImpact ?? r.annualImpact ?? 0), 0),
  }), [effectiveRulesForTotal]);

  const fmtImpact = (v: number, sign = true) => {
    const abs = Math.abs(v);
    const pfx = sign ? (v < 0 ? '-' : '+') : '';
    if (abs >= 1_000_000) return `${pfx}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${pfx}$${(abs / 1_000).toFixed(0)}K`;
    return `${pfx}$${Math.round(abs).toLocaleString()}`;
  };

  const getActionInfo = (rule: any) => {
    const action = rule.action || {};
    const adj = action.adjustmentType;
    const val = Number(action.adjustmentValue ?? 0);
    const isNeg = val < 0;
    const absVal = Math.abs(val);
    const display = adj === 'percentage' ? `${isNeg ? '' : '+'}${val}%` : `${isNeg ? '-' : '+'}$${absVal}`;
    const positive = (rule.annualImpact || 0) >= 0;
    return { positive, display, isIncrease: !isNeg };
  };

  const getTriggerLabel = (rule: any) => {
    const trigger = rule.trigger || {};
    if (trigger.type === 'immediate') return 'Always active';
    const conditions = trigger.conditions || (trigger.condition ? [trigger.condition] : []);
    if (!conditions.length) return 'Conditional';
    const fieldMap: Record<string, string> = {
      service_line_occupancy: 'SL occ', room_type_occupancy: 'RT occ',
      campus_occupancy: 'Campus occ', days_vacant: 'Days vacant', occupancy: 'Occ',
      street_to_comp_var: 'St vs comp', competitor_variance: 'Comp var',
      ih_street_variance: 'IH vs St', street_to_ih_var: 'IH vs St',
    };
    // Fields whose values are already percentages (displayed with % suffix)
    const pctFields = new Set(['street_to_comp_var', 'competitor_variance', 'ih_street_variance', 'street_to_ih_var']);
    // Format a single condition as a compact token
    const formatOne = (c: any): string => {
      const field = fieldMap[c.field] || (c.field || '').replace(/_/g, ' ');
      const val = c.field?.includes('occupancy')
        ? `${Math.round((c.value || 0) * 100)}%`
        : pctFields.has(c.field)
          ? `${c.value}%`
          : c.value;
      const op = c.operator === '>=' ? '≥' : c.operator === '<=' ? '≤' : c.operator === '<' ? '<' : c.operator === '>' ? '>' : String(c.operator);
      return `${field} ${op} ${val}`;
    };
    // Join all conditions with a mid-dot separator; truncate with ellipsis if very long
    const label = conditions.map(formatOne).join(' · ');
    return label.length > 60 ? label.slice(0, 57) + '…' : label;
  };

  const formatConditionLines = (rule: any): string[] => {
    const triggerObj = rule.trigger || {};
    const conditions: any[] = triggerObj.conditions || (triggerObj.condition ? [triggerObj.condition] : []);
    if (!conditions.length) return [];
    const fieldMap: Record<string, string> = {
      service_line_occupancy: 'SL occupancy',
      room_type_occupancy: 'Room type occupancy',
      campus_occupancy: 'Campus occupancy',
      days_vacant: 'Days vacant',
      street_to_comp_var: 'Street vs top comp',
      vacant_units: 'Vacant units',
      occupancy: 'Occupancy',
    };
    return conditions.map((c: any) => {
      const fn = fieldMap[c.field] || (c.field || '').replace(/_/g, ' ');
      const op = c.operator === '>=' ? '≥' : c.operator === '<=' ? '≤' : c.operator === '<' ? '<' : c.operator === '>' ? '>' : String(c.operator);
      const val = c.field?.includes('occupancy') ? `${Math.round((c.value || 0) * 100)}%`
        : c.field === 'street_to_comp_var' ? `${c.value}%`
        : String(c.value);
      return `${fn} ${op} ${val}`;
    });
  };

  const getSLs = (rule: any): string[] => {
    const f = rule.action?.filters || {};
    return (f.serviceLine || []).slice(0, 3);
  };

  const getRuleCategory = (rule: any): string => {
    // Prefer the server-computed category so every surface (Rule Admin, Rule
    // Performance, Active Rules) summarizes each rule's strategy identically.
    if (rule.category && RULE_GROUPS.some(g => g.id === rule.category)) return rule.category;
    const val = Number(rule.action?.adjustmentValue ?? 0);
    if (val > 0) {
      const conditions = rule.trigger?.conditions || (rule.trigger?.condition ? [rule.trigger.condition] : []);
      const compCond = conditions.find((c: any) => c.field === 'street_to_comp_var');
      return (compCond && compCond.operator === '<') ? 'push' : 'hold';
    }
    const sl = rule.serviceLine || '';
    return (sl === 'SL' || sl === 'VIL') ? 'concession-sl' : 'concession-al';
  };

  const hasData = data && (data.summary || data.rules?.length > 0);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const scatterTooltipContent = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-[11px]">
        <p className="font-bold text-slate-800 mb-0.5">{d.location}</p>
        <p className="text-slate-500">{SL_DISPLAY[d.serviceLine] || d.serviceLine} · Occ: <strong>{d.occupancy}%</strong></p>
        <p className="text-slate-500">Our Studio Rate: <strong>${d.ourRate?.toLocaleString()}</strong></p>
        <p className="text-slate-500">
          Top Comp{d.topCompetitor ? ` (${d.topCompetitor})` : ''}: <strong>${d.compRate?.toLocaleString()}</strong>
          {d.rawCompRate && d.rawCompRate !== d.compRate && (
            <span className="text-slate-400"> (base ${d.rawCompRate?.toLocaleString()}{d.careAdj ? `, care ${d.careAdj > 0 ? '+' : ''}${d.careAdj?.toLocaleString()}` : ''})</span>
          )}
        </p>
        {d.avgCompRate != null && (
          <p className="text-slate-500">Market Avg: <strong>${d.avgCompRate?.toLocaleString()}</strong>{d.compCount ? <span className="text-slate-400"> · {d.compCount} comps</span> : null}</p>
        )}
        <p className={`font-bold mt-0.5 ${d.marketPosition > 100 ? 'text-emerald-600' : d.marketPosition < 95 ? 'text-amber-600' : 'text-slate-600'}`}>
          {(() => { const delta = Math.round(d.marketPosition - 100); return delta > 0 ? `+${delta}% above top competitor` : delta < 0 ? `${delta}% below top competitor` : 'At top competitor rate'; })()}
        </p>
      </div>
    );
  };

  // Split of the same points the full chart plots, used to caption the thumbnail.
  // marketPosition is a rounded percentage, so landing exactly on 100 is common — count it
  // separately rather than folding it into "below", which the chart's own Market reference
  // line at y=100 would contradict.
  const aboveMarket = compPositionData.filter((d: any) => d.marketPosition > 100).length;
  const belowMarket = compPositionData.filter((d: any) => d.marketPosition < 100).length;
  const atMarket = compPositionData.length - aboveMarket - belowMarket;

  // Thumbnail shown while the Strategy Overview strip is collapsed. The competitive-position
  // query already runs on page load, so this costs no extra request. Axes, grid, ticks and
  // tooltip are stripped deliberately — at ~46px tall they would be noise, not information;
  // the only retained reference is the y=100 "at market" line, which is what gives the dot
  // cloud its meaning at a glance.
  const renderMiniScatter = () => (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 3, right: 3, bottom: 3, left: 3 }}>
        {/* Unlike the full chart these domains hug the data rather than clamping to
            0-100 / 88-112. With the axes hidden there is no scale to preserve, so the
            cloud should use the whole 132px instead of bunching in one corner. The y
            floor/ceiling still straddle 100 so the "at market" line can never clip out. */}
        <XAxis
          type="number" dataKey="occupancy" hide
          domain={([min, max]: [number, number]) => [min - 1, max + 1]}
        />
        <YAxis
          type="number" dataKey="marketPosition" hide
          domain={([min, max]: [number, number]) => [Math.min(min - 2, 98), Math.max(max + 2, 102)]}
        />
        <ZAxis range={[9, 9]} />
        <ReferenceLine y={100} stroke="#0d9488" strokeDasharray="3 2" strokeWidth={1} />
        {['HC','HC/MC','AL','AL/MC','SL','VIL'].map(sl => {
          const slData = compPositionData.filter((d: any) => d.serviceLine === sl);
          if (!slData.length) return null;
          return (
            <Scatter
              key={sl}
              data={slData}
              fill={SCATTER_SL_COLORS[sl] || '#64748b'}
              fillOpacity={0.85}
              isAnimationActive={false}
            />
          );
        })}
      </ScatterChart>
    </ResponsiveContainer>
  );

  const renderScatterChart = (height: number, tickFontSize: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis
          type="number" dataKey="occupancy" name="Occupancy"
          domain={([min, max]: [number,number]) => [Math.max(min - 3, 0), Math.min(max + 3, 100)]}
          tickFormatter={(v) => `${v}%`}
          tick={{ fontSize: tickFontSize, fill: '#94a3b8' }}
          label={{ value: '← Low Occupancy · High Occupancy →', position: 'insideBottom', offset: -14, fontSize: tickFontSize, fill: '#94a3b8' }}
        />
        <YAxis
          type="number" dataKey="marketPosition" name="Market Position"
          domain={([min, max]: [number,number]) => [Math.min(min - 2, 88), Math.max(max + 2, 112)]}
          ticks={[-25, 0, 25, 50, 75, 100, 125, 150].map(d => d + 100)}
          tickFormatter={(v) => { const d = v - 100; return d > 0 ? `+${d}%` : `${d}%`; }}
          tick={{ fontSize: tickFontSize, fill: '#94a3b8' }}
          width={42}
        />
        <ZAxis range={[height > 300 ? 70 : (selectedLocationId ? 65 : 35), height > 300 ? 70 : (selectedLocationId ? 65 : 35)]} />
        <ReferenceLine y={100} stroke="#0d9488" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: 'Market', fontSize: tickFontSize + 1, fill: '#0d9488', position: 'insideTopRight' }} />
        <ReferenceLine x={90} stroke="#94a3b8" strokeDasharray="3 2" strokeWidth={1} label={{ value: '90%', fontSize: tickFontSize + 1, fill: '#94a3b8', position: 'insideTopRight' }} />
        <RechartsTooltip cursor={{ strokeDasharray: '3 3' }} content={scatterTooltipContent} />
        {['HC','HC/MC','AL','AL/MC','SL','VIL'].map(sl => {
          const slData = compPositionData.filter((d: any) => d.serviceLine === sl);
          if (!slData.length) return null;
          const color = SCATTER_SL_COLORS[sl] || '#64748b';
          const dimmed = highlightedSL !== null && highlightedSL !== sl;
          return (
            <Scatter key={sl} name={sl} data={slData} fill={color} onClick={handleScatterDotClick} style={{ cursor: 'pointer' }}>
              {slData.map((_: any, i: number) => <Cell key={i} fill={color} fillOpacity={dimmed ? 0.12 : 0.85} />)}
            </Scatter>
          );
        })}
      </ScatterChart>
    </ResponsiveContainer>
  );

  const renderScatterLegend = (textSize: string) => (
    <div className="flex flex-wrap gap-3 mt-2 justify-center">
      {(['HC','HC/MC','AL','AL/MC','SL','VIL'] as const)
        .filter(sl => compPositionData.some((d:any) => d.serviceLine === sl))
        .map(sl => {
          const active = highlightedSL === sl;
          const faded  = highlightedSL !== null && !active;
          return (
            <button
              key={sl}
              onClick={() => setHighlightedSL(active ? null : sl)}
              className={`flex items-center gap-1 ${textSize} transition-opacity cursor-pointer select-none
                ${faded ? 'opacity-30' : 'opacity-100'} hover:opacity-100`}
            >
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: SCATTER_SL_COLORS[sl] }} />
              <span className={active ? 'font-bold text-slate-700' : 'text-slate-500'}>{SL_DISPLAY[sl] || sl}</span>
            </button>
          );
        })}
    </div>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm mb-6 overflow-hidden">

      {/* ══ MASTHEAD ══ */}
      <div className="px-6 pt-3 pb-2 border-b border-slate-100">
        <div className="flex items-start justify-between gap-4 relative">
          <div className="flex-1 min-w-0">
            {/* rubric label */}
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setStrategyOpen(o => !o)}
                className="flex items-center gap-2 group"
              >
                <span className="inline-block w-[3px] h-4 rounded-full bg-teal-500" />
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 group-hover:text-slate-600 transition-colors">Strategy Overview</span>
                <ChevronDown className={`h-3 w-3 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 ${strategyOpen ? '' : '-rotate-90'}`} />
              </button>
              {activeRules.length > 0 && (
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-teal-500 border border-teal-200 rounded px-1.5 py-0.5">
                  {activeRules.length} Active Rule{activeRules.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* headline — AI summary as editorial lede */}
            {strategyOpen && (isLoading && !hasData ? (
              <div className="space-y-2">
                <div className="h-7 rounded bg-slate-100 animate-pulse w-3/4" />
                <div className="h-7 rounded bg-slate-100 animate-pulse w-1/2" />
              </div>
            ) : data?.summary ? (
              <h2 className="text-[22px] font-black text-slate-900 leading-[1.25] tracking-tight mb-0">
                {parseBold(data.summary)}
              </h2>
            ) : null)}
          </div>
          {/* Competitive position — absolutely centred in the header row when strip is collapsed */}
          {!strategyOpen && compPositionData.length > 0 && (
            <div className="hidden md:flex absolute inset-0 items-center justify-end pr-10 pointer-events-none">
              <button
                type="button"
                onClick={() => { setStrategyOpen(true); setScatterOpen(true); }}
                className="pointer-events-auto flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-1.5 group hover:border-teal-300 hover:bg-teal-50/40 transition-colors"
                title="Open the full Competitive Position chart"
                aria-expanded={strategyOpen}
                aria-label={`Competitive position: ${aboveMarket} above market, ${belowMarket} below market${atMarket > 0 ? `, ${atMarket} at market` : ''}. Open the full chart.`}
                data-testid="button-mini-competitive-position"
              >
                <div className="text-center shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 group-hover:text-teal-600 transition-colors whitespace-nowrap mb-0.5">
                    Competitive Position
                  </p>
                  <p className="text-[12px] font-semibold text-slate-600 tabular-nums whitespace-nowrap">
                    {aboveMarket} above · {belowMarket} below{atMarket > 0 ? ` · ${atMarket} at` : ''} market
                  </p>
                </div>
                <div className="h-[52px] w-[240px] shrink-0">
                  {renderMiniScatter()}
                </div>
              </button>
            </div>
          )}

          <div className="flex justify-end items-start">

          {/* KPI column — right-aligned on desktop */}
          {strategyOpen && activeRules.length > 0 && !isLoading && (
            <button
              onClick={() => setImpactDialogOpen(true)}
              className="hidden sm:flex flex-col items-end gap-0 shrink-0 pl-4 border-l border-slate-100 group hover:bg-slate-50/60 rounded-lg px-3 py-1 -mr-1 transition-colors cursor-pointer text-left"
              title="Click to see how this is calculated"
            >
              <div className="flex items-center gap-1 mb-0.5">
                <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">First-Year Rule Impact</p>
                <Info className="h-2.5 w-2.5 text-slate-300 group-hover:text-teal-400 transition-colors" />
              </div>
              <p className={`text-3xl font-black leading-none tracking-tight ${totalAnnualImpact >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {fmtImpact(totalAnnualImpact)}
              </p>
              {totalSteadyState !== totalAnnualImpact && (
                <p className="text-[11px] font-semibold text-slate-400 mt-0.5">
                  {fmtImpact(totalSteadyState)}/yr fully ramped
                </p>
              )}
              {positiveImpact > 0 && negativeImpact < 0 && (
                <div className="flex gap-3 mt-2">
                  <div className="text-right">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Lift</p>
                    <p className="text-sm font-black text-emerald-500">{fmtImpact(positiveImpact)}</p>
                  </div>
                  <div className="text-right border-l border-slate-100 pl-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Concessions</p>
                    <p className="text-sm font-black text-red-500">{fmtImpact(negativeImpact)}</p>
                  </div>
                </div>
              )}
            </button>
          )}

          {/* Impact explanation dialog */}
          <Dialog open={impactDialogOpen} onOpenChange={setImpactDialogOpen}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base font-bold">
                  <Info className="h-4 w-4 text-teal-500" />
                  How First-Year Rule Impact is Calculated
                </DialogTitle>
              </DialogHeader>

              {/* Summary KPIs */}
              <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 rounded-lg">
                <div className="text-center">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">First-Year Net Impact</p>
                  <p className={`text-2xl font-black ${totalAnnualImpact >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtImpact(totalAnnualImpact)}</p>
                  {totalSteadyState !== totalAnnualImpact && (
                    <p className="text-[11px] font-semibold text-slate-400 mt-0.5">{fmtImpact(totalSteadyState)}/yr once fully ramped</p>
                  )}
                </div>
                <div className="text-center border-l border-slate-200">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">Concessions</p>
                  <p className="text-2xl font-black text-red-500">{negativeImpact < 0 ? fmtImpact(negativeImpact) : '—'}</p>
                </div>
              </div>

              {/* Per-rule breakdown — grouped by strategy, expandable rows */}
              {(() => {
                // Rules sharing units with a newer rule — their shown impact
                // already excludes those units (counted once, backend-deduped).
                const duplicateIds = overlapRuleIds;
                return (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Rule-by-Rule Breakdown</p>
                    {supersededIds.size > 0 && (
                      <div className="mb-2 flex items-start gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[12px] text-slate-600">
                        <span className="text-slate-400 mt-0.5 shrink-0">↻</span>
                        <span><span className="font-semibold">Cycle superseding active:</span> {supersededIds.size} rule{supersededIds.size !== 1 ? 's' : ''} from an earlier pricing cycle are shown crossed-out and excluded from the net total — a newer cycle now applies for those service lines.</span>
                      </div>
                    )}
                    {duplicateIds.size > 0 && (
                      <div className="mb-2 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800">
                        <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>
                        <span><span className="font-semibold">Overlap removed:</span> {duplicateIds.size} rule{duplicateIds.size !== 1 ? 's' : ''} qualify units already covered by a newer rule. Each unit is counted only once — the totals above contain no double-counting.</span>
                      </div>
                    )}
                    <div className="space-y-2">
                      {RULE_GROUPS.map(group => {
                        const groupRules = activeRules.filter((r: any) => getRuleCategory(r) === group.id);
                        if (!groupRules.length) return null;
                        const GroupIcon = group.icon;
                        const groupAnnual = groupRules
                          .filter((r: any) => !supersededIds.has(r.id))
                          .reduce((s: number, r: any) => s + (r.annualImpact || 0), 0);
                        return (
                          <div key={group.id} className="rounded-lg border border-slate-200 overflow-hidden"
                            style={{ borderLeftWidth: 3, borderLeftColor: group.accent }}>
                            {/* Group header */}
                            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-100">
                              <div className="flex items-center gap-2">
                                <GroupIcon className="h-3.5 w-3.5 shrink-0" style={{ color: group.accent }} />
                                <span className="text-xs font-bold text-slate-700">{group.label}</span>
                                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${group.badge}`}>{groupRules.length}</span>
                              </div>
                              <span className={`text-sm font-bold tabular-nums ${groupAnnual >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {fmtImpact(groupAnnual)}<span className="text-[11px] font-normal text-slate-400">/yr</span>
                              </span>
                            </div>
                            {/* Rule rows */}
                            <div className="divide-y divide-slate-100">
                              {groupRules.map((rule: any) => {
                                const isExpanded = expandedImpactRow === rule.id;
                                const isDupe     = duplicateIds.has(rule.id);
                                // Blanket rules (no campus/SL/RT scope) suppressed by a more-targeted rule
                                // are a distinct case from same-tier priority overlap — show separate badge.
                                const isBlanketSuppressed = isDupe && clientSpecScore(rule) === 0;
                                const annual  = rule.annualImpact  || 0;
                                const monthly = rule.monthlyImpact || 0;
                                const isPos   = annual >= 0;
                                const action  = rule.action || {};
                                const adjVal  = Number(action.adjustmentValue ?? 0);
                                const adjPct  = action.adjustmentType === 'percentage';
                                const adjDisp = adjPct
                                  ? `${adjVal > 0 ? '+' : ''}${adjVal}%`
                                  : `${adjVal > 0 ? '+' : '−'}$${Math.abs(adjVal).toLocaleString()}`;
                                const units   = rule.affectedUnits || 0;
                                const moveIns = rule.moveInsPerMonth ?? null;
                                const avgRate = rule.avgStreetRate || null;
                                const rateChg = rule.avgRateChange ?? null;
                                const triggerLabel = getTriggerLabel(rule);
                                const sl = rule.serviceLine || 'All';
                                // Describe all trigger conditions for expanded view
                                const triggerObj = rule.trigger || {};
                                const allConditions: any[] = triggerObj.conditions || (triggerObj.condition ? [triggerObj.condition] : []);
                                const condLabels = allConditions.map(describeCondition);
                                const isSuperseded = supersededIds.has(rule.id);
                                return (
                                  <div key={rule.id} ref={el => { ruleRowRefs.current[rule.id] = el; }}>
                                    {/* Collapsed row — click to expand */}
                                    <button
                                      className={`w-full text-left px-3 py-2 hover:bg-slate-50/70 transition-colors flex items-start gap-3
                                        ${isDupe ? 'bg-amber-50/40' : ''}
                                        ${isSuperseded ? 'opacity-50' : ''}`}
                                      onClick={() => setExpandedImpactRow(isExpanded ? null : rule.id)}
                                    >
                                      <ChevronDown className={`h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className={`text-[13px] font-medium leading-tight ${isSuperseded ? 'line-through text-slate-400' : 'text-slate-800'}`}>{rule.name || 'Unnamed rule'}</span>
                                          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${SL_COLORS[sl] || 'bg-slate-100 text-slate-600'}`}>{sl}</span>
                                          {isSuperseded && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">superseded</span>}
                                          {isBlanketSuppressed && !isSuperseded && (
                                            <span
                                              className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700"
                                              title={
                                                rule.suppressedByRules?.length
                                                  ? `Suppressed by: ${rule.suppressedByRules.map((r: any) => r.name).join(', ')}`
                                                  : 'Suppressed by a more-targeted rule'
                                              }
                                            >
                                              {rule.suppressedByRules?.length === 1
                                                ? `Suppressed by: ${rule.suppressedByRules[0].name}`
                                                : rule.suppressedByRules?.length > 1
                                                  ? `Suppressed by ${rule.suppressedByRules.length} targeted rules`
                                                  : 'suppressed by targeted rule'}
                                            </span>
                                          )}
                                          {isDupe && !isBlanketSuppressed && !isSuperseded && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">overlap — units counted once</span>}
                                          {/* A rule can legitimately affect 0 units. Say why, so the
                                              bare "0" isn't mistaken for a broken or miscounted rule. */}
                                          {units === 0 && !isBlanketSuppressed && !isSuperseded && rule.zeroReason && (
                                            <TooltipProvider delayDuration={200}>
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <span
                                                    className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 underline decoration-dotted cursor-help"
                                                    data-testid={`badge-zero-reason-${rule.id}`}
                                                  >
                                                    {zeroReasonLabel(rule.zeroReason)}
                                                  </span>
                                                </TooltipTrigger>
                                                <TooltipContent className="max-w-[280px]">
                                                  <p className="text-[11px] leading-relaxed">{zeroReasonDetail(rule.zeroReason)}</p>
                                                </TooltipContent>
                                              </Tooltip>
                                            </TooltipProvider>
                                          )}
                                        </div>
                                        <div className="text-[11px] text-slate-400 mt-0.5">
                                          {adjDisp} · {condLabels.length > 1 ? (
                                            <TooltipProvider delayDuration={200}>
                                              <Tooltip>
                                                <TooltipTrigger asChild>
                                                  <span className="underline decoration-dotted cursor-help">{triggerLabel}</span>
                                                </TooltipTrigger>
                                                <TooltipContent className="max-w-[220px]">
                                                  <p className="text-[11px] font-semibold mb-1">All conditions (AND):</p>
                                                  <ul className="text-[11px] space-y-0.5">
                                                    {condLabels.map((cl: string, ci: number) => (
                                                      <li key={ci}>✓ {cl}</li>
                                                    ))}
                                                  </ul>
                                                </TooltipContent>
                                              </Tooltip>
                                            </TooltipProvider>
                                          ) : triggerLabel}
                                        </div>
                                      </div>
                                      <div className="text-right shrink-0 pl-2">
                                        <div className={`text-sm font-bold tabular-nums ${isSuperseded ? 'text-slate-400 line-through' : isPos ? 'text-emerald-600' : 'text-red-600'}`}>{fmtImpact(annual)}</div>
                                        <div className="text-[11px] text-slate-400">{units.toLocaleString()} units</div>
                                        {!isPos && !isSuperseded && (
                                          <div className="text-[10px] text-amber-600 font-medium mt-0.5 leading-tight">Risked amt · upside w/ occ growth</div>
                                        )}
                                      </div>
                                    </button>
                                    {/* Expanded calculation detail */}
                                    {isExpanded && (
                                      <div className="mx-3 mb-2 rounded-lg bg-slate-50 border border-slate-200 p-3 text-[12px] space-y-2">
                                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Calculation Detail</p>
                                        {/* Trigger conditions */}
                                        {condLabels.length > 0 && (
                                          <div className="space-y-0.5">
                                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Conditions (all must be true)</p>
                                            {condLabels.map((cl: string, ci: number) => (
                                              <div key={ci} className="flex items-center gap-1.5">
                                                <span className="text-teal-400 text-[11px]">✓</span>
                                                <span className="text-slate-600">{cl}</span>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                        {condLabels.length === 0 && (
                                          <p className="text-slate-500 italic">Always active — no conditions.</p>
                                        )}
                                        {/* Math */}
                                        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-baseline border-t border-slate-200 pt-2">
                                          {avgRate !== null && (
                                            <>
                                              <span className="text-slate-500">Avg street rate</span>
                                              <span className="font-medium text-slate-700 tabular-nums">${Math.round(avgRate).toLocaleString()} / unit / mo</span>
                                            </>
                                          )}
                                          <span className="text-slate-500">Qualifying units</span>
                                          <span className="font-medium text-slate-700 tabular-nums">{units.toLocaleString()}</span>
                                          {moveIns !== null && (
                                            <>
                                              <span className="text-slate-500">Avg move-ins / mo</span>
                                              <span className="font-medium text-slate-700 tabular-nums">{Number(moveIns).toLocaleString()}</span>
                                            </>
                                          )}
                                          <span className="text-slate-500">Adjustment</span>
                                          <span className={`font-bold tabular-nums ${isPos ? 'text-emerald-700' : 'text-red-700'}`}>{adjDisp}{rateChg !== null && rateChg !== 0 ? ` (≈ ${rateChg > 0 ? '+' : '−'}$${Math.abs(Math.round(rateChg)).toLocaleString()} / unit / mo)` : ''}</span>
                                          <span className="text-slate-500">Monthly impact</span>
                                          {moveIns !== null && rateChg !== null && rateChg !== 0 ? (
                                            <span className={`font-medium tabular-nums ${isPos ? 'text-emerald-600' : 'text-red-600'}`}>
                                              {Number(moveIns).toLocaleString()} move-ins/mo × {rateChg > 0 ? '+' : '−'}${Math.abs(Math.round(rateChg)).toLocaleString()} = {fmtImpact(monthly)}
                                            </span>
                                          ) : (
                                            <span className={`font-medium tabular-nums ${isPos ? 'text-emerald-600' : 'text-red-600'}`}>{fmtImpact(monthly)}</span>
                                          )}
                                          <span className="text-slate-500">First-year impact</span>
                                          <span className={`font-bold tabular-nums ${isPos ? 'text-emerald-600' : 'text-red-600'}`}>{fmtImpact(monthly)} × 78 mo of stacked cohorts = {fmtImpact(annual)}</span>
                                        </div>
                                        {!isPos && (
                                          <div className="flex items-start gap-1.5 rounded bg-amber-50 border border-amber-200 px-2 py-1.5 text-[11px] text-amber-800">
                                            <span className="shrink-0">⚠</span>
                                            <span><span className="font-semibold">Risked amount — assumes no occupancy growth.</span> If the rate concession drives additional move-ins, the realized impact will be smaller (or positive). This figure represents the worst-case revenue at-risk with flat occupancy.</span>
                                          </div>
                                        )}
                                        <p className="text-[11px] text-slate-400 leading-relaxed">
                                          Only new move-ins pay the adjusted rate, so impact = qualifying units × the service line's move-in rate (trailing-3-month move-ins ÷ active units) × the rate change.
                                        </p>
                                        {/* Overlap / suppression warning for this specific rule */}
                                        {isDupe && (() => {
                                          const n = rule.overlapExcludedUnits || 0;
                                          const noun = n !== 1 ? 'units' : 'unit';
                                          const verb = n !== 1 ? 'are' : 'is';
                                          return isBlanketSuppressed ? (
                                            <div className="flex items-start gap-2 rounded bg-violet-50 border border-violet-200 px-2 py-1.5 text-[11px] text-violet-800">
                                              <span className="text-violet-500 shrink-0">⊘</span>
                                              <span>{n.toLocaleString()} {noun} this rule qualifies {verb} already governed by a more targeted (campus- or service-line-scoped) rule and counted there instead — the targeted rule takes priority for those units so nothing is double-counted.</span>
                                            </div>
                                          ) : (
                                            <div className="flex items-start gap-2 rounded bg-amber-50 border border-amber-200 px-2 py-1.5 text-[11px] text-amber-800">
                                              <span className="text-amber-500 shrink-0">⚠</span>
                                              <span>{n.toLocaleString()} {noun} this rule qualifies {verb} already covered by a higher-priority rule in the same scope tier and counted there instead — this rule's numbers include only the remaining units, so nothing is double-counted.</span>
                                            </div>
                                          );
                                        })()}
                                        {isBlanketSuppressed && rule.suppressedByRules?.length > 0 && (
                                          <div className="flex items-start gap-2 rounded bg-violet-50 border border-violet-200 px-2 py-1.5 text-[11px] text-violet-800 border-t border-slate-200">
                                            <span className="text-violet-500 shrink-0 mt-0.5">⊘</span>
                                            <div>
                                              <span className="font-semibold">Suppressed by targeted rule{rule.suppressedByRules.length > 1 ? 's' : ''}:</span>{' '}
                                              {rule.suppressedByRules.map((sr: any, si: number) => (
                                                <span key={sr.id ?? si}>
                                                  {si > 0 && <span className="text-violet-500">, </span>}
                                                  <button
                                                    className="underline decoration-dotted font-semibold hover:text-violet-900 transition-colors"
                                                    onClick={() => {
                                                      setExpandedImpactRow(sr.id);
                                                      setTimeout(() => {
                                                        const el = ruleRowRefs.current[sr.id];
                                                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                                      }, 50);
                                                    }}
                                                  >
                                                    {sr.name || 'Unnamed rule'}
                                                  </button>
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                        {rule.description && (
                                          <p className="text-[11px] text-slate-400 italic border-t border-slate-200 pt-2 leading-relaxed">{rule.description}</p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {/* Net total footer */}
                    <div className="mt-2 flex items-center justify-between px-3 py-2 rounded-lg bg-slate-100 border border-slate-200">
                      <span className="text-[13px] font-bold text-slate-700">Net Total</span>
                      <span className={`text-base font-black tabular-nums ${totalAnnualImpact >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtImpact(totalAnnualImpact)}/yr</span>
                    </div>
                  </div>
                );
              })()}

              {/* Methodology note */}
              <div className="rounded-lg bg-teal-50 border border-teal-100 p-3 text-[12px] text-slate-600 space-y-1.5">
                <p className="font-semibold text-teal-700 mb-1">How the math works</p>
                <p><span className="font-medium">Qualifying units</span> are those whose campus/service-line/room-type group currently meets the rule's trigger conditions (e.g. occupancy and competitor-variance thresholds) and matches the rule's filters.</p>
                <p><span className="font-medium">Monthly impact</span> = expected move-ins per month for qualifying units × the rate change per unit. Move-ins/mo = qualifying units × the service line's move-in rate (trailing-3-month move-ins ÷ active units). New residents come in at the adjusted rate, so impact accrues at the pace of move-ins.</p>
                <p><span className="font-medium">First-year impact</span> = Monthly impact × 78. Each month's move-in cohort keeps paying the rate change: month-1 move-ins pay it for 12 months, month-2 for 11, and so on (12+11+…+1 = 78 delta-months). In-house repricing rules are fully ramped immediately, so they use × 12.</p>
                <p><span className="font-medium">Fully ramped</span> = Monthly impact × 144: after 12 months of cohorts have accumulated, the ongoing annual run-rate (assumes residents stay 12+ months).</p>
                <p><span className="font-medium">HC &amp; HC/MC rates</span> are stored as daily rates in the system and are converted to monthly (× 30.4) before the calculation.</p>
                <p><span className="font-medium">Lift</span> = total from rules that increase rates. <span className="font-medium">Concessions</span> = total from rules that reduce rates. <span className="font-medium">Net</span> = Lift + Concessions.</p>
              </div>
            </DialogContent>
          </Dialog>
          </div>

          {/* ── Campus coverage drill-down modal ── */}
          <Dialog open={!!coverageRuleId} onOpenChange={(o) => { if (!o) setCoverageRuleId(null); }}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base font-bold">
                  <Building2 className="h-4 w-4 text-teal-500" />
                  Campus Breakdown
                </DialogTitle>
                {coverageData && (
                  <p className="text-[11px] text-slate-400 mt-0.5">{coverageData.ruleName}</p>
                )}
              </DialogHeader>

              {coverageLoading && (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-teal-400" />
                </div>
              )}

              {coverageData && !coverageLoading && (
                <>
                  {/* Summary row */}
                  <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded-lg text-center">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">Campuses</p>
                      <p className="text-xl font-black text-slate-700">{coverageData.campuses.length}</p>
                    </div>
                    <div className="border-l border-slate-200">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">Total Units</p>
                      <p className="text-xl font-black text-slate-700">{(coverageData.totalUnits || 0).toLocaleString()}</p>
                    </div>
                    <div className="border-l border-slate-200">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">Monthly Impact</p>
                      <p className={`text-xl font-black ${coverageData.totalMonthlyImpact >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fmtImpact(coverageData.totalMonthlyImpact)}
                      </p>
                    </div>
                  </div>

                  {/* Campus table */}
                  <div className="rounded-lg border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Campus</th>
                          <th className="text-right px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Units</th>
                          <th className="text-right px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Move-ins/mo</th>
                          <th className="text-right px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Avg Rate</th>
                          <th className="text-right px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Mo. Impact</th>
                          <th className="text-right px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Ann. Impact</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {coverageData.campuses.map((c: any, i: number) => (
                          <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-3 py-1.5 text-[13px] text-slate-700 font-medium max-w-[220px] truncate">{c.campusName}</td>
                            <td className="px-3 py-1.5 text-[13px] text-slate-600 tabular-nums text-right">{(c.unitCount || 0).toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-[13px] text-slate-600 tabular-nums text-right">{(c.moveInsPerMonth ?? 0).toLocaleString()}</td>
                            <td className="px-3 py-1.5 text-[13px] text-slate-600 tabular-nums text-right">${(c.avgRate || 0).toLocaleString()}</td>
                            <td className={`px-3 py-1.5 text-[13px] font-semibold tabular-nums text-right ${c.monthlyImpact >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {fmtImpact(c.monthlyImpact)}
                            </td>
                            <td className={`px-3 py-1.5 text-[13px] font-semibold tabular-nums text-right ${c.annualImpact >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {fmtImpact(c.annualImpact)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-50 border-t border-slate-200 font-bold">
                          <td className="px-3 py-2 text-[12px] text-slate-600">Total</td>
                          <td className="px-3 py-2 text-[12px] text-slate-700 tabular-nums text-right">{(coverageData.totalUnits || 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-[12px] text-slate-700 tabular-nums text-right">{(coverageData.totalMoveInsPerMonth ?? 0).toLocaleString()}</td>
                          <td className="px-3 py-2 text-[12px] text-slate-400 text-right">—</td>
                          <td className={`px-3 py-2 text-[13px] tabular-nums text-right ${coverageData.totalMonthlyImpact >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {fmtImpact(coverageData.totalMonthlyImpact)}
                          </td>
                          <td className={`px-3 py-2 text-[13px] tabular-nums text-right ${coverageData.totalMonthlyImpact >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {fmtImpact((coverageData.totalMonthlyImpact || 0) * 12)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}
            </DialogContent>
          </Dialog>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-teal-600 transition-colors disabled:opacity-40 shrink-0 mt-1"
            title="Refresh overview"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* mobile KPI strip */}
        {strategyOpen && activeRules.length > 0 && !isLoading && (
          <div className="flex sm:hidden gap-6 mt-3 pt-3 border-t border-slate-100">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">First-Year Net Impact</p>
              <p className={`text-2xl font-black leading-tight ${totalAnnualImpact >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtImpact(totalAnnualImpact)}</p>
            </div>
          </div>
        )}
      </div>

      {/* ══ TREND BAND ══ */}
      {strategyOpen && data?.pricingTrend && !isLoading && (
        <div className="px-6 py-2 border-b border-slate-100 bg-slate-50/60">
          <span className="text-[11px] font-black uppercase tracking-[0.18em] text-teal-600 mr-2">6-Mo Trend</span>
          <span className="text-sm leading-relaxed text-slate-600">{parseBold(data.pricingTrend)}</span>
        </div>
      )}

      {/* ══ RECOMMENDATION BAND ══ */}
      {strategyOpen && data?.recommendation && !isLoading && (
        <div className="px-6 py-2 border-b border-slate-100 bg-amber-50/50" data-testid="text-recommendation">
          {(() => {
            const lines = data.recommendation.split('\n').map((l: string) => l.trim()).filter(Boolean);
            const isBullets = lines.length > 1;
            if (!isBullets) {
              return (
                <>
                  <span className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-600 mr-2">Recommendation</span>
                  <span className="text-sm leading-snug text-slate-600">{parseBold(data.recommendation)}</span>
                  {onDraftRule && (
                    <button
                      type="button"
                      className="ml-2 inline-flex items-center gap-1 align-middle text-[11px] font-semibold text-teal-600 hover:text-teal-800 border border-teal-200 hover:border-teal-400 rounded-md px-1.5 py-0.5 transition-colors"
                      title="Have AI draft an adjustment rule implementing this recommendation"
                      onClick={() => onDraftRule(data.recommendation!.replace(/\*\*/g, ''))}
                      data-testid="button-draft-rule-single"
                    >
                      <Sparkles className="h-3 w-3" />
                      Draft rule
                    </button>
                  )}
                </>
              );
            }
            // Collapsed: one-sentence summary of the first bullet + count of the rest
            const stripMd = (s: string) => s.replace(/\*\*/g, '').replace(/^[•\-\*]\s*/, '');
            const firstSentence = (() => {
              const t = stripMd(lines[0]);
              const m = t.match(/^.*?[.!?](?=\s|$)/);
              return m ? m[0] : t;
            })();
            return (
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  aria-expanded={recsOpen}
                  className="flex items-start justify-between gap-2 w-full text-left group"
                  onClick={() => setRecsOpen(o => !o)}
                  data-testid="button-toggle-recommendations"
                >
                  <div className="min-w-0">
                    <span className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-600 mr-2">
                      Recommendation{lines.length > 1 ? `s (${lines.length})` : ''}
                    </span>
                    {!recsOpen && (
                      <span className="text-[13px] leading-snug text-slate-600">
                        {firstSentence}{lines.length > 1 && <span className="text-slate-400"> · +{lines.length - 1} more</span>}
                      </span>
                    )}
                  </div>
                  <ChevronDown className={`h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500 group-hover:text-amber-700 transition-transform duration-200 ${recsOpen ? '' : '-rotate-90'}`} />
                </button>
                {recsOpen && lines.map((line: string, i: number) => (
                  <div key={i} className="flex items-start gap-2">
                    <p className="text-[13px] leading-snug text-slate-600 min-w-0 flex-1">{parseBold(line)}</p>
                    {onDraftRule && (
                      <button
                        type="button"
                        className="shrink-0 mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-teal-600 hover:text-teal-800 border border-teal-200 hover:border-teal-400 rounded-md px-1.5 py-0.5 transition-colors"
                        title="Have AI draft an adjustment rule implementing this recommendation"
                        onClick={() => onDraftRule(line.replace(/\*\*/g, '').replace(/^[•\-\*]\s*/, ''))}
                        data-testid={`button-draft-rule-${i}`}
                      >
                        <Sparkles className="h-3 w-3" />
                        Draft rule
                      </button>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* ══ COMPETITIVE POSITION SCATTER ══ */}
      {strategyOpen && compPositionData.length > 0 && (
        <>
          <div className={`px-6 border-b border-slate-100 ${scatterOpen ? 'py-4' : 'py-2'}`}>
            <div className={`flex items-center justify-between ${scatterOpen ? 'mb-3' : ''}`}>
              <button
                type="button"
                aria-expanded={scatterOpen}
                className="flex items-center gap-2 group min-w-0"
                onClick={() => setScatterOpen(o => !o)}
                data-testid="button-toggle-scatter"
              >
                <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 group-hover:text-slate-600 transition-colors">Competitive Position</span>
                <span className="text-[11px] text-slate-400">· {compPositionData.length} location/SL combinations</span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 ${scatterOpen ? '' : '-rotate-90'}`} />
              </button>
              {scatterOpen && (
                <div className="flex items-center gap-3">
                  <span className="hidden sm:inline text-[11px] text-slate-400 italic">X = occupancy · Y = Studio rate vs top competitor (overall rate for VIL)</span>
                  <button
                    onClick={() => setScatterExpanded(true)}
                    className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                    title="Expand chart"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
            {scatterOpen && (
              <>
                {renderScatterChart(200, 12)}
                {renderScatterLegend("text-xs")}
              </>
            )}
          </div>

          {/* Fullscreen scatter dialog */}
          <Dialog open={scatterExpanded} onOpenChange={setScatterExpanded}>
            <DialogContent className="max-w-[96vw] w-[1200px] max-h-[95vh] flex flex-col gap-0 p-0 overflow-hidden">
              <DialogHeader className="px-6 pt-5 pb-3 border-b border-slate-100 shrink-0">
                <div className="flex items-center justify-between">
                  <DialogTitle className="text-base font-semibold text-slate-800">Competitive Position</DialogTitle>
                  <button
                    onClick={() => setScatterExpanded(false)}
                    className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors"
                    title="Collapse chart"
                  >
                    <Minimize2 className="h-3 w-3" />
                    Collapse
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {compPositionData.length} location/SL combinations · X = occupancy · Y = Studio rate vs top competitor (overall rate for VIL)
                </p>
              </DialogHeader>
              <div className="flex-1 px-6 pt-4 pb-2 min-h-0">
                {renderScatterChart(500, 11)}
              </div>
              <div className="px-6 pb-5 shrink-0">
                {renderScatterLegend("text-xs")}
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* ══ SCATTER DOT POPUP ══ */}
      {pinnedScatterPoint && scatterPopupPos && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(scatterPopupPos.x + 10, window.innerWidth - 268),
            top: Math.max(scatterPopupPos.y - 20, 8),
            zIndex: 9999,
          }}
          className="bg-white border border-slate-200 rounded-xl shadow-2xl p-3 w-64 text-[11px]"
        >
          {/* header */}
          <div className="flex items-start justify-between mb-1.5">
            <p className="font-bold text-slate-800 text-xs leading-tight">{pinnedScatterPoint.location}</p>
            <button
              onClick={() => setPinnedScatterPoint(null)}
              className="text-slate-400 hover:text-slate-700 ml-2 -mt-0.5 shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* data rows */}
          <p className="text-slate-500">{SL_DISPLAY[pinnedScatterPoint.serviceLine] || pinnedScatterPoint.serviceLine} · Occ: <strong>{pinnedScatterPoint.occupancy}%</strong></p>
          <p className="text-slate-500">Our Studio Rate: <strong>${pinnedScatterPoint.ourRate?.toLocaleString()}</strong></p>
          <p className="text-slate-500">
            Top Comp{pinnedScatterPoint.topCompetitor ? ` (${pinnedScatterPoint.topCompetitor})` : ''}: <strong>${pinnedScatterPoint.compRate?.toLocaleString()}</strong>
            {pinnedScatterPoint.rawCompRate && pinnedScatterPoint.rawCompRate !== pinnedScatterPoint.compRate && (
              <span className="text-slate-400"> (base ${pinnedScatterPoint.rawCompRate?.toLocaleString()}{pinnedScatterPoint.careAdj ? `, care ${pinnedScatterPoint.careAdj > 0 ? '+' : ''}${pinnedScatterPoint.careAdj?.toLocaleString()}` : ''})</span>
            )}
          </p>
          {pinnedScatterPoint.avgCompRate != null && (
            <p className="text-slate-500">Market Avg: <strong>${pinnedScatterPoint.avgCompRate?.toLocaleString()}</strong>{pinnedScatterPoint.compCount ? <span className="text-slate-400"> · {pinnedScatterPoint.compCount} comps</span> : null}</p>
          )}
          <p className={`font-bold mt-0.5 ${pinnedScatterPoint.marketPosition > 100 ? 'text-emerald-600' : pinnedScatterPoint.marketPosition < 95 ? 'text-amber-600' : 'text-slate-600'}`}>
            {(() => { const delta = Math.round(pinnedScatterPoint.marketPosition - 100); return delta > 0 ? `+${delta}% above top competitor` : delta < 0 ? `${delta}% below top competitor` : 'At top competitor rate'; })()}
          </p>

          {/* quick rate adjust */}
          <div className="mt-2.5 pt-2 border-t border-slate-100">
            <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-wide mb-1.5">
              Quick adjust — {SL_DISPLAY[pinnedScatterPoint.serviceLine] || pinnedScatterPoint.serviceLine} rate
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => quickAdjustMutation.mutate({ location: pinnedScatterPoint.location, serviceLine: pinnedScatterPoint.serviceLine, pct: -1 })}
                disabled={quickAdjustMutation.isPending}
                className="flex-1 flex items-center justify-center gap-0.5 py-1 rounded-md text-[11px] font-bold bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors disabled:opacity-40"
              >
                <Minus className="h-2.5 w-2.5" />1%
              </button>
              <button
                onClick={() => quickAdjustMutation.mutate({ location: pinnedScatterPoint.location, serviceLine: pinnedScatterPoint.serviceLine, pct: 1 })}
                disabled={quickAdjustMutation.isPending}
                className="flex-1 flex items-center justify-center gap-0.5 py-1 rounded-md text-[11px] font-bold bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-200 transition-colors disabled:opacity-40"
              >
                +1%
              </button>
            </div>
          </div>

          {/* change prices link */}
          <a
            href={`/pricing-controls?location=${encodeURIComponent(pinnedScatterPoint.location)}&serviceLine=${encodeURIComponent(pinnedScatterPoint.serviceLine)}`}
            onClick={() => setPinnedScatterPoint(null)}
            className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-teal-600 hover:text-teal-800 transition-colors"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            Change prices for this location
          </a>
        </div>
      )}

      {/* ══ ACTIVE RULES ══ */}
      {strategyOpen && activeRules.length > 0 && (
        <div className="px-6 py-5">
          {/* section label */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Active Rules</span>
              {data?.rulesSummary && (
                <span className="hidden sm:inline text-xs text-slate-400 font-normal">— {data.rulesSummary}</span>
              )}
            </div>
            <button
              className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-teal-600 transition-colors border border-slate-200 rounded-md px-2 py-1"
              onClick={() => setFullMapOpen(true)}
            >
              <Maximize2 className="h-3 w-3" />
              Coverage Map
            </button>
          </div>

          {/* Rules grouped by strategic intent */}
          <div className="flex flex-col gap-2">
            {RULE_GROUPS.map(group => {
              const groupRules = activeRules.filter((r: any) => getRuleCategory(r) === group.id);
              if (!groupRules.length) return null;
              const GroupIcon = group.icon;

              const byDate: Record<string, any[]> = {};
              groupRules.forEach((r: any) => {
                const dk = r.effectiveDate ? String(r.effectiveDate).slice(0, 7) : 'ongoing';
                (byDate[dk] ??= []).push(r);
              });

              const groupImpact = groupRules
                .filter((r: any) => !supersededIds.has(r.id))
                .reduce((s: number, r: any) => s + (r.annualImpact || 0), 0);
              const groupOpen = openRuleGroups[group.id] ?? true;

              return (
                <div key={group.id} className="rounded-lg border border-slate-200 bg-white overflow-hidden"
                  style={{ borderLeftWidth: 3, borderLeftColor: group.accent }}>

                  {/* ── Group header (click to expand/collapse) ── */}
                  <button
                    type="button"
                    aria-expanded={groupOpen}
                    className={`flex items-center justify-between px-3 py-1.5 bg-slate-50/80 w-full text-left hover:bg-slate-100/80 transition-colors ${groupOpen ? 'border-b border-slate-100' : ''}`}
                    onClick={() => setOpenRuleGroups(prev => ({ ...prev, [group.id]: !groupOpen }))}
                    data-testid={`button-toggle-group-${group.id}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 ${groupOpen ? '' : '-rotate-90'}`} />
                      <GroupIcon className="h-3.5 w-3.5 shrink-0" style={{ color: group.accent }} />
                      <p className="text-xs font-bold text-slate-700 leading-tight">{group.label}</p>
                      <span className="hidden sm:inline text-xs text-slate-400">— {group.description}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 pl-2">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${group.badge}`}>
                        {groupRules.length}
                      </span>
                      {groupImpact !== 0 && (
                        <span className={`text-sm font-bold tabular-nums ${groupImpact >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {fmtImpact(groupImpact)}<span className="text-xs font-normal text-slate-400">/yr</span>
                        </span>
                      )}
                    </div>
                  </button>

                  {/* ── Date sub-groups ── */}
                  {groupOpen && <div className="divide-y divide-slate-100">
                    {Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([dateKey, dateRules]) => {
                      const isFuture = dateKey !== 'ongoing' && `${dateKey}-28` > today;
                      const dateLabel = dateKey === 'ongoing'
                        ? 'Always'
                        : new Date(`${dateKey}-01T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

                      const rep = dateRules[0];
                      const { display: adjDisplay, isIncrease } = getActionInfo(rep);
                      const trigger = getTriggerLabel(rep);
                      const countedRules = dateRules.filter((r: any) => !supersededIds.has(r.id));
                      const subImpact = countedRules.reduce((s: number, r: any) => s + (r.annualImpact || 0), 0);
                      const subUnits = countedRules.reduce((s: number, r: any) => s + (r.affectedUnits || 0), 0);

                      return (
                        <div key={dateKey} className="px-3 py-1.5 flex items-center gap-2.5 hover:bg-slate-50/50 transition-colors">

                          {/* Date badge */}
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap
                            ${isFuture ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                            {dateLabel}
                          </span>

                          {/* Adjustment */}
                          <span className={`w-9 shrink-0 text-sm font-black tabular-nums
                            ${isIncrease ? 'text-emerald-600' : 'text-red-600'}`}>
                            {adjDisplay}
                          </span>

                          {/* Service line pills */}
                          <div className="flex gap-1 flex-wrap flex-1 min-w-0">
                            {dateRules
                              .sort((a: any, b: any) => (a.serviceLine || '').localeCompare(b.serviceLine || ''))
                              .map((r: any) => {
                                const sl = r.serviceLine || 'All';
                                const isSuperseded = supersededIds.has(r.id);
                                return (
                                  <span key={r.id} className="inline-flex items-center gap-0.5">
                                    <button
                                      onClick={() => setSelectedRule(r)}
                                      title={r.name}
                                      className={`text-xs font-semibold px-2 py-0.5 rounded-full hover:opacity-75 transition-opacity cursor-pointer
                                        ${isSuperseded ? 'opacity-40 line-through' : ''}
                                        ${SL_COLORS[sl] || 'bg-slate-100 text-slate-600'}`}
                                    >
                                      {SL_FULL[sl] || sl}
                                    </button>
                                    <button
                                      onClick={() => setCoverageRuleId(r.id)}
                                      title={`See campus breakdown for ${r.name}`}
                                      className="p-0.5 rounded text-slate-300 hover:text-teal-500 hover:bg-teal-50 transition-colors"
                                    >
                                      <Building2 className="h-3 w-3" />
                                    </button>
                                  </span>
                                );
                              })}
                          </div>

                          {/* Trigger */}
                          <div className="hidden md:flex items-center gap-1 shrink-0 text-xs text-slate-400">
                            <Zap className="h-3 w-3 text-slate-300 shrink-0" />
                            {formatConditionLines(rep).length > 1 ? (
                              <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="whitespace-nowrap underline decoration-dotted cursor-help">{trigger}</span>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[220px]">
                                    <p className="text-[11px] font-semibold mb-1">All conditions (AND):</p>
                                    <ul className="text-[11px] space-y-0.5">
                                      {formatConditionLines(rep).map((cl: string, ci: number) => (
                                        <li key={ci}>✓ {cl}</li>
                                      ))}
                                    </ul>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            ) : (
                              <span className="whitespace-nowrap">{trigger}</span>
                            )}
                          </div>

                          {/* Impact */}
                          <div className="hidden lg:flex items-baseline gap-1 shrink-0 text-right">
                            {subImpact !== 0 && (
                              <span className={`text-sm font-bold tabular-nums ${subImpact >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {fmtImpact(subImpact)}
                              </span>
                            )}
                            {subUnits > 0 && (
                              <span className="text-xs text-slate-400">{subUnits.toLocaleString()} units</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!hasData && !isLoading && (
        <p className="text-sm text-slate-400 italic py-8 text-center px-6">
          {activeRules.length > 0
            // Telling someone to "add pricing rules" while their rules are sitting right
            // there is just confusing — this branch means generation failed, not that the
            // portfolio is empty.
            ? "Overview couldn't be generated just now. Use the refresh button above to try again."
            : 'No overview available — add pricing rules to generate insights.'}
        </p>
      )}

      {isLoading && !hasData && (
        <div className="px-6 py-5 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
          {[1,2,3,4].map(i => <div key={i} className="h-28 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      )}

      {/* ── Footer ── */}
      {data?.generatedAt && !isLoading && (
        <div className="px-6 pb-3 text-[11px] text-slate-300 border-t border-slate-100 pt-2.5">
          AI overview · {new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {/* ── Rule detail dialog ── */}
      <Dialog open={!!selectedRule} onOpenChange={(o) => !o && setSelectedRule(null)}>
        <DialogContent className="max-w-lg">
          {selectedRule && (() => {
            const cleanName = (selectedRule.name || '').replace(/\s*\+\s*\d+\s*more\s*$/i, '').trim();
            const { positive, display } = getActionInfo(selectedRule);
            const sls = getSLs(selectedRule);
            const annual = selectedRule.annualImpact || 0;
            const monthly = selectedRule.monthlyImpact || 0;
            const units = selectedRule.affectedUnits || 0;
            const eff = selectedRule.effectiveDate ? String(selectedRule.effectiveDate).slice(0, 10) : null;
            const isFuture = eff && eff > today;
            const commentaryRule = data?.rules?.find((r: any) => r.name === selectedRule.name || r.name === cleanName);

            const triggerObj = selectedRule.trigger || {};
            const isImmediate = triggerObj.type === 'immediate';
            const allConditions: any[] = triggerObj.conditions || (triggerObj.condition ? [triggerObj.condition] : []);
            const condFieldMap: Record<string, string> = {
              service_line_occupancy: 'SL occupancy',
              room_type_occupancy: 'Room type occupancy',
              campus_occupancy: 'Campus occupancy',
              days_vacant: 'Days vacant',
              street_to_comp_var: 'Street vs top comp',
              vacant_units: 'Vacant units',
            };
            const condLabels = allConditions.map((c: any) => {
              const fn = condFieldMap[c.field] || (c.field || '').replace(/_/g, ' ');
              const op = c.operator === '>=' ? '≥' : c.operator === '<=' ? '≤' : c.operator === '<' ? '<' : c.operator === '>' ? '>' : c.operator;
              const val = c.field?.includes('occupancy') ? `${Math.round((c.value || 0) * 100)}%` : c.field === 'street_to_comp_var' ? `${c.value}%` : String(c.value);
              return `${fn} ${op} ${val}`;
            });

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <span className={`text-sm font-bold px-2 py-1 rounded ${positive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {display}
                    </span>
                    {cleanName}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-1">
                  {/* KPI row */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wider text-slate-400 mb-0.5">First-Year Impact</p>
                      <p className={`text-lg font-bold ${annual >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtImpact(annual)}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wider text-slate-400 mb-0.5">Monthly</p>
                      <p className={`text-lg font-bold ${monthly >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtImpact(monthly)}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-center">
                      <p className="text-[11px] uppercase tracking-wider text-slate-400 mb-0.5">Units Affected</p>
                      <p className="text-lg font-bold text-slate-700">{units.toLocaleString()}</p>
                    </div>
                  </div>
                  {units === 0 && !isImmediate && condLabels.length > 0 && (
                    <p className="text-[11px] text-slate-400 -mt-1">
                      No units currently meet all trigger conditions — impact will update when conditions are met.
                    </p>
                  )}
                  {units > 0 && (() => {
                    const moveIns  = selectedRule.moveInsPerMonth ?? null;
                    const rateChg  = selectedRule.avgRateChange   ?? null;
                    return (
                      <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 space-y-1.5 -mt-1">
                        {moveIns !== null && rateChg !== null && rateChg !== 0 && (
                          <p className="text-[12px] font-mono text-slate-600">
                            {Number(moveIns).toLocaleString(undefined, { maximumFractionDigits: 1 })} new move-ins/mo
                            {' × '}{rateChg > 0 ? '+' : '−'}${Math.abs(Math.round(rateChg)).toLocaleString()}/unit
                            {' = '}<span className={monthly >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-red-600'}>{fmtImpact(monthly)}/mo</span>
                          </p>
                        )}
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          <span className="font-semibold text-slate-600">Only new admissions pay the adjusted rate</span> — in-house residents keep their existing rate. Impact = qualifying units × T3 move-in rate (trailing 3-month move-ins ÷ active units for this service line) × rate change.
                        </p>
                        <button
                          className="text-[11px] text-teal-600 hover:underline flex items-center gap-1"
                          onClick={() => setLocation('/pricing-algorithm#measurement')}
                        >
                          <Info className="h-3 w-3" /> How impact is measured →
                        </button>
                      </div>
                    );
                  })()}

                  {/* Rule details */}
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-[11px] uppercase tracking-wider text-slate-400 w-20 shrink-0 pt-0.5">Trigger</span>
                      {isImmediate || condLabels.length === 0 ? (
                        <span className="text-slate-700 font-medium">Always active</span>
                      ) : (
                        <div className="space-y-0.5">
                          {condLabels.map((label, ci) => (
                            <div key={ci} className="flex items-center gap-1.5">
                              <span className="text-teal-500 text-[11px]">✓</span>
                              <span className="text-slate-700 font-medium">{label}</span>
                            </div>
                          ))}
                          {condLabels.length > 1 && (
                            <p className="text-[10px] text-slate-400 mt-0.5">All conditions must be true</p>
                          )}
                        </div>
                      )}
                    </div>
                    {sls.length > 0 && (
                      <div className="flex items-start gap-2">
                        <span className="text-[11px] uppercase tracking-wider text-slate-400 w-20 shrink-0 pt-0.5">Service Lines</span>
                        <div className="flex gap-1 flex-wrap">
                          {sls.map(sl => (
                            <span key={sl} className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${SL_COLORS[sl] || 'bg-slate-100 text-slate-600'}`}>{sl}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {eff && (
                      <div className="flex items-start gap-2">
                        <span className="text-[11px] uppercase tracking-wider text-slate-400 w-20 shrink-0 pt-0.5">Effective</span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${isFuture ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                          {isFuture ? 'Starts' : 'Active since'} {new Date(`${eff}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* AI strategy description from commentary */}
                  {commentaryRule?.strategy && (
                    <div className="rounded-lg bg-teal-50 border border-teal-100 px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-teal-600 mb-1.5 flex items-center gap-1">
                        <Sparkles className="h-3 w-3" /> AI Analysis
                      </p>
                      <p className="text-[13px] leading-relaxed text-slate-700">{parseBold(commentaryRule.strategy)}</p>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Full bubble map dialog ── */}
      <Dialog open={fullMapOpen} onOpenChange={setFullMapOpen}>
        <DialogContent ref={bubbleMapScrollRef} className="max-w-3xl max-h-[88vh] overflow-y-auto bg-white border border-gray-200">
          <DialogHeader>
            <DialogTitle className="text-gray-900 text-base">Rule Coverage — Bubble Map</DialogTitle>
            <p className="text-xs text-gray-500 mt-1">Each circle represents one rule. Circle size is proportional to units affected. Hover for metrics — click any circle to view details.</p>
          </DialogHeader>

          {activeRules.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">No active rules to display.</div>
          ) : (
            <div className="flex flex-wrap gap-5 p-6 bg-white rounded-xl border border-gray-100 justify-center items-end mt-2">
              {(() => {
                const maxImpact = Math.max(...activeRules.map((r: any) => Math.abs(r.annualImpact || 0)), 1);
                const MIN_R = 40, MAX_R = 96;
                return activeRules.map((rule: any, ri: number) => {
                  const impact  = Math.abs(rule.annualImpact || 0);
                  const t       = Math.sqrt(impact / maxImpact);
                  const radius  = MIN_R + t * (MAX_R - MIN_R);
                  const size    = Math.round(radius) * 2 + 4;
                  const annual  = rule.annualImpact || 0;
                  const monthly = rule.monthlyImpact || 0;
                  const isNeg   = annual < 0;
                  const color   = PALETTE[ri % PALETTE.length];
                  const gradId  = `fullmap-grad-${rule.id}`;
                  const isAdditive = (rule.action?.applicationMode ?? 'additive') === 'additive';
                  const showLabel  = radius >= 56;
                  const isHov      = hoveredBubbleMap === rule.id;
                  const units      = rule.affectedUnits || 0;
                  const campuses   = rule.affectedCampuses || 0;

                  return (
                    <div key={rule.id}
                      className="relative flex flex-col items-center gap-2"
                      onMouseEnter={onBubbleEnter(rule.id)}
                      onMouseLeave={onBubbleLeave}
                      onClick={() => { setFullMapOpen(false); setTimeout(() => setSelectedRule(rule), 80); }}
                      style={{ cursor: 'pointer' }}
                      title="Click to view rule details"
                    >
                      <svg width={size} height={size} style={{ overflow: 'visible' }}>
                        <defs>
                          <radialGradient id={gradId} cx="38%" cy="35%" r="65%">
                            <stop offset="0%"   stopColor={color} stopOpacity={isHov ? 0.28 : 0.18} />
                            <stop offset="100%" stopColor={color} stopOpacity={isHov ? 0.52 : 0.38} />
                          </radialGradient>
                        </defs>
                        {!isAdditive && (
                          <circle cx={size/2} cy={size/2} r={radius + 5}
                            fill="none" stroke={color} strokeWidth={1.5}
                            strokeDasharray="5 4" opacity={0.35} />
                        )}
                        <circle cx={size/2} cy={size/2} r={radius}
                          fill={`url(#${gradId})`}
                          stroke={color}
                          strokeWidth={isHov ? 2.5 : 1.8} />
                        {showLabel && annual !== 0 && (
                          <text x={size/2} y={size/2 + 2}
                            textAnchor="middle" dominantBaseline="middle"
                            fontSize={radius >= 70 ? 14 : 11} fontWeight="700" fill={color}>
                            {isNeg ? '-' : '+'}{Math.abs(annual) >= 1_000_000
                              ? `$${(Math.abs(annual)/1_000_000).toFixed(1)}M`
                              : Math.abs(annual) >= 1_000
                              ? `$${Math.round(Math.abs(annual)/1_000)}K`
                              : `$${Math.round(Math.abs(annual))}`}
                          </text>
                        )}
                        {!isAdditive && (
                          <text x={size/2} y={size/2 - radius + 13}
                            textAnchor="middle" fontSize={9} fontWeight="600"
                            fill={color} opacity={0.7}>PRIORITY</text>
                        )}
                      </svg>

                      <div className="text-center" style={{ maxWidth: Math.max(size + 8, 90) }}>
                        <p className="text-[11px] font-semibold text-gray-800 leading-tight line-clamp-2">{rule.name}</p>
                        {(units > 0 || campuses > 0) && (
                          <p className="text-[10px] text-gray-400 mt-0.5">{units.toLocaleString()} units · {campuses} campus{campuses !== 1 ? 'es' : ''}</p>
                        )}
                      </div>

                      {isHov && createPortal(
                        <div
                          ref={bubbleTipRef}
                          className="fixed z-[100] pointer-events-none"
                          style={{
                            minWidth: 200,
                            maxWidth: 280,
                            top: bubbleTipPos?.top ?? 0,
                            left: bubbleTipPos?.left ?? 0,
                            // Hidden for the single frame before it is measured.
                            opacity: bubbleTipPos ? 1 : 0,
                          }}
                        >
                          <div className="bg-white border border-gray-200 rounded-xl shadow-2xl p-4">
                            <p className="text-xs font-bold text-gray-900 leading-snug mb-2">{rule.name}</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] mb-2">
                              <span className="text-gray-400">Units</span>
                              <span className="font-semibold text-gray-900 text-right">{units.toLocaleString()}</span>
                              <span className="text-gray-400">Campuses</span>
                              <span className="font-semibold text-gray-900 text-right">{campuses}</span>
                              <span className="text-gray-400">Monthly impact</span>
                              <span className={`font-semibold text-right ${monthly >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmtImpact(monthly)}</span>
                              <span className="text-gray-400">First-year impact</span>
                              <span className={`font-bold text-right ${annual >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{fmtImpact(annual)}</span>
                            </div>
                            <div className="pt-2 border-t border-gray-100 flex justify-between text-[10px]">
                              <span className="text-gray-400">Application mode</span>
                              <span className={`font-semibold ${isAdditive ? 'text-teal-700' : 'text-amber-700'}`}>
                                {isAdditive ? 'Additive' : 'Exclusive (priority)'}
                              </span>
                            </div>
                          </div>
                          {/* Arrow sits under the bubble's centre. Omitted when the card
                              had to be clamped across the anchor, where it would not
                              point at anything meaningful. */}
                          {bubbleTipPos?.arrowSide && (
                            <div
                              className="absolute w-0 h-0"
                              style={{
                                left: bubbleTipPos.arrowLeft,
                                transform: 'translateX(-50%)',
                                ...(bubbleTipPos.arrowSide === 'bottom'
                                  ? { top: '100%', borderTop: '7px solid #e5e7eb' }
                                  : { bottom: '100%', borderBottom: '7px solid #e5e7eb' }),
                                borderLeft: '7px solid transparent',
                                borderRight: '7px solid transparent',
                              }}
                            />
                          )}
                        </div>,
                        document.body
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          )}

          <div className="flex flex-wrap gap-5 text-[11px] text-gray-500 pt-1 px-1">
            <span className="flex items-center gap-1.5">
              <svg width={14} height={14}><circle cx={7} cy={7} r={6} fill="none" stroke="#0d9488" strokeWidth={1.5} /></svg>
              Additive — stacks with other rules
            </span>
            <span className="flex items-center gap-1.5">
              <svg width={16} height={14}><circle cx={8} cy={7} r={6} fill="none" stroke="#d97706" strokeWidth={1.5} strokeDasharray="4 3" /></svg>
              Exclusive — dashed ring, claims units by priority
            </span>
            <span className="flex items-center gap-1.5">
              <svg width={10} height={10}><circle cx={5} cy={5} r={4} fill="#0d9488" opacity={0.3} /></svg>
              Circle size ∝ first-year revenue impact
            </span>
          </div>
        </DialogContent>
      </Dialog>
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

interface ComputedCareRate {
  locationId: string;
  locationName: string;
  serviceLine: string;
  computedRate: number;
}

const ALL_SERVICE_LINES = ["HC", "HC/MC", "AL", "AL/MC", "SL", "VIL"] as const;

function CareLevel2RatesPanel() {
  const { toast } = useToast();
  const [panelOpen, setPanelOpen] = useState(false);

  const { data: locationsData } = useQuery<{ locations?: Array<{ id: string; name: string }> }>({
    queryKey: ["/api/locations"],
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const { data: existingRates = [], isLoading, refetch: refetchSaved } = useQuery<CareLevelRateRow[]>({
    queryKey: ["/api/care-level-rates"],
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const { data: computedRates = [], isLoading: isLoadingComputed, refetch: refetchComputed } = useQuery<ComputedCareRate[]>({
    queryKey: ["/api/care-level-rates/computed"],
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    enabled: panelOpen,
  });

  // Active service lines per location: locationId → string[]
  const { data: locationServiceLines = {} } = useQuery<Record<string, string[]>>({
    queryKey: ["/api/locations/service-lines"],
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // Map of "locationId|sl" → rate value string (for in-progress edits)
  const [pendingRates, setPendingRates] = useState<Record<string, string>>({});
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [filterLocation, setFilterLocation] = useState<string>("");
  const [filterSL, setFilterSL] = useState<string>("All");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Keys where override is manually toggled on/off by the user (null = use default logic)
  const [overrideToggle, setOverrideToggle] = useState<Record<string, boolean>>({});

  // Build quick-lookup maps
  const existingMap = useMemo(
    () => new Map<string, number>(existingRates.map(r => [`${r.locationId}|${r.serviceLine}`, r.level2Rate])),
    [existingRates]
  );
  const computedMap = useMemo(
    () => new Map<string, number>(computedRates.map(r => [`${r.locationId}|${r.serviceLine}`, r.computedRate])),
    [computedRates]
  );

  const getKey = (locationId: string, sl: string) => `${locationId}|${sl}`;

  // Override is active only when a saved rate exists AND it differs from the
  // computed (from-data) value. If the saved rate matches what the data already
  // provides, there's nothing to override — the default is already correct.
  const isOverrideOn = (key: string) => {
    if (overrideToggle[key] !== undefined) return overrideToggle[key];
    const saved = existingMap.get(key);
    if (saved == null) return false;
    const computed = computedMap.get(key);
    // Same as data → not really an override
    if (computed != null && saved === computed) return false;
    return true;
  };

  const getDisplayValue = (locationId: string, sl: string): string => {
    const key = getKey(locationId, sl);
    if (pendingRates[key] !== undefined) return pendingRates[key];
    const existing = existingMap.get(key);
    if (existing != null) return String(existing);
    // Pre-populate from computed so the user has a sensible starting point
    const computed = computedMap.get(key);
    return computed != null ? String(computed) : "";
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

  const deleteMutation = useMutation({
    mutationFn: async ({ locationId, serviceLine }: { locationId: string; serviceLine: string }) => {
      const res = await apiRequest("/api/care-level-rates", "DELETE", { locationId, serviceLine });
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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refetchSaved(), refetchComputed()]);
      toast({ title: "Rates refreshed", description: "Latest active rates and overrides loaded." });
    } finally {
      setIsRefreshing(false);
    }
  };

  // Determine which service lines to show in the column filter buttons
  const activeSLsAcrossAll = new Set<string>();
  for (const sls of Object.values(locationServiceLines)) {
    sls.forEach(sl => activeSLsAcrossAll.add(sl));
  }
  const displayableSLs = activeSLsAcrossAll.size > 0
    ? ALL_SERVICE_LINES.filter(sl => activeSLsAcrossAll.has(sl))
    : [...ALL_SERVICE_LINES];
  const filterableSLs = filterSL === "All" ? displayableSLs : [filterSL];

  const allLocations = locationsData?.locations ?? [];
  const filteredLocations = filterLocation
    ? allLocations.filter(l => l.name.toLowerCase().includes(filterLocation.toLowerCase()))
    : allLocations;

  return (
    <Card data-testid="card-care-level-rates" className="w-full shadow-sm bg-white border border-gray-200">
      <CardHeader
        className="pb-4 cursor-pointer select-none hover:bg-gray-50 rounded-t-lg transition-colors"
        onClick={() => setPanelOpen(o => !o)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-rose-500" />
            <span className="text-base font-semibold text-gray-900">Level 2 Care Rates</span>
          </div>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${panelOpen ? '' : '-rotate-90'}`} />
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Set the posted Level 2 care rate per location and service line. These rates are used in the competitor adjustment formula (adjustedRate = base + theirCareL2 − ourCareL2 + …) so the pricing breakdown shows the correct "ours" value without re-uploading rent roll data.
        </p>
      </CardHeader>
      {panelOpen && (
      <CardContent>
        {/* Filters + Refresh */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Input
            placeholder="Filter by location name…"
            value={filterLocation}
            onChange={e => setFilterLocation(e.target.value)}
            className="max-w-xs text-sm"
          />
          <div className="flex flex-wrap gap-1 flex-1">
            {["All", ...displayableSLs].map(sl => (
              <Button
                key={sl}
                variant={filterSL === sl ? "default" : "outline"}
                size="sm"
                className="text-xs"
                onClick={e => { e.stopPropagation(); setFilterSL(sl); }}
              >
                {sl === "All" ? "All Service Lines" : sl}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5 shrink-0"
            onClick={e => { e.stopPropagation(); handleRefresh(); }}
            disabled={isRefreshing || isLoadingComputed}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {(isLoading || isLoadingComputed) ? (
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
                    <th key={sl} className="text-left py-2 px-3 font-medium text-gray-600 min-w-[160px]">{sl}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLocations.map((loc, rowIdx) => {
                  const activeSLsForLoc = locationServiceLines[loc.id] ?? [...ALL_SERVICE_LINES];
                  const colsToShow = filterableSLs.filter(sl => activeSLsForLoc.includes(sl));
                  if (colsToShow.length === 0) return null;
                  return (
                    <tr key={loc.id} className={`border-b border-gray-200 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-blue-50/40'} hover:bg-blue-100/50`}>
                      <td className="py-2 pr-4 font-medium text-gray-800 truncate max-w-[220px]" title={loc.name}>
                        {loc.name}
                      </td>
                      {filterableSLs.map(sl => {
                        const isActive = activeSLsForLoc.includes(sl);
                        if (!isActive) {
                          return <td key={sl} className="py-2 px-3 text-gray-300">—</td>;
                        }
                        const key = getKey(loc.id, sl);
                        const isSaving = savingKeys.has(key);
                        const displayVal = getDisplayValue(loc.id, sl);
                        const isDirty = pendingRates[key] !== undefined;
                        const computed = computedMap.get(key);
                        const overrideOn = isOverrideOn(key);

                        return (
                          <td key={sl} className="py-2 px-3">
                            {/* Fixed two-column grid: 52px label | 72px value — keeps $ and numbers pixel-aligned */}
                            <div className="grid gap-y-1" style={{ gridTemplateColumns: '52px 72px' }}>
                              {/* Row 1 — computed value */}
                              <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium self-center leading-none">From data</span>
                              <div className="relative h-6 flex items-center">
                                {computed != null ? (
                                  <>
                                    <span className="absolute left-1.5 text-[11px] text-gray-400">$</span>
                                    <span className="w-full text-right text-xs font-mono text-gray-600 pr-1">{computed.toLocaleString()}</span>
                                  </>
                                ) : (
                                  <span className="w-full text-center text-xs text-gray-300">—</span>
                                )}
                              </div>
                              {/* Row 2 — override checkbox + input */}
                              <label className="flex items-center gap-1 cursor-pointer select-none self-center">
                                <input
                                  type="checkbox"
                                  checked={overrideOn}
                                  onChange={e => {
                                    setOverrideToggle(prev => ({ ...prev, [key]: e.target.checked }));
                                    if (!e.target.checked) {
                                      setPendingRates(prev => { const n = { ...prev }; delete n[key]; return n; });
                                      // Clear the saved override from the server so the data value takes over
                                      if (existingMap.has(key)) {
                                        deleteMutation.mutate({ locationId: loc.id, serviceLine: sl });
                                      }
                                    }
                                  }}
                                  className="h-3 w-3 rounded border-gray-300 accent-teal-600 cursor-pointer"
                                />
                                {overrideOn && <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Override</span>}
                              </label>
                              {overrideOn ? (
                                <div className="flex items-center gap-1">
                                  <div className="relative w-[72px]">
                                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-[11px]">$</span>
                                    <Input
                                      className="pl-4 pr-1 text-xs h-6 text-right w-full"
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
                                      className="h-6 px-1.5 text-xs"
                                      onClick={() => handleSave(loc.id, loc.name, sl)}
                                      disabled={isSaving}
                                      data-testid={`button-save-care-l2-${loc.id}-${sl}`}
                                    >
                                      {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                    </Button>
                                  )}
                                </div>
                              ) : (
                                <div />
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
