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
import { Brain, Calculator, CheckCircle, AlertCircle, Edit, Info, Loader2, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import ModuloCalculationDialog from "./modulo-calculation-dialog";
import AICalculationDialog from "./ai-calculation-dialog";

interface RateCardTableProps {
  selectedServiceLine?: string;
  selectedRegions?: string[];
  selectedDivisions?: string[];
  selectedLocations?: string[];
}

export default function RateCardTable({ 
  selectedServiceLine: propServiceLine,
  selectedRegions,
  selectedDivisions,
  selectedLocations
}: RateCardTableProps) {
  const [selectedMonth, setSelectedMonth] = useState("2025-10");
  const [editingUnit, setEditingUnit] = useState<string | null>(null);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);
  const [localServiceLine, setLocalServiceLine] = useState<string>("All");
  const [aiDialogUnit, setAIDialogUnit] = useState<{ unitId: string; roomType: string; streetRate: number } | null>(null);
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

  const { data: rateCardData, isLoading } = useQuery({
    queryKey: ['/api/rate-card', selectedMonth, selectedRegions, selectedDivisions, selectedLocations],
    queryFn: async () => {
      const params = new URLSearchParams({ month: selectedMonth });
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
    enabled: !!selectedMonth
  });

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
      apiRequest('/api/pricing/accept-suggestions', 'POST', { unitIds, suggestionType: type }),
    onSuccess: () => {
      toast({
        title: "Suggestions accepted",
        description: "Street rates have been updated"
      });
      queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
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
    if (unit.competitorRate && Math.abs(unit.competitorRate - unit.streetRate) > 50) {
      const competitorDiff = unit.competitorRate - unit.streetRate;
      const adjustment = Math.round(competitorDiff / unit.streetRate * 50);
      factors.push(`🏢 Competitor rate $${unit.competitorRate?.toLocaleString()}: ${competitorDiff > 0 ? '+' : ''}${adjustment}% market adjustment`);
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

  const units = rateCardData?.units || [];
  const summary = rateCardData?.summary || [];
  
  // Filter units by selected service line
  const filteredUnits = selectedServiceLine === "All" 
    ? units 
    : units.filter((unit: any) => {
        // Use the actual serviceLine field from the data
        return unit.serviceLine === selectedServiceLine;
      });

  return (
    <TooltipProvider>
      <div className="space-y-6">
      {/* Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Rate Card & Pricing</span>
            <div className="flex items-center space-x-4">
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { month: '2024-10', display: 'October 2024' },
                    { month: '2024-11', display: 'November 2024' },
                    { month: '2024-12', display: 'December 2024' },
                    { month: '2025-01', display: 'January 2025' },
                    { month: '2025-02', display: 'February 2025' },
                    { month: '2025-03', display: 'March 2025' },
                    { month: '2025-04', display: 'April 2025' },
                    { month: '2025-05', display: 'May 2025' },
                    { month: '2025-06', display: 'June 2025' },
                    { month: '2025-07', display: 'July 2025' },
                    { month: '2025-08', display: 'August 2025' },
                    { month: '2025-09', display: 'September 2025' },
                  ].map(({ month, display }) => (
                    <SelectItem key={month} value={month}>
                      {display}
                    </SelectItem>
                  ))}
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
                    const unitsWithModulo = filteredUnits.filter((u: any) => u.moduloSuggestedRate);
                    if (unitsWithModulo.length === 0) {
                      toast({ 
                        title: "No Modulo suggestions", 
                        description: "Generate Modulo suggestions first",
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
                  Accept All Modulo ({filteredUnits.filter((u: any) => u.moduloSuggestedRate).length})
                </Button>
                
                <Button
                  onClick={() => {
                    const unitsWithAI = filteredUnits.filter((u: any) => u.aiSuggestedRate);
                    if (unitsWithAI.length === 0) {
                      toast({ 
                        title: "No AI suggestions", 
                        description: "Generate AI suggestions first",
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
                  Accept All AI ({filteredUnits.filter((u: any) => u.aiSuggestedRate).length})
                </Button>
              </div>
            </div>
            
            {/* Progress bars for loading states */}
            {generateModuloMutation.isPending && (
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Calculating Modulo pricing recommendations...</div>
                <Progress value={33} className="h-2" />
              </div>
            )}
            
            {generateAIMutation.isPending && (
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">AI analyzing market conditions...</div>
                <Progress value={33} className="h-2" />
              </div>
            )}
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
                        {row.occupancyCount.toLocaleString()}/{row.totalUnits.toLocaleString()} ({Math.round(row.occupancyCount / row.totalUnits * 100)}%)
                      </Badge>
                    </TableCell>
                    <TableCell>${Math.round(row.averageStreetRate || 0).toLocaleString()}</TableCell>
                    <TableCell>
                      {row.averageModuloRate ? `$${Math.round(row.averageModuloRate).toLocaleString()}` : '-'}
                    </TableCell>
                    <TableCell>
                      {row.averageAiRate ? `$${Math.round(row.averageAiRate).toLocaleString()}` : '-'}
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
                    <TableHead>Unit</TableHead>
                    <TableHead>Room Type</TableHead>
                    <TableHead>Service Line</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Street Rate</TableHead>
                    <TableHead>Applied Rules</TableHead>
                    <TableHead>Modulo</TableHead>
                    <TableHead>AI</TableHead>
                    <TableHead>Competitor</TableHead>
                    <TableHead>Attributes</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUnits.slice(0, 20).map((unit: any) => (
                    <TableRow key={unit.id}>
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
                      <TableCell>${Math.round(unit.streetRate || 0).toLocaleString()}</TableCell>
                      <TableCell>
                        {(() => {
                          try {
                            // Check if adjustment rules were applied (stored in Modulo calculation details)
                            const details = unit.moduloCalculationDetails ? JSON.parse(unit.moduloCalculationDetails) : null;
                            const appliedRules: string[] = [];
                            
                            // Check for vacant unit increases
                            if (!unit.occupiedYN && details?.adjustments) {
                              const vacantAdj = details.adjustments.find((adj: any) => adj.factor === 'Days Vacant Decay');
                              if (vacantAdj) {
                                appliedRules.push(`Vacant ${vacantAdj.weightedAdjustment > 0 ? '+' : ''}${vacantAdj.weightedAdjustment.toFixed(1)}%`);
                              }
                            }
                            
                            // Check for room type specific adjustments
                            if (details?.adjustments) {
                              const roomAdj = details.adjustments.find((adj: any) => adj.factor === 'Room Attributes');
                              if (roomAdj && roomAdj.weightedAdjustment !== 0) {
                                appliedRules.push(`${unit.roomType} ${roomAdj.weightedAdjustment > 0 ? '+' : ''}${roomAdj.weightedAdjustment.toFixed(1)}%`);
                              }
                            }
                            
                            // Check for smart adjustments/guardrails
                            if (details?.guardrailsApplied?.length > 0) {
                              appliedRules.push(`Guardrails (${details.guardrailsApplied.length})`);
                            }
                            
                            return appliedRules.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {appliedRules.map((rule, i) => (
                                  <Badge key={i} variant="secondary" className="text-xs">
                                    {rule}
                                  </Badge>
                                ))}
                              </div>
                            ) : <span className="text-muted-foreground text-xs">None</span>;
                          } catch {
                            return <span className="text-muted-foreground text-xs">-</span>;
                          }
                        })()}
                      </TableCell>
                      <TableCell>
                        {unit.moduloSuggestedRate ? (
                          <div className="flex items-center space-x-2">
                            <ModuloCalculationDialog
                              roomType={unit.roomType}
                              currentRate={unit.streetRate}
                              unitId={unit.id}
                              calculationDetails={unit.moduloCalculationDetails}
                            >
                              <button 
                                className="cursor-pointer flex items-center space-x-1 text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-300 rounded px-1"
                                type="button"
                                data-testid={`tooltip-modulo-${unit.roomNumber}`}
                              >
                                <span>${Math.round(unit.moduloSuggestedRate).toLocaleString()}</span>
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
                              <span>${Math.round(unit.aiSuggestedRate).toLocaleString()}</span>
                              <Info className="h-3 w-3" />
                            </button>
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
                        ${Math.round(unit.competitorRate || 0).toLocaleString()}
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