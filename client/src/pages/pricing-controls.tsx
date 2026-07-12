import { useState, useEffect } from "react";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts";
import { ChevronDown, X, Loader2, Save, HeartPulse, Sparkles, RefreshCw, TrendingUp, TrendingDown, Zap, Maximize2, ArrowUpRight, ArrowDownRight, Minus, CircleDot, Target, BarChart3 } from "lucide-react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
    urlLocation ? [urlLocation] : (savedFilters?.locations || [])
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

  // When the available locations change (e.g. after login/logout), drop any
  // selections that no longer exist in the current client's data.
  useEffect(() => {
    if (!locationsData?.locations) return;
    const validNames = new Set(locations);
    const validRegions = new Set(regions);
    const validDivisions = new Set(divisions);
    setSelectedLocations(prev => prev.filter(l => validNames.has(l)));
    setSelectedRegions(prev => prev.filter(r => validRegions.has(r)));
    setSelectedDivisions(prev => prev.filter(d => validDivisions.has(d)));
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
  rules: { name: string; strategy: string; effectiveDate?: string | null }[];
  generatedAt: string;
}

interface PricingCommentaryCardProps {
  selectedServiceLine: string;
  selectedLocations: string[];
  selectedRegions: string[];
  selectedDivisions: string[];
}

function PricingCommentaryCard({ selectedServiceLine, selectedLocations, selectedRegions, selectedDivisions }: PricingCommentaryCardProps) {
  const [selectedRule, setSelectedRule] = useState<any>(null);
  const [fullMapOpen, setFullMapOpen] = useState(false);

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
    placeholderData: keepPreviousData,
    retry: 1,
  });

  const { data: rulesData } = useQuery<any[]>({
    queryKey: ['/api/adjustment-rules'],
    staleTime: 2 * 60 * 1000,
  });

  const { data: compPositionData = [] } = useQuery<any[]>({
    queryKey: ['/api/pricing-controls/competitive-position', selectedServiceLine, selectedLocations.join(','), selectedRegions.join(','), selectedDivisions.join(',')],
    queryFn: () => fetch(`/api/pricing-controls/competitive-position${qs ? '?' + qs : ''}`).then(r => r.json()),
    staleTime: 10 * 60 * 1000,
  });

  const activeRules = (rulesData || []).filter((r: any) => r.isActive);
  const totalAnnualImpact = activeRules.reduce((s: number, r: any) => s + (r.annualImpact || 0), 0);
  const positiveImpact = activeRules.filter((r: any) => (r.annualImpact || 0) > 0).reduce((s: number, r: any) => s + r.annualImpact, 0);
  const negativeImpact = activeRules.filter((r: any) => (r.annualImpact || 0) < 0).reduce((s: number, r: any) => s + r.annualImpact, 0);

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
    const c = conditions[0];
    const fieldMap: Record<string, string> = {
      service_line_occupancy: 'SL occ', room_type_occupancy: 'RT occ',
      campus_occupancy: 'Campus occ', days_vacant: 'Days vacant',
    };
    const field = fieldMap[c.field] || (c.field || '').replace(/_/g, ' ');
    const val = c.field?.includes('occupancy') ? `${Math.round((c.value || 0) * 100)}%` : c.value;
    const op = c.operator === '>=' ? '≥' : c.operator === '<=' ? '≤' : c.operator === '<' ? '<' : c.operator === '>' ? '>' : c.operator;
    const extra = conditions.length > 1 ? ` +${conditions.length - 1}` : '';
    return `${field} ${op} ${val}${extra}`;
  };

  const getSLs = (rule: any): string[] => {
    const f = rule.action?.filters || {};
    return (f.serviceLine || []).slice(0, 3);
  };

  const SL_COLORS: Record<string, string> = {
    AL: 'bg-teal-100 text-teal-800', 'AL/MC': 'bg-purple-100 text-purple-800',
    HC: 'bg-orange-100 text-orange-800', 'HC/MC': 'bg-blue-100 text-blue-800',
    SL: 'bg-emerald-100 text-emerald-800', VIL: 'bg-violet-100 text-violet-800',
  };

  const PALETTE = ['#0d9488','#7c3aed','#d97706','#0284c7','#16a34a','#dc2626','#9333ea','#ea580c','#0891b2','#b45309'];

  const genMiniDots = (count: number, r: number) => {
    const n = Math.min(count, 32);
    return Array.from({ length: n }, (_, i) => {
      const theta = i * 2.39996;
      const rad = Math.sqrt((i + 0.5) / n) * (r - 4);
      return { x: Math.cos(theta) * rad, y: Math.sin(theta) * rad };
    });
  };

  const hasData = data && (data.summary || data.rules?.length > 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm mb-6 overflow-hidden">

      {/* ══ MASTHEAD ══ */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-100">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* rubric label */}
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-block w-[3px] h-4 rounded-full bg-teal-500" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Strategy Overview</span>
              {activeRules.length > 0 && (
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-teal-500 border border-teal-200 rounded px-1.5 py-0.5">
                  {activeRules.length} Active Rule{activeRules.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* headline — AI summary as editorial lede */}
            {isLoading && !hasData ? (
              <div className="space-y-2">
                <div className="h-7 rounded bg-slate-100 animate-pulse w-3/4" />
                <div className="h-7 rounded bg-slate-100 animate-pulse w-1/2" />
              </div>
            ) : data?.summary ? (
              <h2 className="text-[22px] font-black text-slate-900 leading-[1.25] tracking-tight mb-0">
                {parseBold(data.summary)}
              </h2>
            ) : null}
          </div>

          {/* KPI column — right-aligned on desktop */}
          {activeRules.length > 0 && !isLoading && (
            <div className="hidden sm:flex flex-col items-end gap-0 shrink-0 pl-4 border-l border-slate-100">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400 mb-0.5">Net Annual Impact</p>
              <p className={`text-3xl font-black leading-none tracking-tight ${totalAnnualImpact >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {fmtImpact(totalAnnualImpact)}
              </p>
              {positiveImpact > 0 && negativeImpact < 0 && (
                <div className="flex gap-3 mt-2">
                  <div className="text-right">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Lift</p>
                    <p className="text-sm font-black text-emerald-500">{fmtImpact(positiveImpact)}</p>
                  </div>
                  <div className="text-right border-l border-slate-100 pl-3">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Concessions</p>
                    <p className="text-sm font-black text-red-500">{fmtImpact(negativeImpact)}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-teal-600 transition-colors disabled:opacity-40 shrink-0 mt-1"
            title="Refresh overview"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* mobile KPI strip */}
        {activeRules.length > 0 && !isLoading && (
          <div className="flex sm:hidden gap-6 mt-3 pt-3 border-t border-slate-100">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Net Annual Impact</p>
              <p className={`text-2xl font-black leading-tight ${totalAnnualImpact >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtImpact(totalAnnualImpact)}</p>
            </div>
            {positiveImpact > 0 && (
              <div className="border-l border-slate-100 pl-6">
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Revenue Lift</p>
                <p className="text-2xl font-black leading-tight text-emerald-500">{fmtImpact(positiveImpact)}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ TREND BAND ══ */}
      {data?.pricingTrend && !isLoading && (
        <div className="px-6 py-3.5 border-b border-slate-100 bg-slate-50/60">
          <span className="text-[9px] font-black uppercase tracking-[0.18em] text-teal-600 mr-2">6-Mo Trend</span>
          <span className="text-[13px] leading-relaxed text-slate-600">{parseBold(data.pricingTrend)}</span>
        </div>
      )}

      {/* ══ COMPETITIVE POSITION SCATTER ══ */}
      {compPositionData.length > 0 && (
        <div className="px-6 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Competitive Position</span>
              <span className="text-[9px] text-slate-400">· {compPositionData.length} location/SL combinations</span>
            </div>
            <span className="text-[9px] text-slate-400 italic">X = rate vs market · Y = occupancy</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                type="number"
                dataKey="marketPosition"
                name="Market Position"
                domain={([min, max]: [number,number]) => [Math.min(min - 2, 88), Math.max(max + 2, 112)]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 9, fill: '#94a3b8' }}
                label={{ value: '← Below Market · At Market · Above Market →', position: 'insideBottom', offset: -12, fontSize: 9, fill: '#94a3b8' }}
              />
              <YAxis
                type="number"
                dataKey="occupancy"
                name="Occupancy"
                domain={([min, max]: [number,number]) => [Math.max(min - 3, 0), Math.min(max + 3, 100)]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 9, fill: '#94a3b8' }}
                width={34}
              />
              <ZAxis range={[35, 35]} />
              <ReferenceLine x={100} stroke="#0d9488" strokeDasharray="4 2" strokeWidth={1.5} label={{ value: 'Market', fontSize: 8, fill: '#0d9488', position: 'insideTopRight' }} />
              <ReferenceLine y={90} stroke="#94a3b8" strokeDasharray="3 2" strokeWidth={1} label={{ value: '90%', fontSize: 8, fill: '#94a3b8', position: 'insideTopRight' }} />
              <RechartsTooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-[11px]">
                      <p className="font-bold text-slate-800 mb-0.5">{d.location}</p>
                      <p className="text-slate-500">{d.serviceLine} · Occ: <strong>{d.occupancy}%</strong></p>
                      <p className="text-slate-500">Our Rate: <strong>${d.ourRate?.toLocaleString()}</strong></p>
                      <p className="text-slate-500">Mkt Avg: <strong>${d.compRate?.toLocaleString()}</strong></p>
                      <p className={`font-bold mt-0.5 ${d.marketPosition > 100 ? 'text-emerald-600' : d.marketPosition < 95 ? 'text-amber-600' : 'text-slate-600'}`}>
                        {d.marketPosition}% of market
                      </p>
                    </div>
                  );
                }}
              />
              {['AL','AL/MC','HC','HC/MC','SL','VIL'].map(sl => {
                const slData = compPositionData.filter((d: any) => d.serviceLine === sl);
                if (!slData.length) return null;
                const SL_DOT_COLORS: Record<string,string> = {
                  AL:'#0d9488', 'AL/MC':'#7c3aed', HC:'#d97706', 'HC/MC':'#0284c7', SL:'#16a34a', VIL:'#9333ea',
                };
                const color = SL_DOT_COLORS[sl] || '#64748b';
                return (
                  <Scatter key={sl} name={sl} data={slData} fill={color}>
                    {slData.map((_: any, i: number) => (
                      <Cell key={i} fill={color} fillOpacity={0.75} />
                    ))}
                  </Scatter>
                );
              })}
            </ScatterChart>
          </ResponsiveContainer>
          {/* SL legend */}
          <div className="flex flex-wrap gap-3 mt-1 justify-center">
            {(['AL','AL/MC','HC','HC/MC','SL','VIL'] as const).filter(sl => compPositionData.some((d:any) => d.serviceLine===sl)).map(sl => {
              const SL_DOT_COLORS: Record<string,string> = { AL:'#0d9488', 'AL/MC':'#7c3aed', HC:'#d97706', 'HC/MC':'#0284c7', SL:'#16a34a', VIL:'#9333ea' };
              return (
                <span key={sl} className="flex items-center gap-1 text-[9px] text-slate-500">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: SL_DOT_COLORS[sl] }} />
                  {sl}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ══ ACTIVE RULES ══ */}
      {activeRules.length > 0 && (
        <div className="px-6 py-5">
          {/* section label */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Active Rules</span>
              {data?.rulesSummary && (
                <span className="hidden sm:inline text-[11px] text-slate-400 font-normal">— {data.rulesSummary}</span>
              )}
            </div>
            <button
              className="hidden sm:flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 hover:text-teal-600 transition-colors border border-slate-200 rounded-md px-2 py-1"
              onClick={() => setFullMapOpen(true)}
            >
              <Maximize2 className="h-3 w-3" />
              Coverage Map
            </button>
          </div>

          {/* rule cards — editorial style */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
            {activeRules.map((rule: any, ri: number) => {
              const { positive, display } = getActionInfo(rule);
              const sls = getSLs(rule);
              const trigger = getTriggerLabel(rule);
              const color = PALETTE[ri % PALETTE.length];
              const eff = rule.effectiveDate ? String(rule.effectiveDate).slice(0, 10) : null;
              const today = new Date().toISOString().slice(0, 10);
              const isFuture = eff && eff > today;
              const annual = rule.annualImpact || 0;
              const units = rule.affectedUnits || 0;

              return (
                <button
                  key={rule.id}
                  onClick={() => setSelectedRule(rule)}
                  className="text-left rounded-xl border bg-white hover:shadow-md transition-all duration-150 p-4 group focus:outline-none focus:ring-2 focus:ring-teal-400"
                  style={{ borderColor: `${color}25`, borderTopWidth: 3, borderTopColor: color }}
                >
                  {/* SL pills + date */}
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <div className="flex gap-1 flex-wrap">
                      {sls.length > 0
                        ? sls.map(sl => (
                            <span key={sl} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${SL_COLORS[sl] || 'bg-slate-100 text-slate-600'}`}>{sl}</span>
                          ))
                        : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">All SLs</span>
                      }
                    </div>
                    {eff && (
                      <span className={`text-[9px] font-semibold shrink-0 ${isFuture ? 'text-blue-500' : 'text-slate-300'}`}>
                        {isFuture ? '⏰ ' : ''}{new Date(`${eff}T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                      </span>
                    )}
                  </div>

                  {/* big adjustment badge */}
                  <div className={`text-2xl font-black leading-none tracking-tight mb-1 ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
                    {display}
                  </div>

                  {/* rule name */}
                  <p className="text-[12px] font-bold text-slate-800 leading-snug mb-2 line-clamp-2 group-hover:text-teal-700">
                    {rule.name}
                  </p>

                  {/* divider */}
                  <div className="border-t border-slate-100 pt-2 flex items-center justify-between">
                    <span className={`text-[11px] font-black ${annual >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {fmtImpact(annual)}<span className="font-normal text-slate-400 text-[9px]">/yr</span>
                    </span>
                    <span className="text-[9px] text-slate-400 flex items-center gap-0.5">
                      <Zap className="h-2.5 w-2.5" />{trigger}
                    </span>
                  </div>
                  {units > 0 && (
                    <p className="text-[9px] text-slate-300 mt-0.5">{units.toLocaleString()} units</p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!hasData && !isLoading && (
        <p className="text-sm text-slate-400 italic py-8 text-center px-6">No overview available — add pricing rules to generate insights.</p>
      )}

      {isLoading && !hasData && (
        <div className="px-6 py-5 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
          {[1,2,3,4].map(i => <div key={i} className="h-28 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      )}

      {/* ── Footer ── */}
      {data?.generatedAt && !isLoading && (
        <div className="px-6 pb-3 text-[10px] text-slate-300 border-t border-slate-100 pt-2.5">
          AI overview · {new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {/* ── Rule detail dialog ── */}
      <Dialog open={!!selectedRule} onOpenChange={(o) => !o && setSelectedRule(null)}>
        <DialogContent className="max-w-lg">
          {selectedRule && (() => {
            const { positive, display } = getActionInfo(selectedRule);
            const trigger = getTriggerLabel(selectedRule);
            const sls = getSLs(selectedRule);
            const annual = selectedRule.annualImpact || 0;
            const monthly = selectedRule.monthlyImpact || 0;
            const units = selectedRule.affectedUnits || 0;
            const eff = selectedRule.effectiveDate ? String(selectedRule.effectiveDate).slice(0, 10) : null;
            const today = new Date().toISOString().slice(0, 10);
            const isFuture = eff && eff > today;
            const commentaryRule = data?.rules?.find(r => r.name === selectedRule.name);

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <span className={`text-sm font-bold px-2 py-1 rounded ${positive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {display}
                    </span>
                    {selectedRule.name}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-1">
                  {/* KPI row */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">Annual Impact</p>
                      <p className={`text-lg font-bold ${annual >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtImpact(annual)}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">Monthly</p>
                      <p className={`text-lg font-bold ${monthly >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtImpact(monthly)}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-center">
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">Units Affected</p>
                      <p className="text-lg font-bold text-slate-700">{units.toLocaleString()}</p>
                    </div>
                  </div>

                  {/* Rule details */}
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 w-20 shrink-0 pt-0.5">Trigger</span>
                      <span className="text-slate-700 font-medium">{trigger}</span>
                    </div>
                    {sls.length > 0 && (
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 w-20 shrink-0 pt-0.5">Service Lines</span>
                        <div className="flex gap-1 flex-wrap">
                          {sls.map(sl => (
                            <span key={sl} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${SL_COLORS[sl] || 'bg-slate-100 text-slate-600'}`}>{sl}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {eff && (
                      <div className="flex items-start gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-slate-400 w-20 shrink-0 pt-0.5">Effective</span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${isFuture ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                          {isFuture ? 'Starts' : 'Active since'} {new Date(`${eff}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* AI strategy description from commentary */}
                  {commentaryRule?.strategy && (
                    <div className="rounded-lg bg-teal-50 border border-teal-100 px-4 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-600 mb-1.5 flex items-center gap-1">
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
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base">Rule Coverage Map — {activeRules.length} Active Rules</DialogTitle>
            <p className="text-xs text-slate-500 mt-1">Circle size = relative annual revenue impact. Solid border = additive. Dashed = exclusive/priority-based. Click any rule to view details.</p>
          </DialogHeader>
          <div className="bg-slate-50 rounded-xl p-4 grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(activeRules.length, 4)}, 1fr)` }}>
            {activeRules.map((rule: any, ri: number) => {
              const color = PALETTE[ri % PALETTE.length];
              const maxImpact = Math.max(...activeRules.map((r: any) => Math.abs(r.annualImpact || 0)), 1);
              const t = Math.sqrt(Math.abs(rule.annualImpact || 0) / maxImpact);
              const MIN_R = 22, MAX_R = 46;
              const radius = Math.round(MIN_R + t * (MAX_R - MIN_R));
              const size = radius * 2 + 8;
              const units = rule.affectedUnits || 0;
              const dots = genMiniDots(units, radius);
              const positive = (rule.annualImpact || 0) >= 0;
              return (
                <div key={rule.id} className="flex flex-col items-center gap-1.5 cursor-pointer hover:bg-white rounded-lg p-2 transition-colors" onClick={() => { setFullMapOpen(false); setTimeout(() => setSelectedRule(rule), 80); }}>
                  <svg width={size} height={size} style={{ overflow: 'visible' }}>
                    <circle cx={size/2} cy={size/2} r={radius} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={positive ? 2 : 1.5} strokeDasharray={positive ? 'none' : '4 3'} />
                    {dots.map((d, di) => <circle key={di} cx={size/2 + d.x} cy={size/2 + d.y} r={1.5} fill={color} opacity={0.5} />)}
                    <text x={size/2} y={size/2 + 4} textAnchor="middle" fontSize={10} fontWeight="bold" fill={color} opacity={0.9}>
                      {fmtImpact(rule.annualImpact || 0)}
                    </text>
                  </svg>
                  <div className="text-center w-full">
                    <p className="text-[10px] font-semibold text-slate-700 leading-tight text-center line-clamp-2">{rule.name}</p>
                    <p className="text-[9px] text-slate-400">{units.toLocaleString()} units</p>
                    {rule.effectiveDate && (
                      <p className="text-[9px] text-slate-400">
                        Start: {new Date(rule.effectiveDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
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