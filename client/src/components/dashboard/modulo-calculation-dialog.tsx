import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calculator, TrendingUp, TrendingDown, Shield, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface CalculationResult {
  recommendedRate: number;
  calculation: {
    baseRate: number;
    occupancyAdjustment: number;
    vacancyAdjustment: number;
    attributeAdjustment: number;
    seasonalAdjustment: number;
    competitorAdjustment: number;
    marketAdjustment: number;
    totalAdjustment: number;
    guardrailsApplied: string[];
  };
}

interface ModuloCalculationDialogProps {
  roomType: string;
  currentRate: number;
  children: React.ReactNode;
}

export default function ModuloCalculationDialog({ 
  roomType, 
  currentRate, 
  children 
}: ModuloCalculationDialogProps) {
  const [open, setOpen] = useState(false);

  const { data: calculation, isLoading } = useQuery<CalculationResult>({
    queryKey: [`/api/calculation/${roomType}?currentRate=${currentRate}`],
    enabled: open, // Only fetch when dialog is open
  });

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <div className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded p-1 transition-colors" data-testid={`trigger-modulo-calculation-${roomType}`}>
          {children}
        </div>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Calculator className="w-5 h-5 text-[var(--trilogy-teal)]" />
            <span>Modulo Rate Calculation</span>
            <Badge variant="secondary" className="ml-2">{roomType}</Badge>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <div className="text-sm text-gray-500">Loading calculation details...</div>
          </div>
        ) : calculation ? (
          <div className="space-y-6" data-testid="calculation-details">
            {/* Final Result */}
            <div className="bg-[var(--trilogy-navy)]/5 rounded-lg p-4 border border-[var(--trilogy-navy)]/20">
              <div className="flex items-center justify-between">
                <span className="text-lg font-medium text-gray-700 dark:text-gray-300">Recommended Rate:</span>
                <span className="text-2xl font-bold text-[var(--trilogy-teal)]" data-testid="final-recommended-rate">
                  {formatCurrency(calculation.recommendedRate)}
                </span>
              </div>
              <div className="text-sm text-gray-500 mt-1">
                Base Rate: {formatCurrency(calculation.calculation.baseRate)}
              </div>
            </div>

            {/* Calculation Breakdown */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Calculation Breakdown</h3>
              
              <div className="grid gap-3">
                {/* Occupancy Adjustment */}
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg" data-testid="adjustment-occupancy">
                  <div className="flex items-center space-x-3">
                    <div className={`p-1 rounded ${getAdjustmentColor(calculation.calculation.occupancyAdjustment)}`}>
                      {getAdjustmentIcon(calculation.calculation.occupancyAdjustment)}
                    </div>
                    <div>
                      <div className="font-medium">Occupancy Pressure</div>
                      <div className="text-xs text-gray-500">Target 95% occupancy</div>
                    </div>
                  </div>
                  <div className={`text-right ${getAdjustmentColor(calculation.calculation.occupancyAdjustment)}`}>
                    <div className="font-semibold">{formatPercent(calculation.calculation.occupancyAdjustment)}</div>
                    <div className="text-xs">
                      {formatCurrency(calculation.calculation.baseRate * calculation.calculation.occupancyAdjustment)}
                    </div>
                  </div>
                </div>

                {/* Vacancy Adjustment */}
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg" data-testid="adjustment-vacancy">
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
                      {formatCurrency(calculation.calculation.baseRate * calculation.calculation.vacancyAdjustment)}
                    </div>
                  </div>
                </div>

                {/* Attribute Adjustment */}
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg" data-testid="adjustment-attributes">
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
                      {formatCurrency(calculation.calculation.baseRate * calculation.calculation.attributeAdjustment)}
                    </div>
                  </div>
                </div>

                {/* Seasonal Adjustment */}
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg" data-testid="adjustment-seasonal">
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
                      {formatCurrency(calculation.calculation.baseRate * calculation.calculation.seasonalAdjustment)}
                    </div>
                  </div>
                </div>

                {/* Competitor Adjustment */}
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg" data-testid="adjustment-competitor">
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
                      {formatCurrency(calculation.calculation.baseRate * calculation.calculation.competitorAdjustment)}
                    </div>
                  </div>
                </div>

                {/* Market Adjustment */}
                <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg" data-testid="adjustment-market">
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
                      {formatCurrency(calculation.calculation.baseRate * calculation.calculation.marketAdjustment)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Total Adjustment */}
              <div className="border-t pt-3">
                <div className="flex items-center justify-between p-3 bg-[var(--trilogy-teal)]/10 rounded-lg border border-[var(--trilogy-teal)]/20" data-testid="total-adjustment">
                  <div className="font-semibold text-gray-800 dark:text-gray-200">Total Adjustment</div>
                  <div className={`text-right font-bold ${getAdjustmentColor(calculation.calculation.totalAdjustment)}`}>
                    <div>{formatPercent(calculation.calculation.totalAdjustment)}</div>
                    <div className="text-xs">
                      {formatCurrency(calculation.calculation.baseRate * calculation.calculation.totalAdjustment)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Guardrails Applied */}
            {calculation.calculation.guardrailsApplied.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 flex items-center space-x-2">
                  <Shield className="w-5 h-5 text-amber-500" />
                  <span>Guardrails Applied</span>
                </h3>
                <div className="space-y-2" data-testid="guardrails-list">
                  {calculation.calculation.guardrailsApplied.map((rule, index) => (
                    <div key={index} className="flex items-center space-x-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-800">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                      <span className="text-sm text-amber-800 dark:text-amber-200">{rule}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Calculation Formula */}
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Formula:</h3>
              <div className="text-xs font-mono text-gray-600 dark:text-gray-400 space-y-1">
                <div>Base Rate × (1 + Total Weighted Adjustments) = Recommended Rate</div>
                <div>
                  {formatCurrency(calculation.calculation.baseRate)} × (1 + {formatPercent(calculation.calculation.totalAdjustment)}) = {formatCurrency(calculation.recommendedRate)}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center p-8">
            <div className="text-sm text-red-500">Failed to load calculation details</div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}