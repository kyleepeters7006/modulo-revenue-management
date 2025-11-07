import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Calculator, TrendingUp, TrendingDown, Shield } from "lucide-react";

interface AICalculationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unitId: string;
  roomType: string;
  streetRate: number;
}

export default function AICalculationDialog({
  open,
  onOpenChange,
  unitId,
  roomType,
  streetRate = 0,
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
    return `${(value * 100).toFixed(1)}%`;
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Calculator className="w-5 h-5 text-purple-600" />
            <span>AI Rate Calculation</span>
            <Badge variant="secondary" className="ml-2">{roomType}</Badge>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center p-8">
            <div className="text-sm text-gray-500">Loading calculation details...</div>
          </div>
        ) : calculation && (
          <div className="space-y-6" data-testid="ai-calculation-details">
            {/* Final Result */}
            <div className="bg-purple-50 dark:bg-purple-950/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
              <div className="flex items-center justify-between">
                <span className="text-lg font-medium text-gray-700 dark:text-gray-300">AI Suggested Rate:</span>
                <span className="text-2xl font-bold text-purple-600" data-testid="final-ai-rate">
                  {formatCurrency(calculation.aiSuggestedRate || 0)}
                </span>
              </div>
              <div className="text-sm text-gray-500 mt-1">
                Street Rate: {formatCurrency(baseRate)}
              </div>
            </div>

            {/* Calculation Breakdown */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Calculation Breakdown</h3>
              
              <div className="space-y-4">
                {calculation.calculation?.adjustments && calculation.calculation.adjustments.length > 0 ? (
                  <>
                    {calculation.calculation.adjustments.map((adj: any, index: number) => (
                      <div key={index} className="space-y-2">
                        <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                          <div className="flex items-center space-x-3">
                            <div className={`p-1 rounded ${getAdjustmentColor(adj.weightedAdjustment)}`}>
                              {getAdjustmentIcon(adj.weightedAdjustment)}
                            </div>
                            <div>
                              <div className="font-medium">{adj.factor}</div>
                              <div className="text-xs text-gray-500">Weight: {adj.weight}%</div>
                            </div>
                          </div>
                          <div className={`text-right ${getAdjustmentColor(adj.weightedAdjustment)}`}>
                            <div className="font-semibold">{formatPercent(adj.weightedAdjustment)}</div>
                            <div className="text-xs">
                              {formatCurrency(Math.abs(adj.impact))} impact
                            </div>
                          </div>
                        </div>
                        
                        {/* Formula Display */}
                        <div className="bg-purple-50/50 dark:bg-purple-950/20 rounded-md px-3 py-2">
                          <p className="text-xs font-mono">{adj.formula || adj.calculation}</p>
                        </div>
                        
                        {/* Sentence Explanation */}
                        <div className="border-l-2 border-purple-500/20 pl-3">
                          <p className="text-xs text-gray-600 dark:text-gray-400">{adj.description}</p>
                        </div>
                      </div>
                    ))}
                  </>
                ) : calculation.calculation && (
                  <>
                    {/* Fallback to old format */}
                    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg" data-testid="ai-adjustment-occupancy">
                      <div className="flex items-center space-x-3">
                        <div className={`p-1 rounded ${getAdjustmentColor(calculation.calculation.occupancyAdjustment)}`}>
                          {getAdjustmentIcon(calculation.calculation.occupancyAdjustment)}
                        </div>
                        <div>
                          <div className="font-medium">Occupancy Pressure</div>
                          <div className="text-xs text-gray-500">Target occupancy adjustments</div>
                        </div>
                      </div>
                      <div className={`text-right ${getAdjustmentColor(calculation.calculation.occupancyAdjustment)}`}>
                        <div className="font-semibold">{formatPercent(calculation.calculation.occupancyAdjustment)}</div>
                        <div className="text-xs">
                          {formatCurrency(baseRate * calculation.calculation.occupancyAdjustment)}
                        </div>
                      </div>
                    </div>

                    {/* Vacancy Adjustment */}
                    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg" data-testid="ai-adjustment-vacancy">
                      <div className="flex items-center space-x-3">
                        <div className={`p-1 rounded ${getAdjustmentColor(calculation.calculation.vacancyAdjustment)}`}>
                          {getAdjustmentIcon(calculation.calculation.vacancyAdjustment)}
                        </div>
                        <div>
                          <div className="font-medium">Days Vacant Decay</div>
                          <div className="text-xs text-gray-500">Longer vacancy = lower rate</div>
                        </div>
                      </div>
                      <div className={`text-right ${getAdjustmentColor(calculation.calculation.vacancyAdjustment)}`}>
                        <div className="font-semibold">{formatPercent(calculation.calculation.vacancyAdjustment)}</div>
                        <div className="text-xs">
                          {formatCurrency(baseRate * calculation.calculation.vacancyAdjustment)}
                        </div>
                      </div>
                    </div>

                    {/* Attribute Adjustment */}
                    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg" data-testid="ai-adjustment-attributes">
                      <div className="flex items-center space-x-3">
                        <div className={`p-1 rounded ${getAdjustmentColor(calculation.calculation.attributeAdjustment)}`}>
                          {getAdjustmentIcon(calculation.calculation.attributeAdjustment)}
                        </div>
                        <div>
                          <div className="font-medium">Room Attributes</div>
                          <div className="text-xs text-gray-500">Location, size, view, renovation</div>
                        </div>
                      </div>
                      <div className={`text-right ${getAdjustmentColor(calculation.calculation.attributeAdjustment)}`}>
                        <div className="font-semibold">{formatPercent(calculation.calculation.attributeAdjustment)}</div>
                        <div className="text-xs">
                          {formatCurrency(baseRate * calculation.calculation.attributeAdjustment)}
                        </div>
                      </div>
                    </div>

                    {/* Seasonal Adjustment */}
                    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg" data-testid="ai-adjustment-seasonal">
                      <div className="flex items-center space-x-3">
                        <div className={`p-1 rounded ${getAdjustmentColor(calculation.calculation.seasonalAdjustment)}`}>
                          {getAdjustmentIcon(calculation.calculation.seasonalAdjustment)}
                        </div>
                        <div>
                          <div className="font-medium">Seasonality</div>
                          <div className="text-xs text-gray-500">Peak season adjustments</div>
                        </div>
                      </div>
                      <div className={`text-right ${getAdjustmentColor(calculation.calculation.seasonalAdjustment)}`}>
                        <div className="font-semibold">{formatPercent(calculation.calculation.seasonalAdjustment)}</div>
                        <div className="text-xs">
                          {formatCurrency(baseRate * calculation.calculation.seasonalAdjustment)}
                        </div>
                      </div>
                    </div>

                    {/* Competitor Adjustment */}
                    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg" data-testid="ai-adjustment-competitor">
                      <div className="flex items-center space-x-3">
                        <div className={`p-1 rounded ${getAdjustmentColor(calculation.calculation.competitorAdjustment)}`}>
                          {getAdjustmentIcon(calculation.calculation.competitorAdjustment)}
                        </div>
                        <div>
                          <div className="font-medium">Competitor Rates</div>
                          <div className="text-xs text-gray-500">Market competitive positioning</div>
                        </div>
                      </div>
                      <div className={`text-right ${getAdjustmentColor(calculation.calculation.competitorAdjustment)}`}>
                        <div className="font-semibold">{formatPercent(calculation.calculation.competitorAdjustment)}</div>
                        <div className="text-xs">
                          {formatCurrency(baseRate * calculation.calculation.competitorAdjustment)}
                        </div>
                      </div>
                    </div>

                    {/* Market Adjustment */}
                    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg" data-testid="ai-adjustment-market">
                      <div className="flex items-center space-x-3">
                        <div className={`p-1 rounded ${getAdjustmentColor(calculation.calculation.marketAdjustment)}`}>
                          {getAdjustmentIcon(calculation.calculation.marketAdjustment)}
                        </div>
                        <div>
                          <div className="font-medium">Stock Market</div>
                          <div className="text-xs text-gray-500">Economic market conditions</div>
                        </div>
                      </div>
                      <div className={`text-right ${getAdjustmentColor(calculation.calculation.marketAdjustment)}`}>
                        <div className="font-semibold">{formatPercent(calculation.calculation.marketAdjustment)}</div>
                        <div className="text-xs">
                          {formatCurrency(baseRate * calculation.calculation.marketAdjustment)}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Total Adjustment */}
              {calculation.calculation && (
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800" data-testid="ai-total-adjustment">
                    <div className="font-semibold text-gray-800 dark:text-gray-200">Total Adjustment</div>
                    <div className={`text-right font-bold ${getAdjustmentColor(calculation.calculation.totalAdjustment)}`}>
                      <div>{formatPercent(calculation.calculation.totalAdjustment)}</div>
                      <div className="text-xs">
                        {formatCurrency(baseRate * calculation.calculation.totalAdjustment)}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Guardrails Applied */}
            {calculation.calculation?.guardrailsApplied?.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 flex items-center space-x-2">
                  <Shield className="w-5 h-5 text-amber-500" />
                  <span>Guardrails Applied</span>
                </h3>
                <div className="space-y-2" data-testid="ai-guardrails-list">
                  {calculation.calculation.guardrailsApplied.map((guardrail: string, index: number) => (
                    <div key={index} className="p-2 bg-amber-50 dark:bg-amber-950/20 rounded text-sm text-amber-900 dark:text-amber-100">
                      {guardrail}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Calculation Formula */}
            {calculation.calculation && (
              <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border">
                <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase">Calculation Formula:</h3>
                <div className="space-y-2 text-sm font-mono">
                  <div className="text-gray-700 dark:text-gray-300">
                    Base Rate × (1 + Total Adjustments) = Final Rate
                  </div>
                  <div className="text-purple-700 dark:text-purple-300 font-medium">
                    {formatCurrency(baseRate)} × (1 + {formatPercent(calculation.calculation.totalAdjustment)}) = {formatCurrency(calculation.aiSuggestedRate || 0)}
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    = {formatCurrency(baseRate)} × {(1 + calculation.calculation.totalAdjustment).toFixed(4)} = {formatCurrency(calculation.aiSuggestedRate || 0)}
                  </div>
                </div>
              </div>
            )}

            {/* AI Algorithm Note */}
            <div className="p-4 bg-purple-50 dark:bg-purple-950/20 rounded-lg border border-purple-200 dark:border-purple-800">
              <p className="text-sm text-purple-700 dark:text-purple-300">
                <strong>AI Algorithm Note:</strong> The AI uses the same weight configuration as Modulo but applies slightly different adjustment curves and factors to provide alternative pricing perspectives. The AI tends to be more aggressive with competitor positioning and vacancy adjustments.
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}