import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { CompetitorAdjustmentDialog } from "@/components/dashboard/competitor-adjustment-dialog";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Brain, Calculator, CheckCircle, AlertCircle, Info, Loader2, Shield, ArrowUpDown, ArrowUp, ArrowDown, Maximize2, Minimize2, Filter, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import ModuloCalculationDialog from "./modulo-calculation-dialog";
import AICalculationDialog from "./ai-calculation-dialog";
import { formatNumber, formatCurrency, formatPercentage, formatRateByServiceLine, convertToDisplayRate, isDailyRateServiceLine } from "@/lib/formatters";

interface RateCardTableProps {
  selectedServiceLine?: string;
  selectedRegions?: string[];
  selectedDivisions?: string[];
  selectedLocations?: string[];
  selectedUnit?: string | null;
}

export default function RateCardTable({ 
  selectedServiceLine: propServiceLine,
  selectedRegions,
  selectedDivisions,
  selectedLocations,
  selectedUnit
}: RateCardTableProps) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const [localServiceLine, setLocalServiceLine] = useState<string>("All");
  const [aiDialogUnit, setAIDialogUnit] = useState<{ unitId: string; roomType: string; streetRate: number; aiSuggestedRate: number } | null>(null);
  const [sortColumn, setSortColumn] = useState<string | null>('status');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [columnFilters, setColumnFilters] = useState<{
    location: string;
    unit: string;
    roomType: string[];
    serviceLine: string[];
    status: string[];
    streetRateMin: string;
    streetRateMax: string;
    rulesRateMin: string;
    rulesRateMax: string;
  }>({
    location: '',
    unit: '',
    roomType: [],
    serviceLine: [],
    status: [],
    streetRateMin: '',
    streetRateMax: '',
    rulesRateMin: '',
    rulesRateMax: '',
  });
  const ITEMS_PER_PAGE = 50;

  // Refs for the scrollable table wrapper and the table element itself
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  // Mirror top scrollbar — native scroll synced to the shadcn Table wrapper div
  // NOTE: shadcn <Table> renders <div class="relative w-full overflow-auto"><table /></div>
  // The INNER div is the real scroll container, not bottomScrollRef.
  const topScrollRef    = useRef<HTMLDivElement>(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);
  const isSyncingScroll = useRef(false);

  // Helper: get the actual scrollable div (shadcn Table's wrapper, first child of outer div)
  const getInnerScroller = useCallback((): HTMLElement | null => {
    const outer = bottomScrollRef.current;
    if (!outer) return null;
    return (outer.firstElementChild as HTMLElement) ?? null;
  }, []);

  // Tracks cleanup for the inner-scroller scroll listener
  const scrollListenerCleanup = useRef<(() => void) | null>(null);

  // Runs after every render — updates spacer width AND attaches listener once available
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (table) setTableScrollWidth(table.offsetWidth);

    if (!scrollListenerCleanup.current) {
      const inner = getInnerScroller();
      if (inner) {
        const onScroll = () => {
          if (isSyncingScroll.current) return;
          const top = topScrollRef.current;
          if (!top) return;
          isSyncingScroll.current = true;
          top.scrollLeft = inner.scrollLeft;
          isSyncingScroll.current = false;
        };
        inner.addEventListener('scroll', onScroll, { passive: true });
        scrollListenerCleanup.current = () => inner.removeEventListener('scroll', onScroll);
      }
    }
  });

  // Clean up the inner-scroller listener on unmount
  useEffect(() => () => { scrollListenerCleanup.current?.(); }, []);

  // Also keep spacer width in sync when anything resizes
  useEffect(() => {
    const update = () => {
      const table = tableRef.current;
      if (table) setTableScrollWidth(table.offsetWidth);
    };
    const observer = new ResizeObserver(update);
    if (tableRef.current)        observer.observe(tableRef.current);
    if (bottomScrollRef.current) observer.observe(bottomScrollRef.current);
    return () => observer.disconnect();
  }, []);

  // Top scroll → inner scroller
  const handleTopScroll = useCallback(() => {
    if (isSyncingScroll.current) return;
    const top   = topScrollRef.current;
    const inner = getInnerScroller();
    if (!top || !inner) return;
    isSyncingScroll.current = true;
    inner.scrollLeft = top.scrollLeft;
    isSyncingScroll.current = false;
  }, [getInnerScroller]);

  // handleBottomScroll kept as no-op — real sync handled by native listener above
  const handleBottomScroll = useCallback(() => {}, []);

  // ESC key closes fullscreen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [activeModuloJobId, setActiveModuloJobId] = useState<string | null>(null);
  const [moduloJobProgress, setModuloJobProgress] = useState<number>(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Use prop service line if provided, otherwise use local state
  const selectedServiceLine = propServiceLine || localServiceLine;

  // Close tooltip when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setOpenTooltip(null);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Fetch available upload months
  const { data: availableMonths = [] } = useQuery<string[]>({
    queryKey: ['/api/rent-roll/available-months'],
  });

  const { data: rateCardData, isLoading, isFetching } = useQuery({
    queryKey: ['/api/rate-card', selectedMonth, selectedRegions, selectedDivisions, selectedLocations],
    queryFn: async () => {
      const params = new URLSearchParams();
      // Only include month if it's set, otherwise backend will auto-select latest month
      if (selectedMonth) {
        params.append('month', selectedMonth);
      }
      if (selectedRegions && selectedRegions.length > 0) {
        selectedRegions.forEach(region => params.append('regions', region));
      }
      if (selectedDivisions && selectedDivisions.length > 0) {
        selectedDivisions.forEach(division => params.append('divisions', division));
      }
      if (selectedLocations && selectedLocations.length > 0) {
        selectedLocations.forEach(location => params.append('locations', location));
      }
      
      const response = await fetch(`/api/rate-card?${params.toString()}`);
      return response.json();
    },
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
    gcTime: 5 * 60 * 1000, // Keep in garbage collection for 5 minutes
    placeholderData: keepPreviousData, // Keep showing old data while new data loads
    refetchOnWindowFocus: false, // Don't refetch when tab regains focus
  });

  // Sync selectedMonth with the month returned by the API (most recent month with data)
  useEffect(() => {
    if (rateCardData?.month && !selectedMonth) {
      setSelectedMonth(rateCardData.month);
    }
  }, [rateCardData?.month, selectedMonth]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedServiceLine, selectedRegions, selectedDivisions, selectedLocations]);

  // Scroll to highlighted unit when it changes - moved up here with other hooks
  useEffect(() => {
    const units = rateCardData?.units || [];
    const filteredUnits = selectedServiceLine === "All" 
      ? units 
      : units.filter((unit: any) => unit.serviceLine === selectedServiceLine);
    const highlightedUnitId = selectedUnit ? 
      filteredUnits.find((u: any) => u.roomNumber === selectedUnit)?.id : null;
    
    if (highlightedUnitId && !isLoading) {
      // Wait for render to complete, then scroll
      setTimeout(() => {
        const element = document.getElementById(`unit-row-${highlightedUnitId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Add a temporary pulse animation
          element.classList.add('animate-pulse');
          setTimeout(() => {
            element.classList.remove('animate-pulse');
          }, 2000);
        }
      }, 100);
    }
  }, [rateCardData, selectedUnit, selectedServiceLine, isLoading]);

  // Poll background Modulo job until it completes, then refresh rates
  useEffect(() => {
    if (!activeModuloJobId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/pricing/job-status/${activeModuloJobId}`);
        if (!res.ok || cancelled) return;
        const job = await res.json();
        const pct = job.progress?.percentage ?? 0;
        setModuloJobProgress(pct);
        if (job.status === 'completed') {
          if (!cancelled) {
            setActiveModuloJobId(null);
            setModuloJobProgress(0);
            toast({ title: "Rules rates saved", description: "Pricing recommendations have been calculated and saved" });
            queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
          }
        } else if (job.status === 'failed') {
          if (!cancelled) {
            setActiveModuloJobId(null);
            setModuloJobProgress(0);
            toast({ title: "Rules Rate calculation failed", description: job.error || "Unknown error", variant: "destructive" });
          }
        } else {
          setTimeout(poll, 2000);
        }
      } catch {
        if (!cancelled) setTimeout(poll, 3000);
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [activeModuloJobId]);

  const generateModuloMutation = useMutation({
    mutationFn: () => apiRequest('/api/pricing/generate-modulo', 'POST', { 
      month: selectedMonth,
      serviceLine: selectedServiceLine !== 'All' ? selectedServiceLine : undefined,
      regions: selectedRegions,
      divisions: selectedDivisions,
      locations: selectedLocations
    }),
    onSuccess: async (response: any) => {
      let jobId: string | null = null;
      try {
        const data = typeof response?.json === 'function' ? await response.json() : response;
        jobId = data?.jobId ?? null;
      } catch { /* ignore */ }
      if (jobId) {
        setActiveModuloJobId(jobId);
        setModuloJobProgress(1);
        toast({ title: "Rules Rate calculation started", description: "Rates will update automatically when complete" });
      } else {
        // Fallback: no job ID means synchronous response — just refresh
        toast({ title: "Rules rates saved", description: "Pricing recommendations have been calculated and saved" });
        queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to generate Rules Rate suggestions",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const generateAIMutation = useMutation({
    mutationFn: () => apiRequest('/api/pricing/generate-ai', 'POST', { 
      month: selectedMonth,
      serviceLine: selectedServiceLine !== 'All' ? selectedServiceLine : undefined,
      regions: selectedRegions,
      divisions: selectedDivisions,
      locations: selectedLocations
    }),
    onSuccess: () => {
      toast({
        title: "Revenue Target AI Rate suggestions generated",
        description: "AI-powered pricing recommendations are ready"
      });
      queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to generate Revenue Target AI Rate suggestions", 
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const acceptSuggestionsMutation = useMutation({
    mutationFn: ({ unitIds, type }: { unitIds: string[], type: string }) => 
      apiRequest('/api/pricing/accept-suggestions', 'POST', { 
        unitIds, 
        suggestionType: type,
        serviceLine: selectedServiceLine !== "All" ? selectedServiceLine : null
      }),
    onSuccess: () => {
      toast({
        title: "Suggestions accepted",
        description: "Street rates have been updated"
      });
      queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
      queryClient.invalidateQueries({ queryKey: ['/api/pricing-history'] });
    }
  });

  // Helper function to generate Modulo calculation explanation
  const getModuloTooltip = (unit: any) => {
    if (!unit.moduloSuggestedRate || unit.moduloSuggestedRate === unit.streetRate) {
      return "No Rules Rate suggestions available";
    }

    const displayStreet = convertToDisplayRate(unit.streetRate, unit.serviceLine) || 0;
    const displayModulo = convertToDisplayRate(unit.moduloSuggestedRate, unit.serviceLine) || 0;
    const displayCompetitor = convertToDisplayRate(unit.competitorFinalRate, unit.serviceLine) || 0;
    const isDailyRate = isDailyRateServiceLine(unit.serviceLine);
    const rateSuffix = isDailyRate ? '/day' : '';
    
    const change = displayModulo - displayStreet;
    const changePercent = Math.round((change / displayStreet) * 100);
    
    let factors = [];
    
    // Occupancy factor
    if (unit.occupiedYN) {
      factors.push("✓ Unit occupied: +2% market positioning");
    } else {
      factors.push("⚠ Unit vacant: -1.5% to attract residents");
    }
    
    // Days vacant factor
    if (unit.daysVacant > 30) {
      const penalty = Math.min((unit.daysVacant / 60) * 5, 15);
      factors.push(`⏰ ${unit.daysVacant} days vacant: -${Math.round(penalty)}% urgency discount`);
    }
    
    // Attributes factor
    let attributeBonus = 0;
    if (unit.view) attributeBonus += 3;
    if (unit.renovated) attributeBonus += 5;
    if (attributeBonus > 0) {
      factors.push(`⭐ Premium features: +${attributeBonus}% (${unit.view ? 'View' : ''}${unit.view && unit.renovated ? ', ' : ''}${unit.renovated ? 'Renovated' : ''})`);
    }
    
    // Competitor factor - use proper display rates
    if (displayCompetitor > 0 && Math.abs(displayCompetitor - displayStreet) > (isDailyRate ? 2 : 50)) {
      const competitorDiff = displayCompetitor - displayStreet;
      const adjustment = Math.round(competitorDiff / displayStreet * 50);
      factors.push(`🏢 Competitor rate $${Math.round(displayCompetitor).toLocaleString()}${rateSuffix}: ${competitorDiff > 0 ? '+' : ''}${adjustment}% market adjustment`);
    }

    return `Rules Rate Calculation:
    
Base Rate: $${Math.round(displayStreet).toLocaleString()}${rateSuffix}
${factors.join('\n')}

Final Rate: $${Math.round(displayModulo).toLocaleString()}${rateSuffix} (${change > 0 ? '+' : ''}${changePercent}%)

The Rules Rate engine considers occupancy pressure, vacancy duration, unit attributes, and competitor positioning to optimize pricing.`;
  };

  // Helper function to generate AI calculation explanation  
  const getAITooltip = (unit: any) => {
    if (!unit.aiSuggestedRate) {
      return "No Revenue Target AI Rate suggestions available";
    }

    const displayStreet = convertToDisplayRate(unit.streetRate, unit.serviceLine) || 0;
    const displayAI = convertToDisplayRate(unit.aiSuggestedRate, unit.serviceLine) || 0;
    const isDailyRate = isDailyRateServiceLine(unit.serviceLine);
    const rateSuffix = isDailyRate ? '/day' : '';

    const change = displayAI - displayStreet;
    const changePercent = Math.round((change / displayStreet) * 100);
    
    return `Revenue Target AI Pricing Analysis:

Base Rate: $${Math.round(displayStreet).toLocaleString()}${rateSuffix}
Rev Target AI Suggested: $${Math.round(displayAI).toLocaleString()}${rateSuffix} (${change > 0 ? '+' : ''}${changePercent}%)

Analysis Factors:
🧠 Market intelligence and patterns
🏘️ Comparable unit analysis
📊 Historical occupancy trends  
🎯 Competitive positioning
🔮 Predictive modeling

The Revenue Target AI considers complex market dynamics, seasonal patterns, and competitive intelligence to generate data-driven pricing recommendations.`;
  };

  const units = rateCardData?.units || [];
  const summary = rateCardData?.summary || [];

  // Derive unique filter option values from data
  const uniqueRoomTypes = useMemo(() => {
    const types = new Set(units.map((u: any) => u.roomType).filter(Boolean));
    return Array.from(types).sort() as string[];
  }, [units]);

  const uniqueServiceLines = useMemo(() => {
    const lines = new Set(units.map((u: any) => u.serviceLine).filter(Boolean));
    return Array.from(lines).sort() as string[];
  }, [units]);

  // Count how many column filters are currently active
  const activeFilterCount = [
    columnFilters.location,
    columnFilters.unit,
    ...columnFilters.roomType,
    ...columnFilters.serviceLine,
    ...columnFilters.status,
    columnFilters.streetRateMin,
    columnFilters.streetRateMax,
    columnFilters.rulesRateMin,
    columnFilters.rulesRateMax,
  ].filter(Boolean).length;

  const clearAllFilters = () => setColumnFilters({
    location: '', unit: '', roomType: [], serviceLine: [], status: [],
    streetRateMin: '', streetRateMax: '', rulesRateMin: '', rulesRateMax: '',
  });

  // Filter units by selected service line
  let filteredUnits = selectedServiceLine === "All" 
    ? units 
    : units.filter((unit: any) => {
        // Use the actual serviceLine field from the data
        return unit.serviceLine === selectedServiceLine;
      });

  // Apply column-level filters
  if (columnFilters.location) {
    const q = columnFilters.location.toLowerCase();
    filteredUnits = filteredUnits.filter((u: any) =>
      (u.location || u.locationName || u.campusName || '').toLowerCase().includes(q)
    );
  }
  if (columnFilters.unit) {
    const q = columnFilters.unit.toLowerCase();
    filteredUnits = filteredUnits.filter((u: any) =>
      (u.roomNumber || '').toLowerCase().includes(q)
    );
  }
  if (columnFilters.roomType.length > 0) {
    filteredUnits = filteredUnits.filter((u: any) => columnFilters.roomType.includes(u.roomType));
  }
  if (columnFilters.serviceLine.length > 0) {
    filteredUnits = filteredUnits.filter((u: any) => columnFilters.serviceLine.includes(u.serviceLine));
  }
  if (columnFilters.status.length > 0) {
    filteredUnits = filteredUnits.filter((u: any) => {
      if (columnFilters.status.includes('Occupied') && u.occupiedYN) return true;
      if (columnFilters.status.includes('Vacant') && !u.occupiedYN) return true;
      return false;
    });
  }
  if (columnFilters.streetRateMin !== '') {
    filteredUnits = filteredUnits.filter((u: any) => (u.streetRate || 0) >= parseFloat(columnFilters.streetRateMin));
  }
  if (columnFilters.streetRateMax !== '') {
    filteredUnits = filteredUnits.filter((u: any) => (u.streetRate || 0) <= parseFloat(columnFilters.streetRateMax));
  }
  if (columnFilters.rulesRateMin !== '') {
    filteredUnits = filteredUnits.filter((u: any) =>
      (u.ruleAdjustedRate || u.moduloSuggestedRate || 0) >= parseFloat(columnFilters.rulesRateMin)
    );
  }
  if (columnFilters.rulesRateMax !== '') {
    filteredUnits = filteredUnits.filter((u: any) =>
      (u.ruleAdjustedRate || u.moduloSuggestedRate || 0) <= parseFloat(columnFilters.rulesRateMax)
    );
  }
  
  // If a specific unit is selected, ensure it's visible
  // Also prepare for highlighting
  const highlightedUnitId = selectedUnit ? 
    filteredUnits.find((u: any) => u.roomNumber === selectedUnit)?.id : null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading rate card...</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            <div className="h-4 bg-gray-200 rounded w-5/6"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Handle column sorting
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to ascending
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Calculate pagination
  const totalPages = Math.ceil(filteredUnits.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;

  // Sort the filtered units based on current sort state
  if (sortColumn) {
    filteredUnits = [...filteredUnits].sort((a: any, b: any) => {
      let aVal, bVal;
      
      switch (sortColumn) {
        case 'location':
          aVal = a.locationName || a.campusName || '';
          bVal = b.locationName || b.campusName || '';
          break;
        case 'unit':
          aVal = a.roomNumber || '';
          bVal = b.roomNumber || '';
          break;
        case 'roomType':
          aVal = a.roomType || '';
          bVal = b.roomType || '';
          break;
        case 'serviceLine':
          aVal = a.serviceLine || '';
          bVal = b.serviceLine || '';
          break;
        case 'status':
          aVal = a.occupiedYN ? 1 : 0;
          bVal = b.occupiedYN ? 1 : 0;
          break;
        case 'streetRate':
          aVal = a.streetRate || 0;
          bVal = b.streetRate || 0;
          break;
        case 'modulo':
          aVal = a.moduloSuggestedRate || 0;
          bVal = b.moduloSuggestedRate || 0;
          break;
        case 'ai':
          aVal = a.aiSuggestedRate || 0;
          bVal = b.aiSuggestedRate || 0;
          break;
        case 'competitor':
          aVal = a.competitorFinalRate || 0;
          bVal = b.competitorFinalRate || 0;
          break;
        default:
          return 0;
      }
      
      // Compare values
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      } else {
        return sortDirection === 'asc' 
          ? (aVal > bVal ? 1 : -1)
          : (bVal > aVal ? 1 : -1);
      }
    });
  }

  // Format month string for display (e.g., "2025-11" -> "November 2025")
  const formatMonth = (monthStr: string): string => {
    const [year, month] = monthStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  // Render sort icon for column headers
  const SortIcon = ({ column }: { column: string }) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-3 w-3 ml-1 text-muted-foreground" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="h-3 w-3 ml-1 text-primary" />
      : <ArrowDown className="h-3 w-3 ml-1 text-primary" />;
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Rate Card & Pricing</span>
            <div className="flex items-center space-x-4">
              <Select 
                value={selectedMonth || rateCardData?.month || ''} 
                onValueChange={setSelectedMonth}
                data-testid="select-upload-month"
              >
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Select month..." />
                </SelectTrigger>
                <SelectContent>
                  {availableMonths.length === 0 ? (
                    <SelectItem value="no-data" disabled>No data uploaded</SelectItem>
                  ) : (
                    availableMonths.map((month) => (
                      <SelectItem key={month} value={month}>
                        {formatMonth(month)}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-3">
              <div className="overflow-x-auto -mx-1 px-1">
                <div className="flex space-x-4 min-w-max">
                <Button
                  onClick={() => generateModuloMutation.mutate()}
                  disabled={generateModuloMutation.isPending || !!activeModuloJobId || filteredUnits.length === 0}
                  data-testid="button-generate-modulo"
                >
                  {(generateModuloMutation.isPending || activeModuloJobId) ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Calculator className="h-4 w-4 mr-2" />
                  )}
                  {(generateModuloMutation.isPending || activeModuloJobId)
                    ? "Calculating..."
                    : "Run Rules Rate"}
                </Button>
                
                <Button
                  onClick={() => generateAIMutation.mutate()}
                  disabled={generateAIMutation.isPending || filteredUnits.length === 0}
                  variant="outline"
                  data-testid="button-generate-ai"
                >
                  {generateAIMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Brain className="h-4 w-4 mr-2" />
                  )}
                  {generateAIMutation.isPending
                    ? "Generating..."
                    : "Run Revenue Target AI Rate"}
                </Button>
                </div>
              </div>

              {/* Saved rates status — shows previously persisted rates are the current default */}
              {filteredUnits.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {(() => {
                    const moduloCount = filteredUnits.filter((u: any) => u.ruleAdjustedRate || u.moduloSuggestedRate).length;
                    const aiCount = filteredUnits.filter((u: any) => u.aiSuggestedRate).length;
                    return (
                      <>
                        {moduloCount > 0 && (
                          <span className="flex items-center gap-1">
                            <CheckCircle className="h-3 w-3 text-green-500" />
                            {moduloCount} unit{moduloCount !== 1 ? 's' : ''} have saved Rules Rates
                          </span>
                        )}
                        {aiCount > 0 && (
                          <span className="flex items-center gap-1">
                            <CheckCircle className="h-3 w-3 text-blue-500" />
                            {aiCount} unit{aiCount !== 1 ? 's' : ''} have saved Revenue Target AI Rates
                          </span>
                        )}
                        {moduloCount === 0 && aiCount === 0 && (
                          <span className="flex items-center gap-1">
                            <Info className="h-3 w-3" />
                            No rates calculated yet — click Generate to create recommendations
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              {/* Bulk Accept Actions */}
              <div className="overflow-x-auto -mx-1 px-1">
                <div className="flex items-center gap-4 pt-2 border-t min-w-max">
                <span className="text-sm font-medium text-muted-foreground">Apply to All Units:</span>
                <Button
                  onClick={() => {
                    const unitsWithModulo = filteredUnits.filter((u: any) => (u.ruleAdjustedRate || u.moduloSuggestedRate));
                    if (unitsWithModulo.length === 0) {
                      toast({ 
                        title: "No Rules Rate suggestions", 
                        description: "Generate Rules Rate suggestions first",
                        variant: "destructive"
                      });
                      return;
                    }
                    acceptSuggestionsMutation.mutate({
                      unitIds: unitsWithModulo.map((u: any) => u.id),
                      type: 'modulo'
                    });
                  }}
                  disabled={acceptSuggestionsMutation.isPending}
                  variant="secondary"
                  size="sm"
                  data-testid="button-accept-all-modulo"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Accept All Rules Rate ({filteredUnits.filter((u: any) => (u.ruleAdjustedRate || u.moduloSuggestedRate)).length})
                </Button>
                
                <Button
                  onClick={() => {
                    const unitsWithAI = filteredUnits.filter((u: any) => u.aiSuggestedRate);
                    if (unitsWithAI.length === 0) {
                      toast({ 
                        title: "No Revenue Target AI Rate suggestions", 
                        description: "Generate Revenue Target AI Rate suggestions first",
                        variant: "destructive"
                      });
                      return;
                    }
                    acceptSuggestionsMutation.mutate({
                      unitIds: unitsWithAI.map((u: any) => u.id),
                      type: 'ai'
                    });
                  }}
                  disabled={acceptSuggestionsMutation.isPending}
                  variant="secondary"
                  size="sm"
                  data-testid="button-accept-all-ai"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Accept All Revenue Target AI ({filteredUnits.filter((u: any) => u.aiSuggestedRate).length})
                </Button>
                </div>
              </div>
            </div>
            
            {/* Progress bars for loading states */}
            <div className="space-y-3">
              {(generateModuloMutation.isPending || activeModuloJobId) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Calculator className="h-4 w-4 text-primary animate-pulse" />
                      <div className="text-sm text-muted-foreground">Calculating Rules Rate pricing recommendations...</div>
                    </div>
                    {moduloJobProgress > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums">{Math.round(moduloJobProgress)}%</span>
                    )}
                  </div>
                  <Progress value={generateModuloMutation.isPending ? 5 : moduloJobProgress} className="h-2" />
                </div>
              )}
              
              {generateAIMutation.isPending && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-primary animate-pulse" />
                    <div className="text-sm text-muted-foreground">AI analyzing market conditions...</div>
                  </div>
                  <Progress value={33} className="h-2" />
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary by Room Type */}
      {summary.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Summary by Service Line</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service Line</TableHead>
                  <TableHead>Occupancy</TableHead>
                  <TableHead>Avg Street Rate</TableHead>
                  <TableHead>Avg Rules Rate</TableHead>
                  <TableHead>Avg Rev Target AI</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary
                  .filter((row: any) => row.totalUnits > 0)
                  .map((row: any, index: number) => (
                  <TableRow key={`${row.serviceLine}-${index}`}>
                    <TableCell className="font-medium">{row.serviceLine}</TableCell>
                    <TableCell>
                      <Badge variant={row.occupancyCount / row.totalUnits > 0.85 ? "default" : "secondary"}>
                        {formatNumber(row.occupancyCount)}/{formatNumber(row.totalUnits)} <span className="text-base font-bold">({formatPercentage(row.occupancyCount / row.totalUnits)})</span>
                      </Badge>
                    </TableCell>
                    <TableCell>{formatRateByServiceLine(Math.round(row.averageStreetRate || 0), row.serviceLine)}</TableCell>
                    <TableCell>
                      {row.averageModuloRate ? formatRateByServiceLine(Math.round(row.averageModuloRate), row.serviceLine) : '-'}
                    </TableCell>
                    <TableCell>
                      {row.averageAiRate ? formatRateByServiceLine(Math.round(row.averageAiRate), row.serviceLine) : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Detailed Unit View */}
      <div className={isFullscreen ? "fixed inset-0 z-50 flex flex-col bg-white" : ""}>
      <Card className={isFullscreen ? "h-full rounded-none border-0 flex flex-col overflow-hidden shadow-none" : ""}>
        <CardHeader className={isFullscreen ? "flex-shrink-0 border-b py-3 px-6" : ""}>
          <div className="flex items-center gap-2">
            <CardTitle>Unit-Level Detail</CardTitle>
            {activeFilterCount > 0 && (
              <button
                onClick={clearAllFilters}
                className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 border border-teal-200 rounded-full px-2 py-0.5 bg-teal-50 hover:bg-teal-100 transition-colors"
              >
                <X className="w-3 h-3" />
                {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active — clear
              </button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullscreen(f => !f)}
              className="gap-1.5 ml-auto"
            >
              {isFullscreen
                ? <><Minimize2 className="w-4 h-4" /> Exit Full Screen</>
                : <><Maximize2 className="w-4 h-4" /> Full Screen</>}
            </Button>
          </div>
        </CardHeader>
        <CardContent className={isFullscreen ? "flex-1 overflow-hidden flex flex-col pt-4 px-6 pb-4" : ""}>
          {filteredUnits.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No data available for {selectedMonth}</p>
              <p className="text-sm text-gray-400 mt-2">Upload rent roll data to see unit details</p>
            </div>
          ) : (
            <>
            {/* Mirror top scrollbar — native scroll synced to bottom container */}
            <div
              ref={topScrollRef}
              onScroll={handleTopScroll}
              className="scroll-mirror-top mb-1"
            >
              <div style={{ width: tableScrollWidth, height: 1 }} />
            </div>

            <div
              ref={bottomScrollRef}
              onScroll={handleBottomScroll}
              className={isFullscreen ? "scroll-track-bottom flex-1 overflow-auto" : "scroll-track-bottom"}
            >
              <Table ref={tableRef} className="min-w-max text-xs">
                <TableHeader className={isFullscreen ? "sticky top-0 z-20 [&_th]:bg-white [&_th]:shadow-[0_1px_0_0_#e5e7eb]" : ""}>
                  <TableRow>
                    {/* Location — sort + text search filter */}
                    <TableHead
                      className="cursor-pointer hover:bg-slate-50 select-none sticky left-0 z-[31] bg-white w-[130px]"
                      onClick={() => handleSort('location')}
                      data-testid="sort-location"
                    >
                      <div className="flex items-center gap-0.5">
                        Location
                        <SortIcon column="location" />
                        <Popover>
                          <PopoverTrigger asChild>
                            <button onClick={e => e.stopPropagation()} className={`p-0.5 rounded hover:bg-slate-200 transition-colors ${columnFilters.location ? 'text-teal-600' : 'text-slate-400'}`}>
                              <Filter className="w-3 h-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-52 p-3" align="start" onClick={e => e.stopPropagation()}>
                            <p className="text-xs font-semibold mb-2 text-slate-600">Filter Location</p>
                            <Input placeholder="Search…" value={columnFilters.location} onChange={e => { setColumnFilters(p => ({ ...p, location: e.target.value })); setCurrentPage(1); }} className="h-7 text-sm" />
                            {columnFilters.location && <button onClick={() => setColumnFilters(p => ({ ...p, location: '' }))} className="mt-1.5 text-xs text-teal-600 hover:underline flex items-center gap-1"><X className="w-3 h-3" />Clear</button>}
                          </PopoverContent>
                        </Popover>
                      </div>
                    </TableHead>

                    {/* Unit — sort + text search filter */}
                    <TableHead
                      className="cursor-pointer hover:bg-slate-50 select-none sticky left-[130px] z-[31] bg-white w-[65px]"
                      onClick={() => handleSort('unit')}
                      data-testid="sort-unit"
                    >
                      <div className="flex items-center gap-0.5">
                        Unit
                        <SortIcon column="unit" />
                        <Popover>
                          <PopoverTrigger asChild>
                            <button onClick={e => e.stopPropagation()} className={`p-0.5 rounded hover:bg-slate-200 transition-colors ${columnFilters.unit ? 'text-teal-600' : 'text-slate-400'}`}>
                              <Filter className="w-3 h-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-48 p-3" align="start" onClick={e => e.stopPropagation()}>
                            <p className="text-xs font-semibold mb-2 text-slate-600">Filter Unit</p>
                            <Input placeholder="Search…" value={columnFilters.unit} onChange={e => { setColumnFilters(p => ({ ...p, unit: e.target.value })); setCurrentPage(1); }} className="h-7 text-sm" />
                            {columnFilters.unit && <button onClick={() => setColumnFilters(p => ({ ...p, unit: '' }))} className="mt-1.5 text-xs text-teal-600 hover:underline flex items-center gap-1"><X className="w-3 h-3" />Clear</button>}
                          </PopoverContent>
                        </Popover>
                      </div>
                    </TableHead>

                    {/* Room Type — sort + multi-select filter */}
                    <TableHead
                      className="cursor-pointer hover:bg-slate-50 select-none sticky left-[195px] z-[31] bg-white w-[90px] border-r border-slate-200 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
                      onClick={() => handleSort('roomType')}
                      data-testid="sort-room-type"
                    >
                      <div className="flex items-center gap-0.5">
                        Room Type
                        <SortIcon column="roomType" />
                        <Popover>
                          <PopoverTrigger asChild>
                            <button onClick={e => e.stopPropagation()} className={`p-0.5 rounded hover:bg-slate-200 transition-colors ${columnFilters.roomType.length > 0 ? 'text-teal-600' : 'text-slate-400'}`}>
                              <Filter className="w-3 h-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-48 p-3" align="start" onClick={e => e.stopPropagation()}>
                            <p className="text-xs font-semibold mb-2 text-slate-600">Filter Room Type</p>
                            <div className="space-y-1.5 max-h-48 overflow-y-auto">
                              {uniqueRoomTypes.map(rt => (
                                <label key={rt} className="flex items-center gap-2 cursor-pointer">
                                  <Checkbox checked={columnFilters.roomType.includes(rt)} onCheckedChange={checked => { setColumnFilters(p => ({ ...p, roomType: checked ? [...p.roomType, rt] : p.roomType.filter(x => x !== rt) })); setCurrentPage(1); }} />
                                  <span className="text-xs">{rt}</span>
                                </label>
                              ))}
                            </div>
                            {columnFilters.roomType.length > 0 && <button onClick={() => setColumnFilters(p => ({ ...p, roomType: [] }))} className="mt-2 text-xs text-teal-600 hover:underline flex items-center gap-1"><X className="w-3 h-3" />Clear</button>}
                          </PopoverContent>
                        </Popover>
                      </div>
                    </TableHead>

                    <TableHead className="w-[80px]">Attributes</TableHead>

                    {/* Service Line — sort + multi-select filter */}
                    <TableHead
                      className="cursor-pointer hover:bg-slate-50 select-none"
                      onClick={() => handleSort('serviceLine')}
                      data-testid="sort-service-line"
                    >
                      <div className="flex items-center gap-0.5">
                        Service Line
                        <SortIcon column="serviceLine" />
                        <Popover>
                          <PopoverTrigger asChild>
                            <button onClick={e => e.stopPropagation()} className={`p-0.5 rounded hover:bg-slate-200 transition-colors ${columnFilters.serviceLine.length > 0 ? 'text-teal-600' : 'text-slate-400'}`}>
                              <Filter className="w-3 h-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-44 p-3" align="start" onClick={e => e.stopPropagation()}>
                            <p className="text-xs font-semibold mb-2 text-slate-600">Filter Service Line</p>
                            <div className="space-y-1.5">
                              {uniqueServiceLines.map(sl => (
                                <label key={sl} className="flex items-center gap-2 cursor-pointer">
                                  <Checkbox checked={columnFilters.serviceLine.includes(sl)} onCheckedChange={checked => { setColumnFilters(p => ({ ...p, serviceLine: checked ? [...p.serviceLine, sl] : p.serviceLine.filter(x => x !== sl) })); setCurrentPage(1); }} />
                                  <span className="text-xs">{sl}</span>
                                </label>
                              ))}
                            </div>
                            {columnFilters.serviceLine.length > 0 && <button onClick={() => setColumnFilters(p => ({ ...p, serviceLine: [] }))} className="mt-2 text-xs text-teal-600 hover:underline flex items-center gap-1"><X className="w-3 h-3" />Clear</button>}
                          </PopoverContent>
                        </Popover>
                      </div>
                    </TableHead>

                    {/* Status — sort + multi-select filter */}
                    <TableHead
                      className="cursor-pointer hover:bg-slate-50 select-none"
                      onClick={() => handleSort('status')}
                      data-testid="sort-status"
                    >
                      <div className="flex items-center gap-0.5">
                        Status
                        <SortIcon column="status" />
                        <Popover>
                          <PopoverTrigger asChild>
                            <button onClick={e => e.stopPropagation()} className={`p-0.5 rounded hover:bg-slate-200 transition-colors ${columnFilters.status.length > 0 ? 'text-teal-600' : 'text-slate-400'}`}>
                              <Filter className="w-3 h-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-40 p-3" align="start" onClick={e => e.stopPropagation()}>
                            <p className="text-xs font-semibold mb-2 text-slate-600">Filter Status</p>
                            <div className="space-y-1.5">
                              {['Occupied', 'Vacant'].map(s => (
                                <label key={s} className="flex items-center gap-2 cursor-pointer">
                                  <Checkbox checked={columnFilters.status.includes(s)} onCheckedChange={checked => { setColumnFilters(p => ({ ...p, status: checked ? [...p.status, s] : p.status.filter(x => x !== s) })); setCurrentPage(1); }} />
                                  <span className="text-xs">{s}</span>
                                </label>
                              ))}
                            </div>
                            {columnFilters.status.length > 0 && <button onClick={() => setColumnFilters(p => ({ ...p, status: [] }))} className="mt-2 text-xs text-teal-600 hover:underline flex items-center gap-1"><X className="w-3 h-3" />Clear</button>}
                          </PopoverContent>
                        </Popover>
                      </div>
                    </TableHead>

                    {/* Street Rate — sort + range filter */}
                    <TableHead
                      className="cursor-pointer hover:bg-slate-50 select-none"
                      onClick={() => handleSort('streetRate')}
                      data-testid="sort-street-rate"
                    >
                      <div className="flex items-center gap-0.5">
                        Street Rate
                        <SortIcon column="streetRate" />
                        <Popover>
                          <PopoverTrigger asChild>
                            <button onClick={e => e.stopPropagation()} className={`p-0.5 rounded hover:bg-slate-200 transition-colors ${(columnFilters.streetRateMin || columnFilters.streetRateMax) ? 'text-teal-600' : 'text-slate-400'}`}>
                              <Filter className="w-3 h-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-44 p-3" align="start" onClick={e => e.stopPropagation()}>
                            <p className="text-xs font-semibold mb-2 text-slate-600">Filter Street Rate</p>
                            <div className="space-y-1.5">
                              <Input placeholder="Min ($)" type="number" value={columnFilters.streetRateMin} onChange={e => { setColumnFilters(p => ({ ...p, streetRateMin: e.target.value })); setCurrentPage(1); }} className="h-7 text-sm" />
                              <Input placeholder="Max ($)" type="number" value={columnFilters.streetRateMax} onChange={e => { setColumnFilters(p => ({ ...p, streetRateMax: e.target.value })); setCurrentPage(1); }} className="h-7 text-sm" />
                            </div>
                            {(columnFilters.streetRateMin || columnFilters.streetRateMax) && <button onClick={() => setColumnFilters(p => ({ ...p, streetRateMin: '', streetRateMax: '' }))} className="mt-2 text-xs text-teal-600 hover:underline flex items-center gap-1"><X className="w-3 h-3" />Clear</button>}
                          </PopoverContent>
                        </Popover>
                      </div>
                    </TableHead>

                    <TableHead>Applied Rules</TableHead>

                    {/* Rules Rate — sort + range filter */}
                    <TableHead
                      className="cursor-pointer hover:bg-slate-50 select-none"
                      onClick={() => handleSort('modulo')}
                      data-testid="sort-modulo"
                    >
                      <div className="flex items-center gap-0.5">
                        Rules Rate
                        <SortIcon column="modulo" />
                        <Popover>
                          <PopoverTrigger asChild>
                            <button onClick={e => e.stopPropagation()} className={`p-0.5 rounded hover:bg-slate-200 transition-colors ${(columnFilters.rulesRateMin || columnFilters.rulesRateMax) ? 'text-teal-600' : 'text-slate-400'}`}>
                              <Filter className="w-3 h-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-44 p-3" align="start" onClick={e => e.stopPropagation()}>
                            <p className="text-xs font-semibold mb-2 text-slate-600">Filter Rules Rate</p>
                            <div className="space-y-1.5">
                              <Input placeholder="Min ($)" type="number" value={columnFilters.rulesRateMin} onChange={e => { setColumnFilters(p => ({ ...p, rulesRateMin: e.target.value })); setCurrentPage(1); }} className="h-7 text-sm" />
                              <Input placeholder="Max ($)" type="number" value={columnFilters.rulesRateMax} onChange={e => { setColumnFilters(p => ({ ...p, rulesRateMax: e.target.value })); setCurrentPage(1); }} className="h-7 text-sm" />
                            </div>
                            {(columnFilters.rulesRateMin || columnFilters.rulesRateMax) && <button onClick={() => setColumnFilters(p => ({ ...p, rulesRateMin: '', rulesRateMax: '' }))} className="mt-2 text-xs text-teal-600 hover:underline flex items-center gap-1"><X className="w-3 h-3" />Clear</button>}
                          </PopoverContent>
                        </Popover>
                      </div>
                    </TableHead>

                    <TableHead
                      className="cursor-pointer hover:bg-slate-50 select-none"
                      onClick={() => handleSort('ai')}
                      data-testid="sort-ai"
                    >
                      <div className="flex items-center gap-0.5">
                        Rev Target AI
                        <SortIcon column="ai" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer hover:bg-slate-50 select-none"
                      onClick={() => handleSort('competitor')}
                      data-testid="sort-competitor"
                    >
                      <div className="flex items-center gap-0.5">
                        Competitor
                        <SortIcon column="competitor" />
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUnits.slice(startIndex, endIndex).map((unit: any) => (
                    <TableRow 
                      key={unit.id}
                      id={`unit-row-${unit.id}`}
                      className={highlightedUnitId === unit.id ? 'bg-[var(--trilogy-teal)]/10 border-[var(--trilogy-teal)]' : ''}
                    >
                      <TableCell className={`truncate sticky left-0 z-10 w-[130px] ${highlightedUnitId === unit.id ? 'bg-[var(--trilogy-teal)]/10' : 'bg-white'}`} title={unit.location || unit.locationName || unit.campusName || '-'}>
                        {unit.location || unit.locationName || unit.campusName || '-'}
                      </TableCell>
                      <TableCell className={`font-medium sticky left-[130px] z-10 w-[65px] ${highlightedUnitId === unit.id ? 'bg-[var(--trilogy-teal)]/10' : 'bg-white'}`}>
                        {unit.roomNumber}
                      </TableCell>
                      <TableCell className={`sticky left-[195px] z-10 w-[90px] border-r border-slate-200 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] ${highlightedUnitId === unit.id ? 'bg-[var(--trilogy-teal)]/10' : 'bg-white'}`}>{unit.roomType}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="text-left cursor-pointer hover:opacity-70 transition-opacity group"
                          title="Click to edit attributes on Room Attributes page"
                          onClick={() => {
                            localStorage.setItem('roomAttributeFilters', JSON.stringify({
                              locations: [unit.location || unit.locationName || unit.campusName].filter(Boolean),
                              serviceLine: unit.serviceLine,
                              regions: [],
                              divisions: []
                            }));
                            navigate('/room-attributes');
                          }}
                        >
                          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs group-hover:underline underline-offset-2">
                            {[
                              { label: 'Loc', val: unit.locationRating },
                              { label: 'Sz', val: unit.sizeRating },
                              { label: 'Vw', val: unit.viewRating },
                              { label: 'Rn', val: unit.renovationRating },
                              { label: 'Am', val: unit.amenityRating },
                            ].map(({ label, val }) => {
                              const grade = val || 'B';
                              const color = grade === 'A' ? 'text-green-600 dark:text-green-400' : grade === 'C' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground';
                              return (
                                <span key={label} className="flex items-center gap-0.5">
                                  <span className="text-muted-foreground">{label}</span>
                                  <span className={`font-semibold ${color}`}>{grade}</span>
                                </span>
                              );
                            })}
                          </div>
                        </button>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{unit.serviceLine}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={unit.occupiedYN ? "default" : "secondary"}>
                          {unit.occupiedYN ? "Occupied" : `Vacant ${unit.daysVacant}d`}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatRateByServiceLine(Math.round(unit.streetRate || 0), unit.serviceLine)}</TableCell>
                      <TableCell>
                        {unit.appliedRuleName ? (
                          <Badge variant="default" className="text-xs bg-green-600">
                            {unit.appliedRuleName}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {(unit.ruleAdjustedRate || unit.moduloSuggestedRate) ? (
                          <div className="flex items-center space-x-2">
                            <div className="flex flex-col">
                              <ModuloCalculationDialog
                                roomType={unit.roomType}
                                currentRate={unit.streetRate}
                                unitId={unit.id}
                                calculationDetails={(() => {
                                  try {
                                    if (!unit.moduloCalculationDetails) return null;
                                    return typeof unit.moduloCalculationDetails === 'string' 
                                      ? JSON.parse(unit.moduloCalculationDetails)
                                      : unit.moduloCalculationDetails;
                                  } catch {
                                    return null;
                                  }
                                })()}
                                ruleAdjustedRate={unit.ruleAdjustedRate}
                                appliedRuleName={unit.appliedRuleName}
                                serviceLine={unit.serviceLine}
                                locationId={unit.locationId}
                              >
                                <button 
                                  className="cursor-pointer flex items-center space-x-1 text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-300 rounded px-1"
                                  style={{ touchAction: 'manipulation' }}
                                  type="button"
                                  data-testid={`tooltip-modulo-${unit.roomNumber}`}
                                >
                                  <span>
                                    {formatRateByServiceLine(Math.round(unit.ruleAdjustedRate || unit.moduloSuggestedRate), unit.serviceLine)}
                                    {unit.ruleAdjustedRate && unit.streetRate && (
                                      <span className="text-xs text-gray-500 ml-1">
                                        (Street Rate: {formatRateByServiceLine(Math.round(unit.streetRate), unit.serviceLine)})
                                      </span>
                                    )}
                                  </span>
                                  {(() => {
                                    try {
                                      const details = unit.moduloCalculationDetails ? JSON.parse(unit.moduloCalculationDetails) : null;
                                      return details?.guardrailsApplied?.length > 0 ? (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Shield className="h-3 w-3 text-amber-600" />
                                          </TooltipTrigger>
                                          <TooltipContent className="max-w-xs">
                                            <p className="font-semibold text-xs mb-1">Smart Adjustment Rules Applied</p>
                                            {details.guardrailsApplied.map((rule: string, i: number) => (
                                              <p key={i} className="text-xs">{rule}</p>
                                            ))}
                                          </TooltipContent>
                                        </Tooltip>
                                      ) : <Info className="h-3 w-3" />;
                                    } catch {
                                      return <Info className="h-3 w-3" />;
                                    }
                                  })()}
                                </button>
                              </ModuloCalculationDialog>
                              {(() => {
                                const isDailyRate = isDailyRateServiceLine(unit.serviceLine);
                                if (unit.ruleAdjustedRate && unit.streetRate) {
                                  // Rule applied: show the rule's impact vs the Street Rate baseline
                                  const displayFinal = convertToDisplayRate(unit.ruleAdjustedRate, unit.serviceLine) || 0;
                                  const displayBase  = convertToDisplayRate(unit.streetRate, unit.serviceLine) || 0;
                                  const change = Math.round(displayFinal - displayBase);
                                  const changePercent = displayBase !== 0 ? Math.round((change / displayBase) * 100) : 0;
                                  return (
                                    <span className={`text-xs ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      {change >= 0 ? '+' : ''}{formatCurrency(change)}{isDailyRate ? '/day' : ''} ({change >= 0 ? '+' : ''}{changePercent}%)
                                    </span>
                                  );
                                }
                                // No rule: show Modulo vs street rate
                                const displayModulo = convertToDisplayRate(unit.moduloSuggestedRate, unit.serviceLine) || 0;
                                const displayStreet = convertToDisplayRate(unit.streetRate, unit.serviceLine) || 0;
                                const change = Math.round(displayModulo - displayStreet);
                                const changePercent = Math.round((change / displayStreet) * 100);
                                return (
                                  <span className={`text-xs ${change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {change > 0 ? '+' : ''}{formatCurrency(change)}{isDailyRate ? '/day' : ''} ({change > 0 ? '+' : ''}{changePercent}%)
                                  </span>
                                );
                              })()}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => acceptSuggestionsMutation.mutate({
                                unitIds: [unit.id],
                                type: 'modulo'
                              })}
                              data-testid={`button-accept-modulo-${unit.roomNumber}`}
                            >
                              <CheckCircle className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {unit.aiSuggestedRate ? (
                          <div className="flex items-center space-x-2">
                            <div className="flex flex-col">
                              <button 
                                className="cursor-help flex items-center space-x-1 text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-300 rounded px-1"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAIDialogUnit({
                                    unitId: unit.id,
                                    roomType: unit.roomType,
                                    streetRate: unit.streetRate || 0,
                                    aiSuggestedRate: unit.aiSuggestedRate || 0
                                  });
                                }}
                                data-testid={`tooltip-ai-${unit.roomNumber}`}
                              >
                                <span>{formatRateByServiceLine(Math.round(unit.aiSuggestedRate), unit.serviceLine)}</span>
                                <Info className="h-3 w-3" />
                              </button>
                              {(() => {
                                const displayAI = convertToDisplayRate(unit.aiSuggestedRate, unit.serviceLine) || 0;
                                const displayStreet = convertToDisplayRate(unit.streetRate, unit.serviceLine) || 0;
                                const change = Math.round(displayAI - displayStreet);
                                const changePercent = Math.round((change / displayStreet) * 100);
                                const isDailyRate = isDailyRateServiceLine(unit.serviceLine);
                                return (
                                  <span className={`text-xs ${change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {change > 0 ? '+' : ''}{formatCurrency(change)}{isDailyRate ? '/day' : ''} ({change > 0 ? '+' : ''}{changePercent}%)
                                  </span>
                                );
                              })()}
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => acceptSuggestionsMutation.mutate({
                                unitIds: [unit.id],
                                type: 'ai'
                              })}
                              data-testid={`button-accept-ai-${unit.roomNumber}`}
                            >
                              <CheckCircle className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {unit.competitorFinalRate ? (
                          <CompetitorAdjustmentDialog
                            competitorName={unit.competitorName}
                            competitorWeight={unit.competitorWeight}
                            competitorBaseRate={unit.competitorBaseRate}
                            competitorCareLevel2Adjustment={unit.competitorCareLevel2Adjustment}
                            competitorMedManagementAdjustment={unit.competitorMedManagementAdjustment}
                            competitorAdjustmentExplanation={unit.competitorAdjustmentExplanation}
                            adjustedRate={unit.competitorFinalRate}
                            serviceLine={unit.serviceLine}
                          >
                            <button
                              type="button"
                              className="flex items-center gap-1 text-[var(--trilogy-turquoise)] hover:text-[var(--trilogy-turquoise-dark)] font-medium min-h-[44px] px-2 focus:outline-none focus:ring-2 focus:ring-[var(--trilogy-teal)] rounded"
                              style={{ touchAction: 'manipulation' }}
                              data-testid={`button-competitor-rate-${unit.roomNumber}`}
                            >
                              {formatRateByServiceLine(Math.round(unit.competitorFinalRate), unit.serviceLine)}
                              <Info className="h-3 w-3 shrink-0" />
                            </button>
                          </CompetitorAdjustmentDialog>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              
              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between border-t pt-4">
                  <p className="text-sm text-muted-foreground">
                    Showing {startIndex + 1}-{Math.min(endIndex, filteredUnits.length)} of {filteredUnits.length} units
                    {isFetching && <span className="ml-2 text-xs animate-pulse">(updating...)</span>}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                      data-testid="button-first-page"
                    >
                      First
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      data-testid="button-prev-page"
                    >
                      Previous
                    </Button>
                    <span className="text-sm px-2">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      data-testid="button-next-page"
                    >
                      Next
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                      data-testid="button-last-page"
                    >
                      Last
                    </Button>
                  </div>
                </div>
              )}
              {filteredUnits.length > 0 && totalPages === 1 && (
                <div className="mt-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    Showing all {filteredUnits.length} units
                  </p>
                </div>
              )}
            </div>
            </>
          )}
        </CardContent>
      </Card>
      </div>{/* /fullscreen wrapper */}

      {/* AI Calculation Dialog */}
      {aiDialogUnit && (
        <AICalculationDialog
          open={!!aiDialogUnit}
          onOpenChange={(open) => !open && setAIDialogUnit(null)}
          unitId={aiDialogUnit.unitId}
          roomType={aiDialogUnit.roomType}
          streetRate={aiDialogUnit.streetRate}
          aiSuggestedRate={aiDialogUnit.aiSuggestedRate}
        />
      )}
    </div>
    </TooltipProvider>
  );
}