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
import { Calculator, TrendingUp, TrendingDown, Shield, Info, ChevronRight, Sparkles, Target, Zap, ArrowRight } from "lucide-react";

interface AICalculationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unitId: string;
  roomType: string;
  streetRate: number;
  aiSuggestedRate?: number;
  serviceLine?: string | null;
}

export default function AICalculationDialog({
  open,
  onOpenChange,
  unitId,
  roomType,
  streetRate = 0,
  aiSuggestedRate: propAiRate,
  serviceLine,
}: AICalculationDialogProps) {
  const [loading, setLoading] = useState(true);
  const [calculation, setCalculation] = useState<any>(null);

  useEffect(() => {
    if (open && unitId) {
      setLoading(true);
      setCalculation(null);
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

  // Fallback: show a minimal summary using prop values if API data is unavailable
  if (!calculation && !loading) {
    const fallbackRate = propAiRate || streetRate;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] max-w-2xl bg-white dark:bg-gray-900">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-600" />
              AI Pricing Calculation
              <Badge variant="secondary">{roomType}</Badge>
              {serviceLine && <Badge variant="outline">{serviceLine}</Badge>}
            </DialogTitle>
          </DialogHeader>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Rate Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Street Rate</p>
                  <p className="text-lg font-bold">{formatCurrency(streetRate)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">AI Suggested Rate</p>
                  <p className="text-lg font-bold text-blue-600">{formatCurrency(fallbackRate)}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                Detailed breakdown will appear the next time you open this dialog.
              </p>
            </CardContent>
          </Card>
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

            {/* ── STEP 0: Rate Summary (TL;DR at top) ─────────────────────── */}
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

            {/* ── STEP 1: Unit Information (inputs / context) ───────────────── */}
            {calcDetails.unitData && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Info className="h-4 w-4 text-blue-500" />
                    Step 1 — Unit Information
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

            {/* ── STEP 2: Algorithm Weights (Pass 1 configuration) ─────────── */}
            {calcDetails.weights && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-blue-500" />
                    Step 2 — Algorithm Weights
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

            {/* ── STEP 3: Pass 1 — Weighted Signal Calculation ─────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Step 3 — Weighted Signal Calculation (Pass 1)</CardTitle>
              </CardHeader>
              <CardContent>
                {calcDetails.breakdownIsApproximate && (
                  <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-950/30 rounded text-xs text-blue-700 dark:text-blue-300 flex items-start gap-1.5">
                    <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                    <span>Factor breakdown is <strong>illustrative</strong> — individual rows reflect algorithm defaults. The Pass 1 Total matches the actual stored rate.</span>
                  </div>
                )}
                <div className="space-y-4">
                  {calcDetails.adjustments && calcDetails.adjustments.length > 0 ? (
                    <>
                      {calcDetails.adjustments
                        .filter((adj: any) => adj.weight !== 0)
                        .map((adj: any, index: number, allAdjustments: any[]) => {
                        const isStrategicOverride = false;
                        return (
                        <div key={index}>
                          <div className="flex items-start justify-between mb-2">
                            <div className="space-y-1 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-sm font-medium">{adj.factor}</h4>
                                {isStrategicOverride ? (
                                  <Badge variant="outline" className="text-xs border-orange-300 text-orange-700 dark:text-orange-300">
                                    Strategic Override
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs">
                                    Weight: {adj.weight}%
                                  </Badge>
                                )}
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

                          <div className="bg-blue-50/50 dark:bg-blue-950/20 rounded-md px-3 py-2 mb-2">
                            <p className="text-xs font-mono">{adj.formula || adj.calculation}</p>
                          </div>

                          <div className="border-l-2 border-blue-500/20 pl-3 mb-2">
                            <p className="text-xs text-muted-foreground">{adj.description}</p>
                          </div>

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
                                  {!isStrategicOverride && (
                                    <>
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
                                    </>
                                  )}
                                  {isStrategicOverride && (
                                    <span className="text-orange-600 dark:text-orange-400 font-medium">applied directly (not weight-scaled)</span>
                                  )}
                                </div>
                                <span className="text-xs text-muted-foreground italic hidden sm:inline">Click for details</span>
                              </div>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="mt-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded border border-blue-200 dark:border-blue-800 space-y-2">
                                <p className="text-xs font-semibold text-blue-900 dark:text-blue-100">Signal Calculation Breakdown</p>
                                <div className="flex items-center justify-between">
                                  <span className="text-xs text-muted-foreground">Normalized Signal:</span>
                                  <span className="text-xs font-mono font-medium">
                                    {adj.signal !== undefined ? adj.signal.toFixed(3) : 'N/A'}
                                  </span>
                                </div>
                                <div className="bg-white dark:bg-gray-900 rounded p-2 space-y-1">
                                  <p className="text-xs font-mono">
                                    Signal ({adj.signal !== undefined ? adj.signal.toFixed(3) : 'N/A'}) → Adjustment ({adj.adjustment > 0 ? '+' : ''}{formatPercent(adj.adjustment)})
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {adj.signalExplanation || 'The normalized signal is converted to a percentage adjustment based on the AI algorithm\'s scaling factors.'}
                                  </p>
                                </div>
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
                      );
                      })}

                      {/* Pass 1 subtotal — weighted signals only, before strategic overrides */}
                      <Separator />
                      {(() => {
                        // preOverrideTotalAdj is the pure weighted-signal sum (excludes
                        // RevenueTarget / RoomTypeTrend strategic overrides).
                        // Fall back to summing the displayed (weight>0) adjustments.
                        const pass1Total = calcDetails.preOverrideTotalAdj !== undefined
                          ? calcDetails.preOverrideTotalAdj
                          : (calcDetails.adjustments || [])
                              .filter((a: any) => a.weight !== 0)
                              .reduce((sum: number, a: any) => sum + (a.weightedAdjustment ?? 0), 0);
                        return (
                          <div className="py-2 font-medium">
                            <div className="flex justify-between items-center">
                              <span>Pass 1 Total</span>
                              <span className={getAdjustmentColor(pass1Total)}>
                                {pass1Total > 0 ? '+' : ''}{formatPercent(pass1Total)}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">Weighted signals only — strategic overrides applied in Pass 2</p>
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

            {/* ── STEP 4a: Revenue Target context (Pass 2 inputs) ──────────── */}
            {calcDetails.revenueTarget && (
              <Card className="border-purple-200 dark:border-purple-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Target className="h-4 w-4 text-purple-500" />
                    Step 4 — Revenue Target Context (Pass 2)
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

            {/* ── STEP 4b: Revenue Target Strategy Layer (Pass 2 detail) ─────── */}
            {calcDetails.strategyLayer && (
              <Card className="border-indigo-200 dark:border-indigo-800">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Zap className="h-4 w-4 text-indigo-500" />
                    Step 4b — Revenue Target Strategy Layer
                    <Badge variant="outline" className="text-xs ml-auto">
                      {calcDetails.strategyLayer.unitStrategySegment?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) || 'Neutral'}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Segment reason */}
                  {calcDetails.strategyLayer.segmentReason && (
                    <div className="border-l-2 border-indigo-400 pl-3">
                      <p className="text-xs text-muted-foreground">{calcDetails.strategyLayer.segmentReason}</p>
                    </div>
                  )}

                  {/* Rate progression */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Rate Progression</p>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <div className="bg-gray-100 dark:bg-gray-800 rounded px-2 py-1 text-center min-w-[90px]">
                        <p className="text-xs text-muted-foreground">Base AI</p>
                        <p className="font-medium">{formatCurrency(calcDetails.strategyLayer.existingAiRate || 0)}</p>
                      </div>
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      <div className="bg-indigo-50 dark:bg-indigo-950/30 rounded px-2 py-1 text-center min-w-[90px]">
                        <p className="text-xs text-muted-foreground">Target-Aware</p>
                        <p className="font-medium text-indigo-700 dark:text-indigo-300">
                          {formatCurrency(calcDetails.strategyLayer.targetAwareAiRate || 0)}
                        </p>
                      </div>
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      <div className={`rounded px-2 py-1 text-center min-w-[90px] ${calcDetails.strategyLayer.guardrailApplied ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-green-50 dark:bg-green-950/30'}`}>
                        <p className="text-xs text-muted-foreground">
                          Final {calcDetails.strategyLayer.guardrailApplied ? '(Guardrailed)' : ''}
                        </p>
                        <p className={`font-bold ${calcDetails.strategyLayer.guardrailApplied ? 'text-amber-700 dark:text-amber-300' : 'text-green-700 dark:text-green-300'}`}>
                          {formatCurrency(calcDetails.strategyLayer.finalGuardrailedAiRate || 0)}
                        </p>
                      </div>
                    </div>
                    {calcDetails.strategyLayer.guardrailApplied && calcDetails.strategyLayer.guardrailReason && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                        <Shield className="h-3 w-3 shrink-0" />
                        {calcDetails.strategyLayer.guardrailReason}
                      </p>
                    )}
                  </div>

                  {/* Revenue & sale probability comparison */}
                  {(calcDetails.strategyLayer.expectedRevenueExistingAi || calcDetails.strategyLayer.expectedRevenueTargetAware) && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Expected Revenue (90-day window)</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-gray-50 dark:bg-gray-900/50 rounded p-3">
                          <p className="text-xs text-muted-foreground mb-1">Without target strategy</p>
                          <p className="font-bold text-base">{formatCurrency(calcDetails.strategyLayer.expectedRevenueExistingAi || 0)}</p>
                          {calcDetails.strategyLayer.expectedSaleProbExistingAi !== undefined && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {(calcDetails.strategyLayer.expectedSaleProbExistingAi * 100).toFixed(1)}% sale probability
                            </p>
                          )}
                        </div>
                        <div className="bg-indigo-50 dark:bg-indigo-950/20 rounded p-3">
                          <p className="text-xs text-muted-foreground mb-1">With target strategy</p>
                          <p className="font-bold text-base text-indigo-700 dark:text-indigo-300">{formatCurrency(calcDetails.strategyLayer.expectedRevenueTargetAware || 0)}</p>
                          {calcDetails.strategyLayer.expectedSaleProbTargetAware !== undefined && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {(calcDetails.strategyLayer.expectedSaleProbTargetAware * 100).toFixed(1)}% sale probability
                            </p>
                          )}
                        </div>
                      </div>
                      {calcDetails.strategyLayer.incrementalExpectedRevenue !== undefined && (
                        <div className={`mt-2 text-xs font-medium flex items-center gap-1 ${calcDetails.strategyLayer.incrementalExpectedRevenue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {calcDetails.strategyLayer.incrementalExpectedRevenue >= 0
                            ? <TrendingUp className="h-3 w-3" />
                            : <TrendingDown className="h-3 w-3" />}
                          Incremental expected revenue: {calcDetails.strategyLayer.incrementalExpectedRevenue >= 0 ? '+' : ''}{formatCurrency(calcDetails.strategyLayer.incrementalExpectedRevenue)}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Competitor positioning */}
                  {calcDetails.strategyLayer.competitorAverageRate !== undefined && (
                    <div className="flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-900/50 rounded p-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Competitor Average Rate</p>
                        <p className="font-medium">{formatCurrency(calcDetails.strategyLayer.competitorAverageRate)}</p>
                      </div>
                      {calcDetails.strategyLayer.competitorGapPct !== undefined && (
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Positioning vs market</p>
                          <p className={`font-bold ${calcDetails.strategyLayer.competitorGapPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {calcDetails.strategyLayer.competitorGapPct >= 0 ? '+' : ''}{(calcDetails.strategyLayer.competitorGapPct * 100).toFixed(1)}%
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Signal metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                    {calcDetails.strategyLayer.urgencyScore !== undefined && (
                      <div className="bg-gray-50 dark:bg-gray-900/50 rounded p-2">
                        <p className="text-muted-foreground">Urgency Score</p>
                        <p className="font-semibold mt-0.5">{(calcDetails.strategyLayer.urgencyScore * 100).toFixed(0)}%</p>
                        <Progress value={calcDetails.strategyLayer.urgencyScore * 100} className="h-1 mt-1" />
                      </div>
                    )}
                    {calcDetails.strategyLayer.segmentConfidence !== undefined && (
                      <div className="bg-gray-50 dark:bg-gray-900/50 rounded p-2">
                        <p className="text-muted-foreground">Segment Confidence</p>
                        <p className="font-semibold mt-0.5">{(calcDetails.strategyLayer.segmentConfidence * 100).toFixed(0)}%</p>
                        <Progress value={calcDetails.strategyLayer.segmentConfidence * 100} className="h-1 mt-1" />
                      </div>
                    )}
                    {calcDetails.strategyLayer.avgDaysVacantForUnitType !== undefined && (
                      <div className="bg-gray-50 dark:bg-gray-900/50 rounded p-2">
                        <p className="text-muted-foreground">Avg Days Vacant (type)</p>
                        <p className="font-semibold mt-0.5">{Math.round(calcDetails.strategyLayer.avgDaysVacantForUnitType)} days</p>
                      </div>
                    )}
                  </div>

                  {/* Reason codes */}
                  {calcDetails.strategyLayer.reasonCodes?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Pricing Signals</p>
                      <div className="flex flex-wrap gap-1">
                        {calcDetails.strategyLayer.reasonCodes.map((code: string, i: number) => (
                          <Badge key={i} variant="outline" className="text-xs font-mono">
                            {code.replace(/_/g, ' ')}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {calcDetails.strategyLayer.noImprovementFound && (
                    <div className="text-xs text-muted-foreground italic bg-gray-50 dark:bg-gray-900/50 rounded p-2">
                      No rate improvement found — existing AI rate already optimizes expected revenue for this unit.
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* ── STEP 5: Guardrails (Pass 3 — final rate clamping) ─────────── */}
            {(() => {
              const hasV2Guardrail = calcDetails.guardrailWasApplied === true;
              const hasLegacyGuardrail = Array.isArray(calcDetails.guardrailsApplied) && calcDetails.guardrailsApplied.length > 0;
              if (!hasV2Guardrail && !hasLegacyGuardrail) return null;

              const trigger: string | null = calcDetails.guardrailTrigger ?? null;
              const limitPct: number | null = calcDetails.guardrailLimitPct ?? null;
              const guardrailName = trigger === 'max_increase'
                ? `Maximum Rate Increase Limit${limitPct != null ? ` (${limitPct}%)` : ''}`
                : trigger === 'max_decrease'
                ? `Maximum Rate Decrease Limit${limitPct != null ? ` (${limitPct}%)` : ''}`
                : 'Guardrail Limit';
              const guardrailExplanation = trigger === 'max_increase'
                ? `The algorithm wanted to raise the rate by ${formatPercent(calcDetails.preGuardrailAdjustment ?? 0)}, but the configured maximum increase is ${limitPct != null ? `${limitPct}%` : 'capped'}. The rate was capped at the ceiling.`
                : trigger === 'max_decrease'
                ? `The algorithm wanted to lower the rate by ${formatPercent(Math.abs(calcDetails.preGuardrailAdjustment ?? 0))}, but the configured maximum decrease is ${limitPct != null ? `${limitPct}%` : 'limited'}. The rate was floored at the minimum.`
                : `Algorithm output (${formatPercent(calcDetails.preGuardrailAdjustment ?? 0)}) exceeded the guardrail bounds and was clamped to ${formatPercent(calcDetails.effectiveAdjustment ?? 0)}.`;

              return (
                <Card className="border-amber-200 dark:border-amber-800">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Shield className="h-4 w-4 text-amber-500" />
                      Step 5 — Guardrail Applied
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3" data-testid="ai-guardrails-list">
                      {hasV2Guardrail && (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase">Rule Fired</span>
                            <span className="text-sm font-bold text-amber-900 dark:text-amber-100">{guardrailName}</span>
                          </div>
                          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded text-sm text-amber-900 dark:text-amber-100 flex items-start gap-2">
                            <Shield className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-500" />
                            <span>{guardrailExplanation}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-3 text-xs">
                            <div className="bg-gray-50 dark:bg-gray-900/50 rounded p-2 text-center">
                              <p className="text-muted-foreground mb-1">Algorithm Suggested</p>
                              <p className="font-bold">{formatPercent(calcDetails.preGuardrailAdjustment ?? 0)}</p>
                            </div>
                            <div className="bg-amber-50 dark:bg-amber-950/30 rounded p-2 text-center">
                              <p className="text-muted-foreground mb-1">After Guardrail</p>
                              <p className="font-bold text-amber-700 dark:text-amber-300">{formatPercent(calcDetails.effectiveAdjustment ?? 0)}</p>
                            </div>
                            <div className="bg-gray-50 dark:bg-gray-900/50 rounded p-2 text-center">
                              <p className="text-muted-foreground mb-1">Final Rate</p>
                              <p className="font-bold">{formatCurrency(aiSuggestedRate)}</p>
                            </div>
                          </div>
                          {(calcDetails.guardrailMinAllowed || calcDetails.guardrailMaxAllowed) && (
                            <p className="text-xs text-muted-foreground">
                              Allowed range: {formatCurrency(calcDetails.guardrailMinAllowed)} – {calcDetails.guardrailMaxAllowed ? formatCurrency(calcDetails.guardrailMaxAllowed) : 'no max'}
                            </p>
                          )}
                        </>
                      )}
                      {hasLegacyGuardrail && calcDetails.guardrailsApplied.map((guardrail: string, index: number) => (
                        <div key={index} className="p-2 bg-amber-50 dark:bg-amber-950/20 rounded text-sm text-amber-900 dark:text-amber-100 flex items-start gap-2">
                          <Shield className="h-4 w-4 flex-shrink-0 mt-0.5" />
                          <span>{guardrail}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {/* ── STEP 6: Calculation Formula (final math) ──────────────────── */}
            {/* Calculation Formula */}
            <Card className="bg-gray-50 dark:bg-gray-800">
              <CardContent className="pt-4">
                <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase">Calculation Formula:</h3>
                {(() => {
                  // v2: use explicit guardrail fields; fall back to ratio inference only for
                  // legacy cached data that pre-dates the v2 endpoint format.
                  const hasV2 = calcDetails.guardrailWasApplied !== undefined;
                  const effectiveAdj = hasV2
                    ? calcDetails.effectiveAdjustment
                    : (baseRate > 0 ? (aiSuggestedRate / baseRate) - 1 : 0);
                  const preGuardrailAdj = hasV2
                    ? calcDetails.preGuardrailAdjustment
                    : calcDetails.totalAdjustment;
                  const hasGuardrail = hasV2
                    ? calcDetails.guardrailWasApplied
                    : Math.abs(effectiveAdj - preGuardrailAdj) > 0.001;
                  return (
                    <div className="space-y-2 text-sm font-mono">
                      <div className="text-gray-700 dark:text-gray-300">
                        Base Rate × (1 + Total Adjustments) = Final Rate
                      </div>
                      <div className="text-blue-700 dark:text-blue-300 font-medium">
                        {formatCurrency(baseRate)} × (1 + {effectiveAdj > 0 ? '+' : ''}{formatPercent(effectiveAdj)}) = {formatCurrency(aiSuggestedRate)}
                      </div>
                      <div className="text-xs text-gray-500 mt-2">
                        = {formatCurrency(baseRate)} × {(1 + effectiveAdj).toFixed(4)} = {formatCurrency(aiSuggestedRate)}
                      </div>
                      {hasGuardrail && (
                        <div className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                          <span>⚠️</span>
                          <span>
                            Guardrail applied: Algorithm suggested {preGuardrailAdj > 0 ? '+' : ''}{formatPercent(preGuardrailAdj)},
                            adjusted to {effectiveAdj > 0 ? '+' : ''}{formatPercent(effectiveAdj)}
                            {calcDetails.guardrailMinAllowed || calcDetails.guardrailMaxAllowed
                              ? ` (allowed range: ${formatCurrency(calcDetails.guardrailMinAllowed)} – ${calcDetails.guardrailMaxAllowed ? formatCurrency(calcDetails.guardrailMaxAllowed) : 'no max'})`
                              : ''}
                          </span>
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
                      AI Pricing Algorithm
                    </h4>
                    <p className="text-xs text-blue-800 dark:text-blue-200">
                      The AI uses a two-pass pricing approach. Both passes start from the unit's current street rate as 
                      the base — a rate that already reflects the room's physical attributes (location, size, view, 
                      renovation, amenities) because it is what the operator currently charges for that specific unit. 
                      The first pass adjusts that base using weighted signals — occupancy, vacancy decay, seasonality, 
                      competitors, stock market, and inquiry/tour volume. The second pass (Revenue Target Strategy Layer) 
                      overlays your configured growth targets: it classifies the unit into a strategy segment, projects 
                      expected revenue with and without target-aware pricing, and selects the rate that best closes the 
                      revenue gap while respecting guardrail limits.
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
