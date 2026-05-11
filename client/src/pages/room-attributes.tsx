import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Navigation from "@/components/navigation";
import AttributeManagement from "@/components/attribute-management";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { DollarSign, Home, Layers, TrendingUp, ChevronDown, X, ArrowUpDown, ArrowUp, ArrowDown, Filter, Check, Loader2, RefreshCw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface UnitWithAttributes {
  id: string;
  location: string;
  serviceLine: string;
  roomNumber: string;
  roomType: string;
  sizeRating?: string;
  viewRating?: string;
  renovationRating?: string;
  locationRating?: string;
  amenityRating?: string;
  streetRate: number;
  inHouseRate: number;
}

interface AttributeRating {
  id: string;
  attributeType: string;
  ratingLevel: string;
  adjustmentPercent: number;
  description?: string;
}

interface RoomTypeBasePrice {
  roomType: string;
  serviceLine: string;
  basePrice: number;
  updatedAt?: string;
}

interface PendingAttributeChange {
  unitId: string;
  roomNumber: string;
  roomType: string;
  serviceLine: string;
  field: string;
  attributeLabel: string;
  oldValue: string | null;
  newValue: string | null;
  currentStreetRate: number;
  newStreetRate: number;
  baseRate: number;
  oldAdj: number;
  newAdj: number;
}

const saveFiltersToStorage = (filters: any) => {
  try {
    localStorage.setItem('roomAttributeFilters', JSON.stringify(filters));
  } catch (error) {
    console.warn('Failed to save filters to localStorage:', error);
  }
};

const loadFiltersFromStorage = () => {
  try {
    const stored = localStorage.getItem('roomAttributeFilters');
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.warn('Failed to load filters from localStorage:', error);
    return null;
  }
};

export default function RoomAttributes() {
  const { toast } = useToast();
  const savedFilters = loadFiltersFromStorage();
  
  const [selectedServiceLine, setSelectedServiceLine] = useState<string>(savedFilters?.serviceLine || "All");
  const [selectedRegions, setSelectedRegions] = useState<string[]>(savedFilters?.regions || []);
  const [selectedDivisions, setSelectedDivisions] = useState<string[]>(savedFilters?.divisions || []);
  const [selectedLocations, setSelectedLocations] = useState<string[]>(savedFilters?.locations?.length > 0 ? savedFilters.locations : ["Albany - 215"]);

  // Local editing state for base price inputs: { [roomType|serviceLine]: inputValue }
  const [editingBasePrices, setEditingBasePrices] = useState<Record<string, string>>({});
  // Track which room types have just been saved (for save indicator)
  const [savedRoomTypes, setSavedRoomTypes] = useState<Set<string>>(new Set());
  // Pending attribute change waiting for street rate confirmation
  const [pendingAttributeChange, setPendingAttributeChange] = useState<PendingAttributeChange | null>(null);
  
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  
  // Column-level filters for the unit table
  const [columnFilters, setColumnFilters] = useState<{
    roomType: string;
    serviceLine: string;
    sizeRating: string;
    viewRating: string;
    renovationRating: string;
    locationRating: string;
    amenityRating: string;
  }>({
    roomType: 'all',
    serviceLine: 'all',
    sizeRating: 'all',
    viewRating: 'all',
    renovationRating: 'all',
    locationRating: 'all',
    amenityRating: 'all',
  });
  
  const updateColumnFilter = (key: keyof typeof columnFilters, value: string) => {
    setColumnFilters(prev => ({ ...prev, [key]: value }));
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

  const { data: rentRollData = [] } = useQuery<UnitWithAttributes[]>({
    queryKey: ['/api/rent-roll'],
  });

  const { data: attributeRatings = [] } = useQuery<AttributeRating[]>({
    queryKey: ['/api/attribute-ratings'],
  });

  const { data: roomTypeBasePricesData = [] } = useQuery<RoomTypeBasePrice[]>({
    queryKey: ['/api/room-type-base-prices'],
  });

  // Key: "${roomType}|${serviceLine}" → basePrice
  const basePriceMap: Record<string, number> = {};
  for (const entry of roomTypeBasePricesData) {
    basePriceMap[`${entry.roomType}|${entry.serviceLine}`] = entry.basePrice;
    // Fallback key for backward compat with 'All' service line entries
    if (entry.serviceLine === 'All') basePriceMap[entry.roomType] = entry.basePrice;
  }

  const getBasePrice = (roomType: string, serviceLine: string): number | undefined => {
    return basePriceMap[`${roomType}|${serviceLine}`] ?? basePriceMap[roomType];
  };

  const updateRatingMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: string | null }) => {
      return apiRequest(`/api/rent-roll/${id}/ratings`, 'PATCH', { field, value });
    },
    onMutate: async ({ id, field, value }) => {
      await queryClient.cancelQueries({ queryKey: ['/api/rent-roll'] });
      const previous = queryClient.getQueryData(['/api/rent-roll']);
      queryClient.setQueryData(['/api/rent-roll'], (old: UnitWithAttributes[] | undefined) =>
        old?.map(unit => unit.id === id ? { ...unit, [field]: value } : unit) ?? []
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['/api/rent-roll'], context.previous);
      toast({ title: 'Failed to update rating', variant: 'destructive' });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rent-roll'] });
    },
  });

  const updateStreetRateMutation = useMutation({
    mutationFn: async ({ id, streetRate }: { id: string; streetRate: number }) => {
      return apiRequest(`/api/rent-roll/${id}/street-rate`, 'PATCH', { streetRate });
    },
    onMutate: async ({ id, streetRate }) => {
      await queryClient.cancelQueries({ queryKey: ['/api/rent-roll'] });
      const previous = queryClient.getQueryData(['/api/rent-roll']);
      queryClient.setQueryData(['/api/rent-roll'], (old: UnitWithAttributes[] | undefined) =>
        old?.map(unit => unit.id === id ? { ...unit, streetRate } : unit) ?? []
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['/api/rent-roll'], context.previous);
      toast({ title: 'Failed to update street rate', variant: 'destructive' });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rent-roll'] });
    },
  });

  const saveBasePriceMutation = useMutation({
    mutationFn: async ({ roomType, serviceLine, basePrice }: { roomType: string; serviceLine: string; basePrice: number }) => {
      return apiRequest('/api/room-type-base-prices', 'PUT', { roomType, serviceLine, basePrice });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/room-type-base-prices'] });
      const key = `${variables.roomType}|${variables.serviceLine}`;
      setSavedRoomTypes(prev => { const next = new Set(prev); next.add(key); return next; });
      setTimeout(() => {
        setSavedRoomTypes(prev => { const next = new Set(prev); next.delete(key); return next; });
      }, 2000);
    },
    onError: () => {
      toast({ title: 'Failed to save base price', variant: 'destructive' });
    },
  });

  const recalculateBaseRatesMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('/api/attribute-pricing/recalculate-base-rates', 'POST', {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/room-type-base-prices'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rent-roll'] });
      toast({
        title: 'Base rates recalculated',
        description: `${data.segmentsUpdated} room type/service line combinations updated, ${data.unitsUpdated} unit street rates refreshed.`,
      });
    },
    onError: () => {
      toast({ title: 'Failed to recalculate base rates', variant: 'destructive' });
    },
  });

  const { data: locationsData } = useQuery<{
    locations?: Array<{ id: string; name: string; region?: string; division?: string }>;
    regions?: string[];
    divisions?: string[];
  }>({
    queryKey: ['/api/locations'],
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

  const getAttributeAdj = (type: string, rating: string | null | undefined): number => {
    if (!rating) return 0;
    return attributeRatings.find(r => r.attributeType === type && r.ratingLevel === rating)?.adjustmentPercent ?? 0;
  };

  const getUnitMultiplier = (unit: UnitWithAttributes, overrideField?: string, overrideValue?: string | null): number => {
    const attributeTypes = ['size', 'view', 'renovation', 'location', 'amenity'];
    let totalAdj = 0;
    attributeTypes.forEach(type => {
      const ratingKey = `${type}Rating` as keyof UnitWithAttributes;
      const rating = overrideField === `${type}Rating` ? overrideValue : (unit[ratingKey] as string | undefined);
      totalAdj += getAttributeAdj(type, rating);
    });
    return 1 + totalAdj / 100;
  };

  const calculateAttributedPrice = (unit: UnitWithAttributes): number | null => {
    const storedBasePrice = getBasePrice(unit.roomType, unit.serviceLine);
    if (storedBasePrice === undefined) return null;
    const multiplier = getUnitMultiplier(unit);
    return Math.ceil(storedBasePrice * multiplier / 10) * 10 - 1;
  };

  const fieldToLabel: Record<string, string> = {
    sizeRating: 'Size', viewRating: 'View', renovationRating: 'Renovation',
    locationRating: 'Location', amenityRating: 'Amenity',
  };
  const fieldToType: Record<string, string> = {
    sizeRating: 'size', viewRating: 'view', renovationRating: 'renovation',
    locationRating: 'location', amenityRating: 'amenity',
  };

  const handleAttributeChange = (unit: UnitWithAttributes, field: string, newVal: string | null) => {
    const baseRate = getBasePrice(unit.roomType, unit.serviceLine);
    if (baseRate === undefined) {
      // No base rate → just update rating without street rate dialog
      updateRatingMutation.mutate({ id: unit.id, field, value: newVal });
      return;
    }
    const oldVal = unit[field as keyof UnitWithAttributes] as string | null | undefined;
    const attrType = fieldToType[field];
    const oldAdj = getAttributeAdj(attrType, oldVal ?? null);
    const newAdj = getAttributeAdj(attrType, newVal);
    const newMultiplier = getUnitMultiplier(unit, field, newVal);
    const newStreetRate = Math.round(baseRate * newMultiplier);
    setPendingAttributeChange({
      unitId: unit.id,
      roomNumber: unit.roomNumber,
      roomType: unit.roomType,
      serviceLine: unit.serviceLine,
      field,
      attributeLabel: fieldToLabel[field] ?? field,
      oldValue: oldVal ?? null,
      newValue: newVal,
      currentStreetRate: unit.streetRate,
      newStreetRate,
      baseRate,
      oldAdj,
      newAdj,
    });
  };

  const confirmAttributeChange = (updateStreetRate: boolean) => {
    if (!pendingAttributeChange) return;
    const { unitId, field, newValue, newStreetRate } = pendingAttributeChange;
    updateRatingMutation.mutate({ id: unitId, field, value: newValue });
    if (updateStreetRate) {
      updateStreetRateMutation.mutate({ id: unitId, streetRate: newStreetRate });
    }
    setPendingAttributeChange(null);
  };

  const seniorHousingServiceLines = ['AL', 'IL', 'SL', 'AL/MC'];
  const filteredUnits = rentRollData.filter(unit => {
    // Global filters
    if (selectedServiceLine !== "All" && unit.serviceLine !== selectedServiceLine) return false;
    if (selectedLocations.length > 0 && !selectedLocations.includes(unit.location)) return false;
    
    const isSeniorHousing = seniorHousingServiceLines.includes(unit.serviceLine);
    const isBBed = unit.roomNumber?.endsWith('/B');
    if (isSeniorHousing && isBBed) return false;
    
    // Column-level filters
    if (columnFilters.roomType !== 'all' && unit.roomType !== columnFilters.roomType) return false;
    if (columnFilters.serviceLine !== 'all' && unit.serviceLine !== columnFilters.serviceLine) return false;
    if (columnFilters.sizeRating !== 'all') {
      if (columnFilters.sizeRating === 'none' && unit.sizeRating) return false;
      if (columnFilters.sizeRating !== 'none' && unit.sizeRating !== columnFilters.sizeRating) return false;
    }
    if (columnFilters.viewRating !== 'all') {
      if (columnFilters.viewRating === 'none' && unit.viewRating) return false;
      if (columnFilters.viewRating !== 'none' && unit.viewRating !== columnFilters.viewRating) return false;
    }
    if (columnFilters.renovationRating !== 'all') {
      if (columnFilters.renovationRating === 'none' && unit.renovationRating) return false;
      if (columnFilters.renovationRating !== 'none' && unit.renovationRating !== columnFilters.renovationRating) return false;
    }
    if (columnFilters.locationRating !== 'all') {
      if (columnFilters.locationRating === 'none' && unit.locationRating) return false;
      if (columnFilters.locationRating !== 'none' && unit.locationRating !== columnFilters.locationRating) return false;
    }
    if (columnFilters.amenityRating !== 'all') {
      if (columnFilters.amenityRating === 'none' && unit.amenityRating) return false;
      if (columnFilters.amenityRating !== 'none' && unit.amenityRating !== columnFilters.amenityRating) return false;
    }
    
    return true;
  });
  
  // Get unique values for filter dropdowns
  const uniqueRoomTypes = Array.from(new Set(rentRollData.map(u => u.roomType))).filter(Boolean).sort();
  const uniqueServiceLines = Array.from(new Set(rentRollData.map(u => u.serviceLine))).filter(Boolean).sort();
  const ratingOptions = ['A', 'B', 'C', 'D', 'none'];

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };
  
  const sortedUnits = [...filteredUnits].sort((a, b) => {
    if (!sortColumn) return 0;
    
    let aValue: any;
    let bValue: any;
    
    switch (sortColumn) {
      case 'location':
        aValue = a.location || '';
        bValue = b.location || '';
        break;
      case 'room':
        aValue = a.roomNumber || '';
        bValue = b.roomNumber || '';
        break;
      case 'type':
        aValue = a.roomType || '';
        bValue = b.roomType || '';
        break;
      case 'serviceLine':
        aValue = a.serviceLine || '';
        bValue = b.serviceLine || '';
        break;
      case 'size':
        aValue = a.sizeRating || '';
        bValue = b.sizeRating || '';
        break;
      case 'view':
        aValue = a.viewRating || '';
        bValue = b.viewRating || '';
        break;
      case 'renovation':
        aValue = a.renovationRating || '';
        bValue = b.renovationRating || '';
        break;
      case 'locationRating':
        aValue = a.locationRating || '';
        bValue = b.locationRating || '';
        break;
      case 'amenity':
        aValue = a.amenityRating || '';
        bValue = b.amenityRating || '';
        break;
      case 'currentRate':
        aValue = a.streetRate || 0;
        bValue = b.streetRate || 0;
        break;
      case 'attributedPrice':
        aValue = calculateAttributedPrice(a) ?? -Infinity;
        bValue = calculateAttributedPrice(b) ?? -Infinity;
        break;
      case 'basePrice': {
        const bpA = getBasePrice(a.roomType, a.serviceLine);
        const bpB = getBasePrice(b.roomType, b.serviceLine);
        aValue = bpA !== undefined ? bpA : -Infinity;
        bValue = bpB !== undefined ? bpB : -Infinity;
        break;
      }
      case 'difference': {
        const apA = calculateAttributedPrice(a);
        const apB = calculateAttributedPrice(b);
        const bpA = getBasePrice(a.roomType, a.serviceLine);
        const bpB = getBasePrice(b.roomType, b.serviceLine);
        aValue = apA !== null && bpA !== undefined ? apA - bpA : -Infinity;
        bValue = apB !== null && bpB !== undefined ? apB - bpB : -Infinity;
        break;
      }
      default:
        return 0;
    }
    
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
    } else {
      const compareResult = String(aValue).localeCompare(String(bValue));
      return sortDirection === 'asc' ? compareResult : -compareResult;
    }
  });

  // Group by (roomType, serviceLine) for granular base rate display
  const filteredSegmentKeys = Array.from(new Set(
    filteredUnits.map(unit => `${unit.roomType}|||${unit.serviceLine}`)
  )).filter(Boolean).sort();

  const roomTypePricing = filteredSegmentKeys.map(segKey => {
    const [roomType, serviceLine] = segKey.split('|||');
    const unitsOfType = filteredUnits.filter(unit => unit.roomType === roomType && unit.serviceLine === serviceLine);
    const avgStreetRate = unitsOfType.reduce((sum, u) => sum + (u.streetRate || 0), 0) / unitsOfType.length || 0;
    const storedBasePrice = getBasePrice(roomType, serviceLine);
    const effectiveBasePrice = storedBasePrice !== undefined ? storedBasePrice : avgStreetRate;
    const attributedPrices = unitsOfType.map(u => calculateAttributedPrice(u)).filter((v): v is number => v !== null);
    const avgAttributedPrice = attributedPrices.length > 0
      ? attributedPrices.reduce((sum, v) => sum + v, 0) / attributedPrices.length
      : null;
    return {
      segKey,
      roomType,
      serviceLine,
      count: unitsOfType.length,
      storedBasePrice,
      avgStreetRate,
      effectiveBasePrice,
      displayBasePrice: Math.round(effectiveBasePrice),
      avgAttributedPrice: avgAttributedPrice !== null ? Math.round(avgAttributedPrice) : null,
      lift: avgAttributedPrice !== null && effectiveBasePrice > 0 ? ((avgAttributedPrice - effectiveBasePrice) / effectiveBasePrice * 100).toFixed(1) : null
    };
  });

  const getScopeDescription = () => {
    if (selectedLocations.length === 0 && selectedServiceLine === "All") {
      return "Viewing all locations and service lines";
    }
    if (selectedLocations.length === 0 && selectedServiceLine !== "All") {
      return `Viewing ${selectedServiceLine} service line across all locations`;
    }
    if (selectedLocations.length === 1 && selectedServiceLine === "All") {
      return `Viewing all service lines at ${selectedLocations[0]}`;
    }
    if (selectedLocations.length === 1 && selectedServiceLine !== "All") {
      return `Viewing ${selectedServiceLine} at ${selectedLocations[0]}`;
    }
    if (selectedLocations.length > 1) {
      return `Viewing ${selectedLocations.length} locations selected`;
    }
    return "Custom scope";
  };

  return (
    <div className="min-h-screen bg-[var(--dashboard-background)]">
      <Navigation />
      
      <div className="container mx-auto px-4 py-6 sm:px-6 lg:px-8 max-w-[1920px]">
        <div className="mb-6">
          <h1 className="text-4xl font-bold mb-2 text-[var(--trilogy-dark-blue)]">
            Room Attributes & Pricing
          </h1>
          <p className="text-[var(--dashboard-text-secondary)]">
            Configure attribute ratings and manage base pricing by room type with attributed pricing calculations
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
                  <PopoverContent className="w-full p-0 max-h-80 overflow-y-auto">
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

            <div className="pt-2 border-t">
              <p className="text-sm text-gray-600">
                <span className="font-medium">Current scope:</span> {getScopeDescription()}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                {filteredUnits.length.toLocaleString()} units match current filters
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center space-x-2">
                    <Home className="h-5 w-5" />
                    <span>Base Pricing by Room Type</span>
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Base price is back-calculated from avg street rate ÷ avg attribute multiplier per room type &amp; service line. Attributed price = Base × multiplier.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => recalculateBaseRatesMutation.mutate()}
                  disabled={recalculateBaseRatesMutation.isPending}
                  className="ml-4 shrink-0"
                >
                  {recalculateBaseRatesMutation.isPending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Recalculating…</>
                    : <><RefreshCw className="h-4 w-4 mr-2" />Recalculate Base Rates</>}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Room Type</TableHead>
                    <TableHead>Service Line</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Avg. Street Rate</TableHead>
                    <TableHead className="text-right">Base Price</TableHead>
                    <TableHead className="text-right">Avg. Attributed Price</TableHead>
                    <TableHead className="text-right">Avg. Attributed Lift</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roomTypePricing.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                        No room data available for selected filters
                      </TableCell>
                    </TableRow>
                  ) : (
                    roomTypePricing.map(({ segKey, roomType, serviceLine, count, storedBasePrice, avgStreetRate, effectiveBasePrice, displayBasePrice, avgAttributedPrice, lift }) => {
                      const rawBasePrice = storedBasePrice !== undefined ? storedBasePrice : displayBasePrice;
                      const editKey = segKey;
                      const isEditing = editingBasePrices[editKey] !== undefined;
                      const inputVal = isEditing
                        ? editingBasePrices[editKey]
                        : Number(rawBasePrice).toLocaleString();
                      const isSaving = saveBasePriceMutation.isPending && saveBasePriceMutation.variables?.roomType === roomType && saveBasePriceMutation.variables?.serviceLine === serviceLine;
                      const isSaved = savedRoomTypes.has(editKey);

                      const handleSave = () => {
                        const raw = editingBasePrices[editKey] ?? String(rawBasePrice);
                        const parsed = parseFloat(raw.replace(/,/g, ''));
                        if (!isNaN(parsed) && parsed >= 0) {
                          saveBasePriceMutation.mutate({ roomType, serviceLine, basePrice: parsed });
                        }
                        setEditingBasePrices(prev => { const next = { ...prev }; delete next[editKey]; return next; });
                      };

                      return (
                        <TableRow key={segKey}>
                          <TableCell className="font-medium">{roomType || 'Unknown'}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{serviceLine}</Badge>
                          </TableCell>
                          <TableCell className="text-right">{count}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground text-sm">
                            ${Math.round(avgStreetRate).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <div className="inline-flex items-center border border-input rounded-md bg-background h-7 pl-2 pr-2 focus-within:ring-1 focus-within:ring-ring">
                                <span className="text-gray-500 font-mono text-sm select-none">$</span>
                                <input
                                  className="w-20 h-full border-0 outline-none text-left font-mono text-sm bg-transparent pl-0.5 pr-0"
                                  value={inputVal}
                                  onFocus={() => setEditingBasePrices(prev => ({ ...prev, [editKey]: String(rawBasePrice) }))}
                                  onChange={e => setEditingBasePrices(prev => ({ ...prev, [editKey]: e.target.value }))}
                                  onBlur={handleSave}
                                  onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                                />
                              </div>
                              {isSaving && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
                              {isSaved && !isSaving && <Check className="h-4 w-4 text-green-500" />}
                            </div>
                            {storedBasePrice === undefined && (
                              <p className="text-xs text-gray-400 mt-0.5 text-right">avg. street rate</p>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-green-600">
                            {avgAttributedPrice !== null ? `$${avgAttributedPrice.toLocaleString()}` : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            {lift !== null ? (
                              <Badge
                                variant={parseFloat(lift) > 5 ? "default" : "secondary"}
                                className={parseFloat(lift) > 5 ? "bg-green-600" : ""}
                              >
                                +{lift}%
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <AttributeManagement 
            selectedLocations={selectedLocations}
            selectedServiceLine={selectedServiceLine}
          />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Layers className="h-5 w-5" />
                <span>Unit-Level Attributed Pricing</span>
              </CardTitle>
              <CardDescription>
                View individual unit attribute ratings and calculated prices based on current filters
              </CardDescription>
            </CardHeader>
            <CardContent>
              {Object.values(columnFilters).some(v => v !== 'all') && (
                <div className="flex items-center gap-2 mb-4 p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <Filter className="h-4 w-4 text-blue-600" />
                  <span className="text-sm text-blue-700 dark:text-blue-300">
                    {Object.values(columnFilters).filter(v => v !== 'all').length} column filter(s) active
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 text-xs"
                    onClick={() => setColumnFilters({
                      roomType: 'all',
                      serviceLine: 'all',
                      sizeRating: 'all',
                      viewRating: 'all',
                      renovationRating: 'all',
                      locationRating: 'all',
                      amenityRating: 'all',
                    })}
                    data-testid="clear-column-filters"
                  >
                    <X className="h-3 w-3 mr-1" />
                    Clear Filters
                  </Button>
                </div>
              )}
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead 
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => handleSort('location')}
                        data-testid="header-location"
                      >
                        <div className="flex items-center">
                          Location
                          {sortColumn === 'location' ? (
                            sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
                          )}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-gray-50"
                        onClick={() => handleSort('room')}
                        data-testid="header-room"
                      >
                        <div className="flex items-center">
                          Room
                          {sortColumn === 'room' ? (
                            sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
                          )}
                        </div>
                      </TableHead>
                      <TableHead>
                        <div className="flex flex-col gap-1">
                          <div 
                            className="flex items-center cursor-pointer hover:text-primary"
                            onClick={() => handleSort('type')}
                          >
                            Type
                            {sortColumn === 'type' ? (
                              sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
                            ) : (
                              <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
                            )}
                          </div>
                          <Select value={columnFilters.roomType} onValueChange={(v) => updateColumnFilter('roomType', v)}>
                            <SelectTrigger className="h-6 text-xs w-24">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              {uniqueRoomTypes.map(rt => (
                                <SelectItem key={rt} value={rt}>{rt}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </TableHead>
                      <TableHead>
                        <div className="flex flex-col gap-1">
                          <div 
                            className="flex items-center cursor-pointer hover:text-primary"
                            onClick={() => handleSort('serviceLine')}
                          >
                            Service Line
                            {sortColumn === 'serviceLine' ? (
                              sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
                            ) : (
                              <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
                            )}
                          </div>
                          <Select value={columnFilters.serviceLine} onValueChange={(v) => updateColumnFilter('serviceLine', v)}>
                            <SelectTrigger className="h-6 text-xs w-16">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              {uniqueServiceLines.map(sl => (
                                <SelectItem key={sl} value={sl}>{sl}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer hover:bg-gray-50 text-right"
                        onClick={() => handleSort('basePrice')}
                      >
                        <div className="flex items-center justify-end">
                          Base Price
                          {sortColumn === 'basePrice' ? (
                            sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
                          )}
                        </div>
                      </TableHead>
                      <TableHead className="text-center">
                        <div className="flex flex-col gap-1 items-center">
                          <span>Size</span>
                          <Select value={columnFilters.sizeRating} onValueChange={(v) => updateColumnFilter('sizeRating', v)}>
                            <SelectTrigger className="h-6 text-xs w-14">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              {ratingOptions.map(r => (
                                <SelectItem key={r} value={r}>{r === 'none' ? '—' : r}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </TableHead>
                      <TableHead className="text-center">
                        <div className="flex flex-col gap-1 items-center">
                          <span>View</span>
                          <Select value={columnFilters.viewRating} onValueChange={(v) => updateColumnFilter('viewRating', v)}>
                            <SelectTrigger className="h-6 text-xs w-14">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              {ratingOptions.map(r => (
                                <SelectItem key={r} value={r}>{r === 'none' ? '—' : r}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </TableHead>
                      <TableHead className="text-center">
                        <div className="flex flex-col gap-1 items-center">
                          <span>Reno.</span>
                          <Select value={columnFilters.renovationRating} onValueChange={(v) => updateColumnFilter('renovationRating', v)}>
                            <SelectTrigger className="h-6 text-xs w-14">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              {ratingOptions.map(r => (
                                <SelectItem key={r} value={r}>{r === 'none' ? '—' : r}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </TableHead>
                      <TableHead className="text-center">
                        <div className="flex flex-col gap-1 items-center">
                          <span>Loc.</span>
                          <Select value={columnFilters.locationRating} onValueChange={(v) => updateColumnFilter('locationRating', v)}>
                            <SelectTrigger className="h-6 text-xs w-14">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              {ratingOptions.map(r => (
                                <SelectItem key={r} value={r}>{r === 'none' ? '—' : r}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </TableHead>
                      <TableHead className="text-center">
                        <div className="flex flex-col gap-1 items-center">
                          <span>Amen.</span>
                          <Select value={columnFilters.amenityRating} onValueChange={(v) => updateColumnFilter('amenityRating', v)}>
                            <SelectTrigger className="h-6 text-xs w-14">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              {ratingOptions.map(r => (
                                <SelectItem key={r} value={r}>{r === 'none' ? '—' : r}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-gray-50 text-right"
                        onClick={() => handleSort('attributedPrice')}
                      >
                        <div className="flex items-center justify-end">
                          Attributed
                          {sortColumn === 'attributedPrice' ? (
                            sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
                          )}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-gray-50 text-right"
                        onClick={() => handleSort('difference')}
                        data-testid="header-difference"
                      >
                        <div className="flex items-center justify-end">
                          Difference
                          {sortColumn === 'difference' ? (
                            sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
                          )}
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover:bg-gray-50 text-right"
                        onClick={() => handleSort('currentRate')}
                        data-testid="header-currentRate"
                      >
                        <div className="flex items-center justify-end">
                          Current Street Rate
                          {sortColumn === 'currentRate' ? (
                            sortDirection === 'asc' ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
                          )}
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedUnits.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={13} className="text-center py-8 text-gray-500">
                          No units match the selected filters
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedUnits.slice(0, 100).map(unit => {
                        const attributedPrice = calculateAttributedPrice(unit);
                        const basePrice = getBasePrice(unit.roomType, unit.serviceLine);
                        const difference = attributedPrice !== null && basePrice !== undefined ? attributedPrice - basePrice : null;
                        const percentDiff = difference !== null && basePrice !== undefined && basePrice > 0 ? (difference / basePrice * 100) : null;
                        
                        return (
                          <TableRow key={unit.id}>
                            <TableCell className="text-sm">{unit.location}</TableCell>
                            <TableCell className="font-medium">{unit.roomNumber}</TableCell>
                            <TableCell className="text-sm">{unit.roomType}</TableCell>
                            <TableCell className="text-sm">{unit.serviceLine}</TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {basePrice !== undefined
                                ? <span>${Math.round(basePrice).toLocaleString()}</span>
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            {(['sizeRating', 'viewRating', 'renovationRating', 'locationRating', 'amenityRating'] as const).map(field => {
                              const rating = unit[field] as string | undefined;
                              return (
                                <TableCell key={field} className="text-center p-1">
                                  <Select
                                    value={rating || '__none__'}
                                    onValueChange={val => handleAttributeChange(unit, field, val === '__none__' ? null : val)}
                                  >
                                    <SelectTrigger className="h-7 w-16 mx-auto text-xs border-dashed hover:border-solid focus:ring-0">
                                      <SelectValue>
                                        {rating
                                          ? <Badge className={`${getRatingColor(rating)} text-xs px-1 py-0`} variant="outline">{rating}</Badge>
                                          : <span className="text-muted-foreground">—</span>
                                        }
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__"><span className="text-muted-foreground text-xs">None</span></SelectItem>
                                      <SelectItem value="A"><Badge className={`${getRatingColor('A')} text-xs`} variant="outline">A</Badge></SelectItem>
                                      <SelectItem value="B"><Badge className={`${getRatingColor('B')} text-xs`} variant="outline">B</Badge></SelectItem>
                                      <SelectItem value="C"><Badge className={`${getRatingColor('C')} text-xs`} variant="outline">C</Badge></SelectItem>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                              );
                            })}
                            <TableCell className="text-right font-mono text-green-600 font-semibold">
                              {attributedPrice !== null
                                ? `$${attributedPrice.toLocaleString()}`
                                : <span className="text-muted-foreground font-normal">—</span>}
                            </TableCell>
                            <TableCell className="text-right">
                              {difference !== null ? (
                                <div className="flex flex-col items-end">
                                  <span className={difference > 0 ? "text-green-600" : difference < 0 ? "text-red-600" : "text-gray-500"}>
                                    {difference > 0 ? '+' : ''}${Math.round(difference).toLocaleString()}
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    ({percentDiff !== null && percentDiff > 0 ? '+' : ''}{percentDiff !== null ? percentDiff.toFixed(1) : '0.0'}%)
                                  </span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              ${unit.streetRate.toLocaleString()}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
                {sortedUnits.length > 100 && (
                  <div className="p-4 text-center text-sm text-gray-500 border-t">
                    Showing first 100 of {sortedUnits.length} units
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Attribute Change Confirmation Dialog */}
      <Dialog open={!!pendingAttributeChange} onOpenChange={open => { if (!open) setPendingAttributeChange(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update Street Rate?</DialogTitle>
            <DialogDescription>
              Changing this attribute will affect the attributed price for unit <strong>{pendingAttributeChange?.roomNumber}</strong>.
            </DialogDescription>
          </DialogHeader>
          {pendingAttributeChange && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-gray-50 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">{pendingAttributeChange.attributeLabel} Rating</span>
                  <span className="font-medium">
                    <Badge variant="outline" className={getRatingColor(pendingAttributeChange.oldValue ?? '')}>
                      {pendingAttributeChange.oldValue ?? '—'}
                    </Badge>
                    {' → '}
                    <Badge variant="outline" className={getRatingColor(pendingAttributeChange.newValue ?? '')}>
                      {pendingAttributeChange.newValue ?? '—'}
                    </Badge>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Attribute Premium Change</span>
                  <span className="font-medium">
                    {pendingAttributeChange.oldAdj > 0 ? '+' : ''}{pendingAttributeChange.oldAdj.toFixed(1)}%
                    {' → '}
                    {pendingAttributeChange.newAdj > 0 ? '+' : ''}{pendingAttributeChange.newAdj.toFixed(1)}%
                  </span>
                </div>
                <div className="border-t pt-2 flex justify-between">
                  <span className="text-gray-600">Current Street Rate</span>
                  <span className="font-mono">${pendingAttributeChange.currentStreetRate.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">New Street Rate</span>
                  <span className="font-mono font-semibold">${pendingAttributeChange.newStreetRate.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Change</span>
                  <span className={`font-semibold ${pendingAttributeChange.newStreetRate - pendingAttributeChange.currentStreetRate >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {pendingAttributeChange.newStreetRate - pendingAttributeChange.currentStreetRate >= 0 ? '+' : ''}
                    ${Math.round(pendingAttributeChange.newStreetRate - pendingAttributeChange.currentStreetRate).toLocaleString()}
                    {' '}
                    ({((pendingAttributeChange.newStreetRate - pendingAttributeChange.currentStreetRate) / pendingAttributeChange.currentStreetRate * 100).toFixed(1)}%)
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Base Rate Used</span>
                  <span>${Math.round(pendingAttributeChange.baseRate).toLocaleString()}</span>
                </div>
              </div>
              <p className="text-sm text-gray-600">
                Would you like to push this street rate adjustment to the Rate Card?
              </p>
            </div>
          )}
          <DialogFooter className="flex gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => confirmAttributeChange(false)}>
              Update Rating Only
            </Button>
            <Button onClick={() => confirmAttributeChange(true)} className="bg-teal-600 hover:bg-teal-700">
              Yes, Update Street Rate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getRatingColor(rating: string): string {
  switch (rating?.toUpperCase()) {
    case 'A':
      return 'border-green-500 text-green-700 bg-green-50';
    case 'B':
      return 'border-yellow-500 text-yellow-700 bg-yellow-50';
    case 'C':
      return 'border-gray-500 text-gray-700 bg-gray-50';
    default:
      return 'border-gray-300 text-gray-600 bg-gray-50';
  }
}
