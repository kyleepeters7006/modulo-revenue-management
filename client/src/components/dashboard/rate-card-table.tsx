import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Brain, Calculator, CheckCircle, AlertCircle, Edit, Info, Loader2, Shield, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import ModuloCalculationDialog from "./modulo-calculation-dialog";
import AICalculationDialog from "./ai-calculation-dialog";
import { formatNumber, formatCurrency, formatPercentage } from "@/lib/formatters";

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
  const [editingUnit, setEditingUnit] = useState<string | null>(null);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);
  const [localServiceLine, setLocalServiceLine] = useState<string>("All");
  const [aiDialogUnit, setAIDialogUnit] = useState<{ unitId: string; roomType: string; streetRate: number } | null>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
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

  const { data: rateCardData, isLoading } = useQuery({
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
    }
  });

  // Sync selectedMonth with the month returned by the API (most recent month with data)
  useEffect(() => {
    if (rateCardData?.month && !selectedMonth) {
      setSelectedMonth(rateCardData.month);
    }
  }, [rateCardData?.month, selectedMonth]);

  // DEBUG: Log the data to see what's being received
  useEffect(() => {
    if (rateCardData) {
      console.log('Rate Card Data:', {
        month: rateCardData?.month,
        unitsCount: rateCardData?.units?.length || 0,
        summaryCount: rateCardData?.summary?.length || 0,
        sampleUnit: rateCardData?.units?.[0],
        selectedServiceLine
      });
    }
  }, [rateCardData, selectedServiceLine]);

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

  const generateModuloMutation = useMutation({
    mutationFn: () => apiRequest('/api/pricing/generate-modulo', 'POST', { 
      month: selectedMonth,
      serviceLine: selectedServiceLine !== 'All' ? selectedServiceLine : undefined,
      regions: selectedRegions,
      divisions: selectedDivisions,
      locations: selectedLocations
    }),
    onSuccess: () => {
      toast({
        title: "Modulo suggestions generated",
        description: "Pricing recommendations have been calculated"
      });
      queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to generate Modulo suggestions",
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
        title: "AI suggestions generated",
        description: "AI-powered pricing recommendations are ready"
      });
      queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to generate AI suggestions", 
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

  const updateAttributesMutation = useMutation({
    mutationFn: ({ unitId, attributes }: { unitId: string, attributes: any }) =>
      apiRequest(`/api/units/${unitId}/attributes`, 'PUT', attributes),
    onSuccess: () => {
      toast({
        title: "Attributes updated",
        description: "Unit attribute ratings have been saved"
      });
      queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
      setEditingUnit(null);
    }
  });

  // Helper function to generate Modulo calculation explanation
  const getModuloTooltip = (unit: any) => {
    if (!unit.moduloSuggestedRate || unit.moduloSuggestedRate === unit.streetRate) {
      return "No Modulo suggestions available";
    }

    const change = unit.moduloSuggestedRate - unit.streetRate;
    const changePercent = Math.round((change / unit.streetRate) * 100);
    
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
    
    // Competitor factor
    if (unit.competitorFinalRate && Math.abs(unit.competitorFinalRate - unit.streetRate) > 50) {
      const competitorDiff = unit.competitorFinalRate - unit.streetRate;
      const adjustment = Math.round(competitorDiff / unit.streetRate * 50);
      factors.push(`🏢 Competitor rate $${unit.competitorFinalRate?.toLocaleString()}: ${competitorDiff > 0 ? '+' : ''}${adjustment}% market adjustment`);
    }

    return `Modulo Algorithm Calculation:
    
Base Rate: $${unit.streetRate?.toLocaleString()}
${factors.join('\n')}

Final Rate: $${unit.moduloSuggestedRate?.toLocaleString()} (${change > 0 ? '+' : ''}${changePercent}%)

The Modulo algorithm considers occupancy pressure, vacancy duration, unit attributes, and competitor positioning to optimize pricing.`;
  };

  // Helper function to generate AI calculation explanation  
  const getAITooltip = (unit: any) => {
    if (!unit.aiSuggestedRate) {
      return "No AI suggestions available";
    }

    const change = unit.aiSuggestedRate - unit.streetRate;
    const changePercent = Math.round((change / unit.streetRate) * 100);
    
    return `AI Pricing Analysis:

Base Rate: $${unit.streetRate?.toLocaleString()}
AI Suggested: $${unit.aiSuggestedRate?.toLocaleString()} (${change > 0 ? '+' : ''}${changePercent}%)

Analysis Factors:
🧠 Market intelligence and patterns
🏘️ Comparable unit analysis
📊 Historical occupancy trends  
🎯 Competitive positioning
🔮 Predictive modeling

The AI considers complex market dynamics, seasonal patterns, and competitive intelligence to generate data-driven pricing recommendations.`;
  };

  const units = rateCardData?.units || [];
  const summary = rateCardData?.summary || [];
  
  // Filter units by selected service line
  let filteredUnits = selectedServiceLine === "All" 
    ? units 
    : units.filter((unit: any) => {
        // Use the actual serviceLine field from the data
        return unit.serviceLine === selectedServiceLine;
      });
  
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

  // Sort the filtered units based on current sort state
  if (sortColumn) {
    filteredUnits = [...filteredUnits].sort((a: any, b: any) => {
      let aVal, bVal;
      
      switch (sortColumn) {
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
              <div className="flex space-x-4">
                <Button
                  onClick={() => generateModuloMutation.mutate()}
                  disabled={generateModuloMutation.isPending || filteredUnits.length === 0}
                  data-testid="button-generate-modulo"
                >
                  {generateModuloMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Calculator className="h-4 w-4 mr-2" />
                  )}
                  {generateModuloMutation.isPending ? "Generating..." : "Generate Modulo Suggestions"}
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
                  {generateAIMutation.isPending ? "Generating..." : "Generate AI Suggestions"}
                </Button>
              </div>

              {/* Bulk Accept Actions */}
              <div className="flex items-center gap-4 pt-2 border-t">
                <span className="text-sm font-medium text-muted-foreground">Apply to All Units:</span>
                <Button
                  onClick={() => {
                    const unitsWithModulo = filteredUnits.filter((u: any) => (u.ruleAdjustedRate || u.moduloSuggestedRate) && !u.occupiedYN);
                    if (unitsWithModulo.length === 0) {
                      toast({ 
                        title: "No Modulo suggestions", 
                        description: "Generate Modulo suggestions first or all units are occupied",
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
                  Accept All Modulo ({filteredUnits.filter((u: any) => (u.ruleAdjustedRate || u.moduloSuggestedRate) && !u.occupiedYN).length})
                </Button>
                
                <Button
                  onClick={() => {
                    const unitsWithAI = filteredUnits.filter((u: any) => u.aiSuggestedRate && !u.occupiedYN);
                    if (unitsWithAI.length === 0) {
                      toast({ 
                        title: "No AI suggestions", 
                        description: "Generate AI suggestions first or all units are occupied",
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
                  Accept All AI ({filteredUnits.filter((u: any) => u.aiSuggestedRate && !u.occupiedYN).length})
                </Button>
              </div>
            </div>
            
            {/* Progress bars for loading states - show both when running concurrently */}
            <div className="space-y-3">
              {generateModuloMutation.isPending && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-primary animate-pulse" />
                    <div className="text-sm text-muted-foreground">Calculating Modulo pricing recommendations...</div>
                  </div>
                  <Progress value={33} className="h-2" />
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
                  <TableHead>Avg Modulo</TableHead>
                  <TableHead>Avg AI</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((row: any, index: number) => (
                  <TableRow key={`${row.serviceLine}-${index}`}>
                    <TableCell className="font-medium">{row.serviceLine}</TableCell>
                    <TableCell>
                      <Badge variant={row.occupancyCount / row.totalUnits > 0.85 ? "default" : "secondary"}>
                        {formatNumber(row.occupancyCount)}/{formatNumber(row.totalUnits)} <span className="text-base font-bold">({formatPercentage(row.occupancyCount / row.totalUnits)})</span>
                      </Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(Math.round(row.averageStreetRate || 0))}</TableCell>
                    <TableCell>
                      {row.averageModuloRate ? formatCurrency(Math.round(row.averageModuloRate)) : '-'}
                    </TableCell>
                    <TableCell>
                      {row.averageAiRate ? formatCurrency(Math.round(row.averageAiRate)) : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Detailed Unit View */}
      <Card>
        <CardHeader>
          <CardTitle>Unit-Level Detail</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredUnits.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No data available for {selectedMonth}</p>
              <p className="text-sm text-gray-400 mt-2">Upload rent roll data to see unit details</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead 
                      className="cursor-pointer hover:bg-slate-50 select-none"
                      onClick={() => handleSort('unit')}
                      data-testid="sort-unit"
                    >
                      <div className="flex items-center">
                        Unit
                        <SortIcon column="unit" />
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-slate-50 select-none"
                      onClick={() => handleSort('roomType')}
                      data-testid="sort-room-type"
                    >
                      <div className="flex items-center">
                        Room Type
                        <SortIcon column="roomType" />
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-slate-50 select-none"
                      onClick={() => handleSort('serviceLine')}
                      data-testid="sort-service-line"
                    >
                      <div className="flex items-center">
                        Service Line
                        <SortIcon column="serviceLine" />
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-slate-50 select-none"
                      onClick={() => handleSort('status')}
                      data-testid="sort-status"
                    >
                      <div className="flex items-center">
                        Status
                        <SortIcon column="status" />
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-slate-50 select-none"
                      onClick={() => handleSort('streetRate')}
                      data-testid="sort-street-rate"
                    >
                      <div className="flex items-center">
                        Street Rate
                        <SortIcon column="streetRate" />
                      </div>
                    </TableHead>
                    <TableHead>Applied Rules</TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-slate-50 select-none"
                      onClick={() => handleSort('modulo')}
                      data-testid="sort-modulo"
                    >
                      <div className="flex items-center">
                        Modulo
                        <SortIcon column="modulo" />
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-slate-50 select-none"
                      onClick={() => handleSort('ai')}
                      data-testid="sort-ai"
                    >
                      <div className="flex items-center">
                        AI
                        <SortIcon column="ai" />
                      </div>
                    </TableHead>
                    <TableHead 
                      className="cursor-pointer hover:bg-slate-50 select-none"
                      onClick={() => handleSort('competitor')}
                      data-testid="sort-competitor"
                    >
                      <div className="flex items-center">
                        Competitor
                        <SortIcon column="competitor" />
                      </div>
                    </TableHead>
                    <TableHead>Attributes</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUnits.slice(0, 20).map((unit: any) => (
                    <TableRow 
                      key={unit.id}
                      id={`unit-row-${unit.id}`}
                      className={highlightedUnitId === unit.id ? 'bg-[var(--trilogy-teal)]/10 border-[var(--trilogy-teal)]' : ''}
                    >
                      <TableCell className="font-medium">
                        {unit.roomNumber}
                      </TableCell>
                      <TableCell>{unit.roomType}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{unit.serviceLine}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={unit.occupiedYN ? "default" : "secondary"}>
                          {unit.occupiedYN ? "Occupied" : `Vacant ${unit.daysVacant}d`}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatCurrency(Math.round(unit.streetRate || 0))}</TableCell>
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
                        {(unit.ruleAdjustedRate || unit.moduloSuggestedRate) && !unit.occupiedYN ? (
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
                              >
                                <button 
                                  className="cursor-pointer flex items-center space-x-1 text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-300 rounded px-1"
                                  type="button"
                                  data-testid={`tooltip-modulo-${unit.roomNumber}`}
                                >
                                  <span>
                                    {formatCurrency(Math.round(unit.ruleAdjustedRate || unit.moduloSuggestedRate))}
                                    {unit.ruleAdjustedRate && unit.moduloSuggestedRate && (
                                      <span className="text-xs text-gray-500 ml-1">
                                        (was {formatCurrency(Math.round(unit.moduloSuggestedRate))})
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
                                            <p className="font-semibold text-xs mb-1">Smart Adjustments Applied</p>
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
                                const change = Math.round(unit.moduloSuggestedRate - unit.streetRate);
                                const changePercent = Math.round((change / unit.streetRate) * 100);
                                return (
                                  <span className={`text-xs ${change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {change > 0 ? '+' : ''}{formatCurrency(change)} ({change > 0 ? '+' : ''}{changePercent}%)
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
                        {unit.aiSuggestedRate && !unit.occupiedYN ? (
                          <div className="flex items-center space-x-2">
                            <div className="flex flex-col">
                              <button 
                                className="cursor-help flex items-center space-x-1 text-purple-600 hover:text-purple-800 focus:outline-none focus:ring-2 focus:ring-purple-300 rounded px-1"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAIDialogUnit({
                                    unitId: unit.id,
                                    roomType: unit.roomType,
                                    streetRate: unit.streetRate || 0
                                  });
                                }}
                                data-testid={`tooltip-ai-${unit.roomNumber}`}
                              >
                                <span>{formatCurrency(Math.round(unit.aiSuggestedRate))}</span>
                                <Info className="h-3 w-3" />
                              </button>
                              {(() => {
                                const change = Math.round(unit.aiSuggestedRate - unit.streetRate);
                                const changePercent = Math.round((change / unit.streetRate) * 100);
                                return (
                                  <span className={`text-xs ${change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {change > 0 ? '+' : ''}{formatCurrency(change)} ({change > 0 ? '+' : ''}{changePercent}%)
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
                          >
                            <Button
                              variant="link"
                              className="text-[var(--trilogy-turquoise)] hover:text-[var(--trilogy-turquoise-dark)] p-0 h-auto font-medium"
                              data-testid={`button-competitor-rate-${unit.roomNumber}`}
                            >
                              {formatCurrency(Math.round(unit.competitorFinalRate))}
                            </Button>
                          </CompetitorAdjustmentDialog>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingUnit === unit.id ? (
                          <div className="space-y-2">
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-medium">Location:</span>
                              <Select
                                value={unit.locationRating || 'B'}
                                onValueChange={(value) => {
                                  // Update local state for immediate feedback
                                  unit.locationRating = value;
                                }}
                                data-testid={`select-location-rating-${unit.roomNumber}`}
                              >
                                <SelectTrigger className="w-16 h-7">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="A">A</SelectItem>
                                  <SelectItem value="B">B</SelectItem>
                                  <SelectItem value="C">C</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-medium">Size:</span>
                              <Select
                                value={unit.sizeRating || 'B'}
                                onValueChange={(value) => {
                                  unit.sizeRating = value;
                                }}
                                data-testid={`select-size-rating-${unit.roomNumber}`}
                              >
                                <SelectTrigger className="w-16 h-7">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="A">A</SelectItem>
                                  <SelectItem value="B">B</SelectItem>
                                  <SelectItem value="C">C</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-medium">View:</span>
                              <Select
                                value={unit.viewRating || 'B'}
                                onValueChange={(value) => {
                                  unit.viewRating = value;
                                }}
                                data-testid={`select-view-rating-${unit.roomNumber}`}
                              >
                                <SelectTrigger className="w-16 h-7">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="A">A</SelectItem>
                                  <SelectItem value="B">B</SelectItem>
                                  <SelectItem value="C">C</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-medium">Reno:</span>
                              <Select
                                value={unit.renovationRating || 'B'}
                                onValueChange={(value) => {
                                  unit.renovationRating = value;
                                }}
                                data-testid={`select-renovation-rating-${unit.roomNumber}`}
                              >
                                <SelectTrigger className="w-16 h-7">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="A">A</SelectItem>
                                  <SelectItem value="B">B</SelectItem>
                                  <SelectItem value="C">C</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-medium">Amenity:</span>
                              <Select
                                value={unit.amenityRating || 'B'}
                                onValueChange={(value) => {
                                  unit.amenityRating = value;
                                }}
                                data-testid={`select-amenity-rating-${unit.roomNumber}`}
                              >
                                <SelectTrigger className="w-16 h-7">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="A">A</SelectItem>
                                  <SelectItem value="B">B</SelectItem>
                                  <SelectItem value="C">C</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <span className="text-xs text-gray-500">Loc:</span>
                              <Badge variant={unit.locationRating === 'A' ? 'default' : unit.locationRating === 'B' ? 'secondary' : 'outline'} className="text-xs">
                                {unit.locationRating || 'B'}
                              </Badge>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="text-xs text-gray-500">Size:</span>
                              <Badge variant={unit.sizeRating === 'A' ? 'default' : unit.sizeRating === 'B' ? 'secondary' : 'outline'} className="text-xs">
                                {unit.sizeRating || 'B'}
                              </Badge>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="text-xs text-gray-500">View:</span>
                              <Badge variant={unit.viewRating === 'A' ? 'default' : unit.viewRating === 'B' ? 'secondary' : 'outline'} className="text-xs">
                                {unit.viewRating || 'B'}
                              </Badge>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="text-xs text-gray-500">Reno:</span>
                              <Badge variant={unit.renovationRating === 'A' ? 'default' : unit.renovationRating === 'B' ? 'secondary' : 'outline'} className="text-xs">
                                {unit.renovationRating || 'B'}
                              </Badge>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="text-xs text-gray-500">Amenity:</span>
                              <Badge variant={unit.amenityRating === 'A' ? 'default' : unit.amenityRating === 'B' ? 'secondary' : 'outline'} className="text-xs">
                                {unit.amenityRating || 'B'}
                              </Badge>
                            </div>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-2">
                          {editingUnit === unit.id ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => {
                                  updateAttributesMutation.mutate({
                                    unitId: unit.id,
                                    attributes: {
                                      locationRating: unit.locationRating || 'B',
                                      sizeRating: unit.sizeRating || 'B',
                                      viewRating: unit.viewRating || 'B',
                                      renovationRating: unit.renovationRating || 'B',
                                      amenityRating: unit.amenityRating || 'B'
                                    }
                                  });
                                }}
                                disabled={updateAttributesMutation.isPending}
                                data-testid={`button-save-attributes-${unit.roomNumber}`}
                              >
                                <CheckCircle className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingUnit(null)}
                                data-testid={`button-cancel-attributes-${unit.roomNumber}`}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingUnit(unit.id)}
                                data-testid={`button-edit-attributes-${unit.roomNumber}`}
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              
              {filteredUnits.length > 20 && (
                <div className="mt-4 text-center">
                  <p className="text-sm text-gray-500">
                    Showing first 20 of {filteredUnits.length} units
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* AI Calculation Dialog */}
      {aiDialogUnit && (
        <AICalculationDialog
          open={!!aiDialogUnit}
          onOpenChange={(open) => !open && setAIDialogUnit(null)}
          unitId={aiDialogUnit.unitId}
          roomType={aiDialogUnit.roomType}
          streetRate={aiDialogUnit.streetRate}
        />
      )}
    </div>
    </TooltipProvider>
  );
}