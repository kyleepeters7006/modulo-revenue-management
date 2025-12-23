import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Calculator, TrendingUp, TrendingDown, Shield, Info, ChevronRight, Sparkles, Target } from "lucide-react";

interface AICalculationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unitId: string;
  roomType: string;
  streetRate: number;
  serviceLine?: string | null;
}

export default function AICalculationDialog({
  open,
  onOpenChange,
  unitId,
  roomType,
  streetRate = 0,
  serviceLine,
}: AICalculationDialogProps) {
  const [loading, setLoading] = useState(true);
  const [calculation, setCalculation] = useState<any>(null);

  useEffect(() => {
    if (open && unitId) {
      setLoading(true);
      fetch(`/api/ai-calculation/${unitId}`)
        .then(res => res.json())
        .then(data => {
          setCalculation(data);
          setLoading(false);
        })
        .catch(() => {
          setLoading(false);
        });
    }
  }, [open, unitId]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(2)}%`;
  };

  const getAdjustmentColor = (value: number) => {
    if (value > 0) return "text-green-600";
    if (value < 0) return "text-red-600";
    return "text-gray-600";
  };

  const getAdjustmentIcon = (value: number) => {
    if (value > 0) return <TrendingUp className="w-4 h-4" />;
    if (value < 0) return <TrendingDown className="w-4 h-4" />;
    return null;
  };

  if (!calculation && !loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI Calculation Not Available</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-500">
            No AI calculation details found for this unit. Generate AI suggestions first.
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const baseRate = calculation?.streetRate || streetRate || 0;
  const calcDetails = calculation?.calculation;
  const aiSuggestedRate = calculation?.aiSuggestedRate || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900 sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-600" />
            AI Pricing Calculation
            <Badge variant="secondary">{roomType}</Badge>
            {serviceLine && <Badge variant="outline">{serviceLine}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center p-8">
            <div className="text-sm text-gray-500">Loading calculation details...</div>
          </div>
        ) : calculation && calcDetails && (
          <div className="space-y-4 mt-4" data-testid="ai-calculation-details">
            {/* Summary Card - matching Modulo format */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Rate Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Base Rate</p>
                    <p className="text-lg font-bold" data-testid="ai-base-rate">{formatCurrency(baseRate)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Adjustment</p>
                    {(() => {
                      const effectiveAdj = baseRate > 0 ? (aiSuggestedRate / baseRate) - 1 : 0;
                      return (
                        <p className="text-lg font-bold flex items-center gap-1" data-testid="ai-total-adjustment">
                          {effectiveAdj > 0 ? (
                            <>
                              <TrendingUp className="h-4 w-4 text-green-600" />
                              <span className="text-green-600">+{formatPercent(effectiveAdj)}</span>
                            </>
                          ) : (
                            <>
                              <TrendingDown className="h-4 w-4 text-red-600" />
                              <span className="text-red-600">{formatPercent(effectiveAdj)}</span>
                            </>
                          )}
                        </p>
                      );
                    })()}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">AI Calculated</p>
                    <p className="text-lg font-bold text-blue-600" data-testid="ai-calculated-rate">
                      {formatCurrency(calcDetails.finalRate || aiSuggestedRate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Final AI Rate</p>
                    <p className="text-lg font-bold text-primary" data-testid="final-ai-rate">
                      {formatCurrency(aiSuggestedRate)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Algorithm Weights Configuration - matching Modulo format */}
            {calcDetails.weights && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-blue-500" />
                    AI Algorithm Weights Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span>Inquiry & Tour</span>
                        <span className="font-medium">{calcDetails.weights.inquiryTourVolume || 0}%</span>
                      </div>
                      <Progress value={calcDetails.weights.inquiryTourVolume || 0} className="h-2" />
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground text-center">
                    Total Weight: 100%
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Revenue Target Strategy - shows how targets influence AI pricing */}
            {calcDetails.revenueTarget && (
              <Card className="border-purple-200 dark:border-purple-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Target className="h-4 w-4 text-purple-500" />
                    Revenue Target Strategy
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {calcDetails.revenueTarget.status === 'no_target' ? (
                      <div className="text-sm text-muted-foreground text-center py-2">
                        No revenue growth target set for this location/service line
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div className="bg-purple-50 dark:bg-purple-950/20 rounded-md p-3 text-center">
                            <p className="text-xs text-muted-foreground">Target Growth</p>
                            <p className="text-lg font-bold text-purple-600" data-testid="revenue-target-growth">
                              {calcDetails.revenueTarget.targetGrowthPercent?.toFixed(1) || '—'}%
                            </p>
                          </div>
                          <div className="bg-purple-50 dark:bg-purple-950/20 rounded-md p-3 text-center">
                            <p className="text-xs text-muted-foreground">Actual YOY</p>
                            <p className={`text-lg font-bold ${
                              (calcDetails.revenueTarget.actualYOYGrowth || 0) >= 0 
                                ? 'text-green-600' 
                                : 'text-red-600'
                            }`} data-testid="revenue-actual-yoy">
                              {calcDetails.revenueTarget.actualYOYGrowth !== undefined 
                                ? `${calcDetails.revenueTarget.actualYOYGrowth >= 0 ? '+' : ''}${calcDetails.revenueTarget.actualYOYGrowth.toFixed(1)}%`
                                : '—'}
                            </p>
                          </div>
                          <div className="bg-purple-50 dark:bg-purple-950/20 rounded-md p-3 text-center">
                            <p className="text-xs text-muted-foreground">Gap</p>
                            <p className={`text-lg font-bold flex items-center justify-center gap-1 ${
                              (calcDetails.revenueTarget.gap || 0) >= 0 
                                ? 'text-green-600' 
                                : 'text-amber-600'
                            }`} data-testid="revenue-target-gap">
                              {calcDetails.revenueTarget.gap !== undefined 
                                ? `${calcDetails.revenueTarget.gap >= 0 ? '+' : ''}${calcDetails.revenueTarget.gap.toFixed(1)}%`
                                : '—'}
                              {calcDetails.revenueTarget.gap !== undefined && (
                                calcDetails.revenueTarget.gap >= 0 
                                  ? <TrendingUp className="h-4 w-4" />
                                  : <TrendingDown className="h-4 w-4" />
                              )}
                            </p>
                          </div>
                        </div>
                        
                        {/* Status Badge and Explanation */}
                        <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-900/50 rounded-md p-3">
                          <div className="flex items-center gap-2">
                            <Badge 
                              variant={calcDetails.revenueTarget.gap >= 0 ? "default" : "secondary"}
                              className={
                                calcDetails.revenueTarget.status === 'exceeding' 
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                                  : calcDetails.revenueTarget.status === 'on_target'
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100'
                                  : calcDetails.revenueTarget.status === 'slightly_behind'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100'
                                  : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
                              }
                              data-testid="revenue-target-status"
                            >
                              {calcDetails.revenueTarget.status === 'exceeding' && 'Exceeding Target'}
                              {calcDetails.revenueTarget.status === 'on_target' && 'On Target'}
                              {calcDetails.revenueTarget.status === 'slightly_behind' && 'Slightly Behind'}
                              {calcDetails.revenueTarget.status === 'significantly_behind' && 'Significantly Behind'}
                            </Badge>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-muted-foreground">
                              {calcDetails.revenueTarget.gap >= 0 ? 'Premium Allowance' : 'Pricing Pressure'}
                            </p>
                            <p className={`text-sm font-bold ${
                              calcDetails.revenueTarget.gap >= 0
                                ? 'text-blue-600' 
                                : 'text-amber-600'
                            }`}>
                              {calcDetails.revenueTarget.adjustmentApplied !== undefined 
                                ? `+${(calcDetails.revenueTarget.adjustmentApplied * 100).toFixed(2)}%`
                                : '0%'}
                            </p>
                          </div>
                        </div>
                        
                        {/* Strategy Explanation */}
                        <div className="border-l-2 border-purple-500/30 pl-3">
                          <p className="text-xs text-muted-foreground">
                            {calcDetails.revenueTarget.gap >= 0 
                              ? 'Ahead of target — allowing slight premium positioning. Revenue targets only apply upward adjustments to protect and grow revenue.'
                              : calcDetails.revenueTarget.gap >= -5
                              ? 'Slightly behind target — applying moderate upward pricing pressure to close the revenue gap.'
                              : 'Significantly behind target — applying stronger pricing pressure to accelerate revenue growth toward target.'}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* AI Algorithm Calculation - matching Modulo format with collapsible details */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">AI Algorithm Calculation</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {calcDetails.adjustments && calcDetails.adjustments.length > 0 ? (
                    <>
                      {calcDetails.adjustments.map((adj: any, index: number, allAdjustments: any[]) => (
                        <div key={index}>
                          <div className="flex items-start justify-between mb-2">
                            <div className="space-y-1 flex-1">
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-medium">{adj.factor}</h4>
                                <Badge variant="outline" className="text-xs">
                                  Weight: {adj.weight}%
                                </Badge>
                              </div>
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
                          
                          {/* Formula Display */}
                          <div className="bg-blue-50/50 dark:bg-blue-950/20 rounded-md px-3 py-2 mb-2">
                            <p className="text-xs font-mono">{adj.formula || adj.calculation}</p>
                          </div>
                          
                          {/* Sentence Explanation */}
                          <div className="border-l-2 border-blue-500/20 pl-3 mb-2">
                            <p className="text-xs text-muted-foreground">{adj.description}</p>
                          </div>
                          
                          {/* Collapsible Details - matching Modulo format */}
                          <Collapsible>
                            <CollapsibleTrigger className="w-full group">
                              <div className="flex items-center gap-2 text-xs hover:bg-muted/50 rounded p-2 transition-colors">
                                <ChevronRight className="h-3 w-3 group-data-[state=open]:rotate-90 transition-transform" />
                                <div className="flex items-center gap-4 flex-1 flex-wrap">
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
                                <span className="text-xs text-muted-foreground italic hidden sm:inline">Click for details</span>
                              </div>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded border border-blue-200 dark:border-blue-800 space-y-2">
                                <p className="text-xs font-semibold text-blue-900 dark:text-blue-100">Signal Calculation Breakdown</p>
                                
                                {/* Signal Value */}
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-muted-foreground">Normalized Signal:</span>
                                  <span className="text-xs font-mono font-medium">
                                    {adj.signal !== undefined ? adj.signal.toFixed(3) : 'N/A'}
                                  </span>
                                </div>
                                
                                {/* Signal to Adjustment Conversion */}
                                <div className="bg-white dark:bg-gray-900 rounded p-2 space-y-1">
                                  <p className="text-xs font-mono">
                                    Signal ({adj.signal !== undefined ? adj.signal.toFixed(3) : 'N/A'}) → Adjustment ({adj.adjustment > 0 ? '+' : ''}{formatPercent(adj.adjustment)})
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {adj.signalExplanation || 'The normalized signal is converted to a percentage adjustment based on the AI algorithm\'s scaling factors.'}
                                  </p>
                                </div>
                                
                                {/* Raw Data Used */}
                                {adj.rawData && (
                                  <div className="space-y-1">
                                    <p className="text-xs font-semibold text-blue-900 dark:text-blue-100">Raw Data:</p>
                                    <div className="bg-white dark:bg-gray-900 rounded p-2 space-y-1">
                                      {Object.entries(adj.rawData).map(([key, value]: [string, any]) => (
                                        <div key={key} className="flex items-center justify-between text-xs">
                                          <span className="text-muted-foreground">{key}:</span>
                                          <span className="font-mono">{typeof value === 'number' ? value.toFixed(2) : String(value)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                          
                          {index < allAdjustments.length - 1 && <Separator className="mt-3" />}
                        </div>
                      ))}
                      
                      {/* Subtotal */}
                      <Separator />
                      {(() => {
                        const effectiveAdj = baseRate > 0 ? (aiSuggestedRate / baseRate) - 1 : 0;
                        const hasGuardrail = Math.abs(effectiveAdj - calcDetails.totalAdjustment) > 0.001;
                        return (
                          <div className="py-2 font-medium space-y-1">
                            <div className="flex justify-between items-center">
                              <span>AI Algorithm Total</span>
                              <span className={getAdjustmentColor(effectiveAdj)}>
                                {effectiveAdj > 0 ? '+' : ''}{formatPercent(effectiveAdj)}
                              </span>
                            </div>
                            {hasGuardrail && (
                              <div className="text-xs text-amber-600 dark:text-amber-400">
                                (Pre-guardrail: {calcDetails.totalAdjustment > 0 ? '+' : ''}{formatPercent(calcDetails.totalAdjustment)})
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </>
                  ) : (
                    <div className="text-center text-muted-foreground py-4">
                      No detailed adjustment breakdown available
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Guardrails Applied */}
            {calcDetails.guardrailsApplied && calcDetails.guardrailsApplied.length > 0 && (
              <Card className="border-amber-200 dark:border-amber-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Shield className="h-4 w-4 text-amber-500" />
                    Smart Adjustments (Guardrails)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2" data-testid="ai-guardrails-list">
                    {calcDetails.guardrailsApplied.map((guardrail: string, index: number) => (
                      <div key={index} className="p-2 bg-amber-50 dark:bg-amber-950/20 rounded text-sm text-amber-900 dark:text-amber-100 flex items-start gap-2">
                        <Shield className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <span>{guardrail}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Unit Data */}
            {calcDetails.unitData && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Info className="h-4 w-4 text-blue-500" />
                    Unit Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Status</p>
                      <Badge variant={calcDetails.unitData.isOccupied ? "default" : "secondary"}>
                        {calcDetails.unitData.isOccupied ? "Occupied" : "Vacant"}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Days Vacant</p>
                      <p className="font-medium">{calcDetails.unitData.daysVacant || 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Service Line</p>
                      <p className="font-medium">{calcDetails.serviceLine || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Occupancy Rate</p>
                      <p className="font-medium">{calcDetails.actualOccupancyRate ? `${(calcDetails.actualOccupancyRate * 100).toFixed(1)}%` : 'N/A'}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Calculation Formula */}
            <Card className="bg-gray-50 dark:bg-gray-800">
              <CardContent className="pt-4">
                <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase">Calculation Formula:</h3>
                {(() => {
                  const effectiveAdjustment = baseRate > 0 ? (aiSuggestedRate / baseRate) - 1 : 0;
                  const hasGuardrailAdjustment = Math.abs(effectiveAdjustment - calcDetails.totalAdjustment) > 0.001;
                  return (
                    <div className="space-y-2 text-sm font-mono">
                      <div className="text-gray-700 dark:text-gray-300">
                        Base Rate × (1 + Total Adjustments) = Final Rate
                      </div>
                      <div className="text-blue-700 dark:text-blue-300 font-medium">
                        {formatCurrency(baseRate)} × (1 + {formatPercent(effectiveAdjustment)}) = {formatCurrency(aiSuggestedRate)}
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        = {formatCurrency(baseRate)} × {(1 + effectiveAdjustment).toFixed(4)} = {formatCurrency(aiSuggestedRate)}
                      </div>
                      {hasGuardrailAdjustment && (
                        <div className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                          <span>⚠️</span>
                          <span>Guardrail applied: Algorithm suggested {formatPercent(calcDetails.totalAdjustment)}, adjusted to {formatPercent(effectiveAdjustment)}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            {/* AI Algorithm Note */}
            <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
                      AI Algorithm Note
                    </h4>
                    <p className="text-xs text-blue-800 dark:text-blue-200">
                      The AI uses the same weight configuration as Modulo but applies slightly different adjustment curves 
                      and factors to provide alternative pricing perspectives. The AI tends to be more aggressive with 
                      competitor positioning and vacancy adjustments, offering a second opinion on optimal pricing.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
