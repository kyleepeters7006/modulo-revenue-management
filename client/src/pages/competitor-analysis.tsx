import { useState, useEffect } from "react";
import Navigation from "@/components/navigation";
import { CompetitorMap } from "@/components/dashboard/competitor-map";
import CompetitorForm from "@/components/dashboard/competitor-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronDown, ChevronUp, X, Building2, TrendingUp, TrendingDown, Minus, Info, Loader2, RefreshCw, Pencil, ExternalLink, SlidersHorizontal } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

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
  const { isAdmin } = useAuth();

  // Check for URL parameters first
  const urlParams = new URLSearchParams(window.location.search);
  const urlLocation = urlParams.get('location');
  const urlServiceLine = urlParams.get('serviceLine');
  const urlEditId = urlParams.get('edit');
  
  // Load initial state from URL params, then localStorage, or use defaults
  const savedFilters = loadCompetitorFiltersFromStorage();
  const [selectedRegions, setSelectedRegions] = useState<string[]>(savedFilters?.regions || []);
  const [selectedDivisions, setSelectedDivisions] = useState<string[]>(savedFilters?.divisions || []);
  const [selectedLocations, setSelectedLocations] = useState<string[]>(
    urlLocation ? [urlLocation] : (savedFilters?.locations?.length > 0 ? savedFilters.locations : ["Albany - 215"])
  );
  // Support both URL param, savedFilters.serviceLines array, and singular serviceLine from other pages
  const initialServiceLines = urlServiceLine && urlServiceLine !== 'All' 
    ? [urlServiceLine] 
    : (savedFilters?.serviceLines?.length > 0 
        ? savedFilters.serviceLines 
        : (savedFilters?.serviceLine && savedFilters.serviceLine !== 'All' 
            ? [savedFilters.serviceLine] 
            : ['AL']));
  const [selectedServiceLines, setSelectedServiceLines] = useState<string[]>(initialServiceLines);

  // Sorting state for the rate comparison table
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  // Inline-editing state: which cell is currently being edited
  const [editCell, setEditCell] = useState<{ id: string; field: string; value: string } | null>(null);
  // Pricing-weights panel state
  const [weightSl, setWeightSl] = useState<string>('');
  const [weightEdits, setWeightEdits] = useState<Record<string, number> | null>(null);

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

  // Poll geocoding status — shows a banner while competitor coordinates are still being resolved
  const { data: geocodingStatus, refetch: refetchGeocodingStatus } = useQuery<{
    pending: number;
    geocoding: boolean;
    jobProgress: {
      jobId: string;
      status: string;
      totalRows: number;
      processedRows: number;
      updatedRows: number;
      failedRows: number;
      skippedRows: number;
      percent: number;
      startedAt: string | null;
      completedAt: string | null;
    } | null;
  }>({
    queryKey: ["/api/admin/geocoding-status"],
    refetchInterval: (query) => (query.state.data as { geocoding?: boolean } | undefined)?.geocoding ? 3000 : false,
    staleTime: 0,
  });
  const isGeocoding = geocodingStatus?.geocoding === true;
  const geocodingPending = geocodingStatus?.pending ?? 0;
  const jobProgress = geocodingStatus?.jobProgress ?? null;

  // Retry geocoding mutation — triggers both geocoding jobs on demand (admin only)
  const retryGeocodeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("/api/admin/geocode-missing-locations", "POST");
      // Fire-and-forget; returns immediately with a jobId
      await apiRequest("/api/admin/geocode-missing-competitor-surveys", "POST");
    },
    onSuccess: () => {
      // Start polling immediately
      refetchGeocodingStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
    },
  });
  const isRetrying = retryGeocodeMutation.isPending;

  // Fetch competitor rate comparison data when a single location is selected
  const { data: competitorRateData, isLoading: isLoadingRates } = useQuery({
    queryKey: ["/api/competitor-rate-comparison", selectedLocations[0], selectedServiceLines],
    queryFn: async () => {
      if (selectedLocations.length !== 1) return { data: [], trilogyRates: {} };
      const params = new URLSearchParams();
      params.append('location', selectedLocations[0]);
      selectedServiceLines.forEach(sl => params.append('serviceLines', sl));
      const res = await fetch(`/api/competitor-rate-comparison?${params.toString()}`);
      return res.json();
    },
    enabled: selectedLocations.length === 1,
  });

  const { toast } = useToast();

  // Derive locationId for the selected single location (needed for weights)
  const locationId = (locationsData as any)?.locations?.find(
    (l: any) => l.name === selectedLocations[0]
  )?.id as string | undefined;

  // Weights query — respects 3-tier fallback on the backend
  const { data: weightsData, isLoading: isLoadingWeights } = useQuery({
    queryKey: ["/api/weights", locationId, weightSl],
    queryFn: async () => {
      if (!locationId) return null;
      const params = new URLSearchParams({ locationId });
      if (weightSl) params.set('serviceLine', weightSl);
      const res = await fetch(`/api/weights?${params}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!locationId && selectedLocations.length === 1,
  });

  // Mutation: save edits to a competitor survey row's rate fields
  const updateSurveyMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; baseRate?: number; careLevel2Adjustment?: number; medMgmtFee?: number }) => {
      const res = await fetch(`/api/competitive-survey/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Update failed'); }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitor-rate-comparison", selectedLocations[0], selectedServiceLines] });
      setEditCell(null);
      toast({ title: 'Rate updated' });
    },
    onError: (e: any) => toast({ title: e.message || 'Update failed', variant: 'destructive' }),
  });

  // Mutation: save pricing weights for this location / service line
  const saveWeightsMutation = useMutation({
    mutationFn: async (weights: Record<string, number>) => {
      const res = await fetch('/api/weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location_id: locationId,
          service_line: weightSl || undefined,
          occupancy_pressure: weights.occupancyPressure,
          days_vacant_decay: weights.daysVacantDecay,
          seasonality: weights.seasonality,
          competitor_rates: weights.competitorRates,
          stock_market: weights.stockMarket,
          inquiry_tour_volume: weights.inquiryTourVolume,
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Save failed'); }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/weights", locationId, weightSl] });
      setWeightEdits(null);
      toast({ title: 'Weights saved' });
    },
    onError: (e: any) => toast({ title: e.message || 'Save failed', variant: 'destructive' }),
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
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="mb-4 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1 sm:mb-2" data-testid="text-page-title">
            Competitor Analysis
          </h1>
          <p className="text-sm sm:text-base text-gray-600" data-testid="text-page-subtitle">
            Geographic mapping and rate comparison with nearby competitors
          </p>

          {/* Geocoding progress / retry banner */}
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            {isGeocoding && (
              <div
                className="flex flex-1 flex-col gap-2 rounded-md border border-teal-300 bg-teal-50 px-4 py-3 text-sm text-teal-800"
                data-testid="banner-geocoding-progress"
              >
                <div className="flex items-center gap-3">
                  <Loader2 className="h-4 w-4 animate-spin flex-shrink-0 text-teal-600" />
                  <span>
                    Geocoding competitor locations&hellip;{" "}
                    {jobProgress && jobProgress.totalRows > 0 ? (
                      <>
                        <span className="font-semibold">{jobProgress.processedRows}</span>
                        {" / "}
                        <span className="font-semibold">{jobProgress.totalRows}</span>
                        {" addresses processed"}
                        {geocodingPending > 0 && (
                          <> &mdash; <span className="font-semibold">{geocodingPending}</span> {geocodingPending === 1 ? "pin" : "pins"} still missing</>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="font-semibold">{geocodingPending}</span>{" "}
                        {geocodingPending === 1 ? "address" : "addresses"} remaining
                      </>
                    )}
                    . Map pins will appear as coordinates resolve.
                  </span>
                </div>
                {jobProgress && jobProgress.totalRows > 0 && (
                  <div className="w-full rounded-full bg-teal-200 h-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full bg-teal-500 transition-all duration-500"
                      style={{ width: `${jobProgress.percent}%` }}
                      data-testid="geocoding-progress-bar"
                    />
                  </div>
                )}
                {jobProgress && jobProgress.totalRows > 0 && (
                  <div className="flex gap-4 text-xs text-teal-700">
                    <span>{jobProgress.percent}% complete</span>
                    {jobProgress.updatedRows > 0 && <span>{jobProgress.updatedRows} geocoded</span>}
                    {jobProgress.failedRows > 0 && <span className="text-amber-700">{jobProgress.failedRows} failed</span>}
                    {jobProgress.skippedRows > 0 && <span>{jobProgress.skippedRows} skipped</span>}
                  </div>
                )}
              </div>
            )}
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => retryGeocodeMutation.mutate()}
                disabled={isRetrying || isGeocoding}
                data-testid="btn-retry-geocoding"
                className="flex items-center gap-2 whitespace-nowrap"
              >
                {isRetrying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {isRetrying ? "Starting…" : geocodingPending > 0 ? `Retry (${geocodingPending} pending)` : "Retry Geocoding"}
              </Button>
            )}
          </div>

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
            initialEditId={urlEditId}
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
              initialEditId={urlEditId}
            />
          </div>
        </div>

        {/* Competitor Rate Comparison Section */}
        <Card className="mt-8" data-testid="card-competitor-rate-comparison">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-blue-600" />
              <CardTitle>Competitor Rate Comparison</CardTitle>
            </div>
            <CardDescription>
              {selectedLocations.length === 1 
                ? `Comparing rates for ${selectedLocations[0]} with nearby competitors`
                : "Select a single location to view competitor rate comparison"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {selectedLocations.length !== 1 ? (
              <div className="text-center py-8 text-gray-500">
                Please select exactly one location from the filter above to see competitor rate comparison.
              </div>
            ) : isLoadingRates ? (
              <div className="text-center py-8 text-gray-500">Loading competitor data...</div>
            ) : !competitorRateData?.data?.length ? (
              <div className="text-center py-8 text-gray-500">
                No competitor data available for this location and service line combination.
              </div>
            ) : (() => {
              // ── Sort helpers ──────────────────────────────────────────
              const handleSort = (field: string) => {
                if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                else { setSortField(field); setSortDir('asc'); }
              };
              const SortIndicator = ({ field }: { field: string }) =>
                sortField !== field
                  ? <ChevronDown className="h-3 w-3 ml-0.5 opacity-25" />
                  : sortDir === 'asc'
                    ? <ChevronUp className="h-3 w-3 ml-0.5 opacity-80 text-teal-600" />
                    : <ChevronDown className="h-3 w-3 ml-0.5 opacity-80 text-teal-600" />;
              const SortableHead = ({ field, label, right }: { field: string; label: string; right?: boolean }) => (
                <TableHead
                  className={`cursor-pointer select-none hover:bg-gray-50 whitespace-nowrap ${right ? 'text-right' : ''}`}
                  onClick={() => handleSort(field)}
                >
                  <span className={`inline-flex items-center gap-0 ${right ? 'flex-row-reverse' : ''}`}>
                    {label}<SortIndicator field={field} />
                  </span>
                </TableHead>
              );

              // ── Sort data ─────────────────────────────────────────────
              const sortedData = [...competitorRateData.data].sort((a: any, b: any) => {
                if (!sortField) return 0;
                const va = a[sortField]; const vb = b[sortField];
                if (va == null) return 1; if (vb == null) return -1;
                if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
                return sortDir === 'asc' ? va - vb : vb - va;
              });

              // ── Inline-edit helpers ───────────────────────────────────
              const startEdit = (id: string, field: string, value: number) =>
                setEditCell({ id, field, value: String(value) });
              const commitEdit = () => {
                if (!editCell) return;
                const val = parseFloat(editCell.value);
                if (isNaN(val)) { setEditCell(null); return; }
                const updates: any = { id: editCell.id };
                if (editCell.field === 'baseRate') updates.baseRate = val;
                else if (editCell.field === 'careAdj') updates.careLevel2Adjustment = val;
                else if (editCell.field === 'medMgmt') updates.medMgmtFee = val;
                updateSurveyMutation.mutate(updates);
              };
              const EditableCell = ({ row, field, value, sign = false }: { row: any; field: string; value: number; sign?: boolean }) => {
                const isEditing = editCell?.id === String(row.id) && editCell.field === field;
                if (isEditing) {
                  return (
                    <TableCell className="text-right p-1.5">
                      <input
                        autoFocus
                        type="number"
                        className="w-24 text-right border border-teal-400 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500 bg-white"
                        value={editCell!.value}
                        onChange={e => setEditCell({ ...editCell!, value: e.target.value })}
                        onBlur={commitEdit}
                        onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditCell(null); }}
                      />
                    </TableCell>
                  );
                }
                const display = value === 0 ? '—'
                  : sign ? (value > 0 ? `+$${value.toLocaleString()}` : `−$${Math.abs(value).toLocaleString()}`)
                  : `$${value.toLocaleString()}`;
                return (
                  <TableCell
                    className="text-right cursor-pointer group"
                    onClick={() => startEdit(String(row.id), field, value)}
                    title="Click to edit"
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-40 text-gray-400 flex-shrink-0" />
                      {display}
                    </span>
                  </TableCell>
                );
              };

              return (
                <div className="overflow-x-auto">
                  {competitorRateData.usingDistanceFallback && (
                    <p className="text-xs text-amber-600 mb-2 flex items-center gap-1">
                      <Info className="h-3 w-3 flex-shrink-0" />
                      No weighted competitors configured — showing 5 closest by distance.
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mb-2">
                    Click any <Pencil className="h-3 w-3 inline" /> cell to edit. Press Enter to save, Escape to cancel.
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableHead field="competitorName" label="Competitor" />
                        <SortableHead field="serviceLine" label="Service Line" />
                        <SortableHead field="roomType" label="Room Type" />
                        <SortableHead field="distanceMiles" label="Distance" right />
                        <SortableHead field="baseRate" label="Base Rate" right />
                        <SortableHead field="careLevel2Adjustment" label="Care Adj." right />
                        <SortableHead field="medMgmtAdjustment" label="Med Mgmt" right />
                        <SortableHead field="adjustedRate" label="Adjusted Rate" right />
                        <SortableHead field="trilogyRate" label="Trilogy Rate" right />
                        <SortableHead field="marketPosition" label="Market Position" right />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedData.map((row: any) => {
                        const positionColor = row.marketPosition >= 100
                          ? "text-green-600"
                          : row.marketPosition >= 90
                          ? "text-yellow-600"
                          : "text-red-600";
                        const PositionIcon = row.marketPosition > 100
                          ? TrendingUp
                          : row.marketPosition >= 90
                          ? Minus
                          : TrendingDown;
                        return (
                          <TableRow key={row.id} data-testid={`row-competitor-${row.id}`}>
                            <TableCell className="font-medium">{row.competitorName}</TableCell>
                            <TableCell><Badge variant="outline">{row.serviceLine}</Badge></TableCell>
                            <TableCell>{row.roomType || 'N/A'}</TableCell>
                            <TableCell className="text-right">
                              {row.distanceMiles ? `${row.distanceMiles.toFixed(1)} mi` : 'N/A'}
                            </TableCell>
                            <EditableCell row={row} field="baseRate" value={row.baseRate ?? 0} />
                            <EditableCell row={row} field="careAdj" value={row.careLevel2Adjustment ?? 0} sign />
                            <EditableCell row={row} field="medMgmt" value={row.medMgmtAdjustment ?? 0} sign />
                            <TableCell className="text-right font-semibold">
                              ${row.adjustedRate?.toLocaleString() ?? 0}
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              <button
                                className="text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1 ml-auto"
                                onClick={() => {
                                  localStorage.setItem('appFilters', JSON.stringify({
                                    locations: [selectedLocations[0]],
                                    serviceLine: row.serviceLine,
                                    serviceLines: [row.serviceLine],
                                    roomType: row.roomType,
                                    regions: selectedRegions,
                                    divisions: selectedDivisions,
                                  }));
                                  window.location.href = '/rate-card';
                                }}
                                title="Open in Rate Card filtered to this service line & room type"
                              >
                                ${row.trilogyRate?.toLocaleString() ?? 0}
                                <ExternalLink className="h-3 w-3 flex-shrink-0" />
                              </button>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className={`flex items-center justify-end gap-1 ${positionColor}`}>
                                <PositionIcon className="h-4 w-4" />
                                <span className="font-semibold">{row.marketPosition.toFixed(1)}%</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Pricing Weights Panel */}
        {selectedLocations.length === 1 && locationId && (
          <Card className="mt-6">
            <CardHeader>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-5 w-5 text-teal-600" />
                  <CardTitle className="text-base">Pricing Weights — {selectedLocations[0]}</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Scope:</span>
                  <Select
                    value={weightSl || "__all__"}
                    onValueChange={v => { setWeightSl(v === "__all__" ? "" : v); setWeightEdits(null); }}
                  >
                    <SelectTrigger className="h-8 w-44 text-xs">
                      <SelectValue placeholder="All Service Lines" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All Service Lines</SelectItem>
                      {serviceLineOptions.map(sl => (
                        <SelectItem key={sl} value={sl}>{sl}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <CardDescription>
                Controls how each factor influences Modulo pricing recommendations for this location.
                Values must sum to 100%. Changes apply from the next calculation run.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingWeights ? (
                <div className="flex items-center gap-2 py-4 text-gray-500 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading weights…
                </div>
              ) : !weightsData ? (
                <div className="text-center py-4 text-gray-500 text-sm">No weights found for this location.</div>
              ) : (() => {
                const current: Record<string, number> = weightEdits ?? {
                  occupancyPressure: weightsData.occupancy_pressure ?? 0,
                  daysVacantDecay: weightsData.days_vacant_decay ?? 0,
                  seasonality: weightsData.seasonality ?? 0,
                  competitorRates: weightsData.competitor_rates ?? 0,
                  stockMarket: weightsData.stock_market ?? 0,
                  inquiryTourVolume: weightsData.inquiry_tour_volume ?? 0,
                };
                const total = Object.values(current).reduce((s, v) => s + v, 0);
                const weightFields: { key: string; label: string }[] = [
                  { key: 'occupancyPressure', label: 'Occupancy Pressure' },
                  { key: 'daysVacantDecay', label: 'Days Vacant Decay' },
                  { key: 'seasonality', label: 'Seasonality' },
                  { key: 'competitorRates', label: 'Competitor Rates' },
                  { key: 'stockMarket', label: 'Stock Market' },
                  { key: 'inquiryTourVolume', label: 'Inquiry & Tour Vol.' },
                ];
                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                      {weightFields.map(({ key, label }) => (
                        <div key={key} className="space-y-1.5">
                          <label className="text-xs font-medium text-gray-600 block">{label}</label>
                          <div className="relative">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm pr-7 focus:outline-none focus:ring-1 focus:ring-teal-500 bg-white"
                              value={current[key]}
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0;
                                setWeightEdits({ ...current, [key]: val });
                              }}
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                      <span className={`text-sm font-medium ${total === 100 ? 'text-green-600' : 'text-red-500'}`}>
                        Total: {total}%
                        {total !== 100 && (
                          <span className="ml-1 font-normal text-xs">
                            ({total > 100 ? `+${total - 100}` : total - 100} from 100)
                          </span>
                        )}
                        {total === 100 && ' ✓'}
                      </span>
                      <div className="flex items-center gap-2">
                        {weightEdits && (
                          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setWeightEdits(null)}>
                            Reset
                          </Button>
                        )}
                        <Button
                          size="sm"
                          disabled={total !== 100 || saveWeightsMutation.isPending || !weightEdits}
                          onClick={() => weightEdits && saveWeightsMutation.mutate(weightEdits)}
                          className="bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50"
                        >
                          {saveWeightsMutation.isPending ? (
                            <><Loader2 className="h-3 w-3 animate-spin mr-1" />Saving…</>
                          ) : 'Save Weights'}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}