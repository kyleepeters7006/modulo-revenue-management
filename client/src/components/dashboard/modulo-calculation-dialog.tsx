import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Calculator, TrendingUp, TrendingDown, Shield, AlertCircle, Info } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface ModuloCalculationDialogProps {
  roomType: string;
  currentRate: number;
  unitId: string;
  children: React.ReactNode;
  calculationDetails?: string; // JSON string with calculation details
}

export default function ModuloCalculationDialog({ 
  roomType, 
  currentRate, 
  unitId,
  children,
  calculationDetails
}: ModuloCalculationDialogProps) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<any>(null);

  // Parse calculation details when dialog opens
  useEffect(() => {
    if (open && calculationDetails) {
      try {
        const parsed = typeof calculationDetails === 'string' 
          ? JSON.parse(calculationDetails) 
          : calculationDetails;
        setDetails(parsed);
      } catch (e) {
        console.error('Failed to parse calculation details:', e);
      }
    }
  }, [open, calculationDetails]);

  // Fallback to API if no details provided
  const { data: apiDetails } = useQuery({
    queryKey: [`/api/units/${unitId}/modulo-calculation`],
    enabled: open && !calculationDetails && !!unitId,
  });

  // Use provided details or API details
  const calcDetails = details || apiDetails;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(2)}%`;
  };

  const getAdjustmentColor = (value: number) => {
    if (value > 0) return "text-green-600";
    if (value < 0) return "text-red-600";
    return "text-gray-600";
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-[var(--trilogy-teal)]" />
            Modulo Pricing Calculation
            <Badge variant="secondary">{roomType}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {calcDetails ? (
            <>
              {/* Summary Card */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Rate Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Base Rate</p>
                      <p className="text-lg font-bold">{formatCurrency(calcDetails.baseRate || currentRate)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Adjustment</p>
                      <p className="text-lg font-bold flex items-center gap-1">
                        {calcDetails.totalAdjustment > 0 ? (
                          <>
                            <TrendingUp className="h-4 w-4 text-green-600" />
                            <span className="text-green-600">+{formatPercent(calcDetails.totalAdjustment)}</span>
                          </>
                        ) : (
                          <>
                            <TrendingDown className="h-4 w-4 text-red-600" />
                            <span className="text-red-600">{formatPercent(calcDetails.totalAdjustment)}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Final Rate</p>
                      <p className="text-lg font-bold text-primary">{formatCurrency(calcDetails.finalRate || currentRate)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Algorithm Weights */}
              {calcDetails.weights && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Algorithm Weights Configuration</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>Occupancy</span>
                          <span className="font-medium">{calcDetails.weights.occupancyPressure}%</span>
                        </div>
                        <Progress value={calcDetails.weights.occupancyPressure} className="h-2" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>Vacancy Decay</span>
                          <span className="font-medium">{calcDetails.weights.daysVacantDecay}%</span>
                        </div>
                        <Progress value={calcDetails.weights.daysVacantDecay} className="h-2" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>Attributes</span>
                          <span className="font-medium">{calcDetails.weights.roomAttributes}%</span>
                        </div>
                        <Progress value={calcDetails.weights.roomAttributes} className="h-2" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>Seasonality</span>
                          <span className="font-medium">{calcDetails.weights.seasonality}%</span>
                        </div>
                        <Progress value={calcDetails.weights.seasonality} className="h-2" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>Competitors</span>
                          <span className="font-medium">{calcDetails.weights.competitorRates}%</span>
                        </div>
                        <Progress value={calcDetails.weights.competitorRates} className="h-2" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span>Stock Market</span>
                          <span className="font-medium">{calcDetails.weights.stockMarket}%</span>
                        </div>
                        <Progress value={calcDetails.weights.stockMarket} className="h-2" />
                      </div>
                    </div>
                    <div className="mt-3 text-xs text-muted-foreground text-center">
                      Total Weight: 100%
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Detailed Calculation Breakdown */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Detailed Calculation Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {calcDetails.adjustments && calcDetails.adjustments.length > 0 ? (
                      calcDetails.adjustments.map((adj: any, index: number) => (
                        <div key={index}>
                          <div className="flex items-start justify-between mb-2">
                            <div className="space-y-1 flex-1">
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-medium">{adj.factor}</h4>
                                <Badge variant="outline" className="text-xs">
                                  Weight: {adj.weight}%
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">{adj.description}</p>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-bold ${getAdjustmentColor(adj.weightedAdjustment)}`}>
                                {adj.weightedAdjustment > 0 ? '+' : ''}{formatPercent(adj.weightedAdjustment)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatCurrency(Math.abs(adj.impact))} impact
                              </p>
                            </div>
                          </div>
                          
                          <div className="bg-muted/50 rounded-md px-3 py-2 mb-2">
                            <p className="text-xs font-mono">{adj.calculation}</p>
                          </div>
                          
                          <div className="flex items-center gap-4 text-xs">
                            <div className="flex items-center gap-1">
                              <span className="text-muted-foreground">Raw adjustment:</span>
                              <span className="font-medium">
                                {adj.adjustment > 0 ? '+' : ''}{formatPercent(adj.adjustment)}
                              </span>
                            </div>
                            <span className="text-muted-foreground">×</span>
                            <div className="flex items-center gap-1">
                              <span className="text-muted-foreground">Weight:</span>
                              <span className="font-medium">{adj.weight}%</span>
                            </div>
                            <span className="text-muted-foreground">=</span>
                            <div className="flex items-center gap-1">
                              <span className="text-muted-foreground">Weighted:</span>
                              <span className={`font-medium ${getAdjustmentColor(adj.weightedAdjustment)}`}>
                                {adj.weightedAdjustment > 0 ? '+' : ''}{formatPercent(adj.weightedAdjustment)}
                              </span>
                            </div>
                          </div>
                          
                          {index < calcDetails.adjustments.length - 1 && <Separator className="mt-3" />}
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Info className="h-8 w-8 mx-auto mb-2" />
                        <p className="text-sm">No detailed calculation available</p>
                        <p className="text-xs mt-1">Generate Modulo suggestions to see detailed calculations</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Final Calculation Summary */}
              {calcDetails.adjustments && calcDetails.adjustments.length > 0 && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="pt-6">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Base Rate</span>
                        <span className="font-medium">{formatCurrency(calcDetails.baseRate)}</span>
                      </div>
                      {calcDetails.adjustments.map((adj: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{adj.factor}</span>
                          <span className={getAdjustmentColor(adj.weightedAdjustment)}>
                            {adj.weightedAdjustment > 0 ? '+' : ''}{formatPercent(adj.weightedAdjustment)}
                          </span>
                        </div>
                      ))}
                      <Separator />
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Total Adjustment</span>
                        <span className={`font-medium ${getAdjustmentColor(calcDetails.totalAdjustment)}`}>
                          {calcDetails.totalAdjustment > 0 ? '+' : ''}{formatPercent(calcDetails.totalAdjustment)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between font-bold">
                        <span>Recommended Rate</span>
                        <span className="text-lg text-primary">{formatCurrency(calcDetails.finalRate)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Formula Display */}
              <Card className="bg-gray-50 dark:bg-gray-800">
                <CardContent className="pt-4">
                  <h3 className="text-xs font-semibold text-muted-foreground mb-2">Formula:</h3>
                  <div className="text-xs font-mono space-y-1">
                    <div>Base Rate × (1 + Total Weighted Adjustments) = Recommended Rate</div>
                    <div className="text-primary">
                      {formatCurrency(calcDetails.baseRate || currentRate)} × (1 + {formatPercent(calcDetails.totalAdjustment || 0)}) = {formatCurrency(calcDetails.finalRate || currentRate)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="flex items-center justify-center p-8">
              <div className="text-center text-muted-foreground">
                <Info className="h-8 w-8 mx-auto mb-2" />
                <p className="text-sm">No calculation details available</p>
                <p className="text-xs mt-1">Generate Modulo suggestions to see detailed calculations</p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}