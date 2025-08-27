import { useState } from "react";
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
import { Brain, Calculator, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function RateCardTable() {
  const [selectedMonth, setSelectedMonth] = useState("2025-08");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: rateCardData, isLoading } = useQuery({
    queryKey: ['/api/rate-card', selectedMonth],
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

  return (
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
              disabled={generateModuloMutation.isPending || units.length === 0}
              data-testid="button-generate-modulo"
            >
              <Calculator className="h-4 w-4 mr-2" />
              Generate Modulo Suggestions
            </Button>
            
            <Button
              onClick={() => generateAIMutation.mutate()}
              disabled={generateAIMutation.isPending || units.length === 0}
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
          {units.length === 0 ? (
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
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {units.slice(0, 20).map((unit: any) => (
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
                            <span>${unit.moduloSuggestedRate.toLocaleString()}</span>
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
                            <span>${unit.aiSuggestedRate.toLocaleString()}</span>
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
                        <div className="flex items-center space-x-1">
                          {unit.renovated && (
                            <Badge variant="outline" className="text-xs">Renovated</Badge>
                          )}
                          {unit.view && (
                            <Badge variant="outline" className="text-xs">{unit.view}</Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              
              {units.length > 20 && (
                <div className="mt-4 text-center">
                  <p className="text-sm text-gray-500">
                    Showing first 20 of {units.length} units
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}