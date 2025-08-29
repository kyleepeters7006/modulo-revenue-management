import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Brain, Calculator, CheckCircle, AlertCircle, Edit, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface RateCardTableProps {
  selectedServiceLine?: string;
}

export default function RateCardTable({ selectedServiceLine: propServiceLine }: RateCardTableProps) {
  const [selectedMonth, setSelectedMonth] = useState("2025-08");
  const [editingUnit, setEditingUnit] = useState<string | null>(null);
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);
  const [localServiceLine, setLocalServiceLine] = useState<string>("All");
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
    queryKey: ['/api/rate-card', selectedMonth],
    queryFn: async () => {
      const response = await fetch(`/api/rate-card?month=${selectedMonth}`);
      return response.json();
    },
    enabled: !!selectedMonth
  });

  const generateModuloMutation = useMutation({
    mutationFn: () => apiRequest('/api/pricing/generate-modulo', 'POST', { month: selectedMonth }),
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
    mutationFn: () => apiRequest('/api/pricing/generate-ai', 'POST', { month: selectedMonth }),
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
    const changePercent = ((change / unit.streetRate) * 100).toFixed(1);
    
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
      factors.push(`⏰ ${unit.daysVacant} days vacant: -${penalty.toFixed(1)}% urgency discount`);
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
      const adjustment = (competitorDiff / unit.streetRate * 50).toFixed(1);
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
    const changePercent = ((change / unit.streetRate) * 100).toFixed(1);
    
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
                  {Array.from({ length: 12 }, (_, i) => {
                    const date = new Date();
                    date.setMonth(date.getMonth() - i);
                    const monthStr = date.toISOString().substring(0, 7);
                    const displayStr = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                    return (
                      <SelectItem key={monthStr} value={monthStr}>
                        {displayStr}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex space-x-4">
            <Button
              onClick={() => generateModuloMutation.mutate()}
              disabled={generateModuloMutation.isPending || filteredUnits.length === 0}
              data-testid="button-generate-modulo"
            >
              <Calculator className="h-4 w-4 mr-2" />
              Generate Modulo Suggestions
            </Button>
            
            <Button
              onClick={() => generateAIMutation.mutate()}
              disabled={generateAIMutation.isPending || filteredUnits.length === 0}
              variant="outline"
              data-testid="button-generate-ai"
            >
              <Brain className="h-4 w-4 mr-2" />
              Generate AI Suggestions
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary by Room Type */}
      {summary.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Summary by Room Type</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Room Type</TableHead>
                  <TableHead>Occupancy</TableHead>
                  <TableHead>Avg Street Rate</TableHead>
                  <TableHead>Avg Modulo</TableHead>
                  <TableHead>Avg AI</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((row: any) => (
                  <TableRow key={row.roomType}>
                    <TableCell className="font-medium">{row.roomType}</TableCell>
                    <TableCell>
                      <Badge variant={row.occupancyCount / row.totalUnits > 0.85 ? "default" : "secondary"}>
                        {row.occupancyCount}/{row.totalUnits} ({Math.round(row.occupancyCount / row.totalUnits * 100)}%)
                      </Badge>
                    </TableCell>
                    <TableCell>${row.averageStreetRate?.toLocaleString() || 0}</TableCell>
                    <TableCell>
                      {row.averageModuloRate ? `$${row.averageModuloRate.toLocaleString()}` : '-'}
                    </TableCell>
                    <TableCell>
                      {row.averageAiRate ? `$${row.averageAiRate.toLocaleString()}` : '-'}
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
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Street Rate</TableHead>
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
                        <Badge variant={unit.occupiedYN ? "default" : "secondary"}>
                          {unit.occupiedYN ? "Occupied" : `Vacant ${unit.daysVacant}d`}
                        </Badge>
                      </TableCell>
                      <TableCell>${unit.streetRate?.toLocaleString() || 0}</TableCell>
                      <TableCell>
                        {unit.moduloSuggestedRate ? (
                          <div className="flex items-center space-x-2">
                            <div className="relative">
                              <button 
                                className="cursor-help flex items-center space-x-1 text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-300 rounded px-1"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const tooltipId = `modulo-${unit.id}`;
                                  setOpenTooltip(openTooltip === tooltipId ? null : tooltipId);
                                }}
                                data-testid={`tooltip-modulo-${unit.roomNumber}`}
                              >
                                <span>${unit.moduloSuggestedRate.toLocaleString()}</span>
                                <Info className="h-3 w-3" />
                              </button>
                              {openTooltip === `modulo-${unit.id}` && (
                                <div className="absolute z-50 left-0 top-full mt-1 bg-black text-white text-xs p-3 rounded shadow-lg max-w-xs whitespace-pre-wrap">
                                  {getModuloTooltip(unit)}
                                  <button
                                    className="absolute top-1 right-1 text-gray-300 hover:text-white"
                                    onClick={() => setOpenTooltip(null)}
                                  >
                                    ×
                                  </button>
                                </div>
                              )}
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
                            <div className="relative">
                              <button 
                                className="cursor-help flex items-center space-x-1 text-purple-600 hover:text-purple-800 focus:outline-none focus:ring-2 focus:ring-purple-300 rounded px-1"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const tooltipId = `ai-${unit.id}`;
                                  setOpenTooltip(openTooltip === tooltipId ? null : tooltipId);
                                }}
                                data-testid={`tooltip-ai-${unit.roomNumber}`}
                              >
                                <span>${unit.aiSuggestedRate.toLocaleString()}</span>
                                <Info className="h-3 w-3" />
                              </button>
                              {openTooltip === `ai-${unit.id}` && (
                                <div className="absolute z-50 left-0 top-full mt-1 bg-black text-white text-xs p-3 rounded shadow-lg max-w-xs whitespace-pre-wrap">
                                  {getAITooltip(unit)}
                                  <button
                                    className="absolute top-1 right-1 text-gray-300 hover:text-white"
                                    onClick={() => setOpenTooltip(null)}
                                  >
                                    ×
                                  </button>
                                </div>
                              )}
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
                        ${unit.competitorRate?.toLocaleString() || 0}
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
    </div>
    </TooltipProvider>
  );
}