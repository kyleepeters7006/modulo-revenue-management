import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Calculator, TrendingUp, TrendingDown, Shield, AlertCircle, Info, Settings, ChevronDown, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface ModuloCalculationDialogProps {
  roomType: string;
  currentRate: number;
  unitId: string;
  children: React.ReactNode;
  calculationDetails?: string; // JSON string with calculation details
  ruleAdjustedRate?: number | null; // Rate after manual rules are applied
  appliedRuleName?: string | null; // Name of the applied rule
  serviceLine?: string | null; // Service line for rate formatting
}

export default function ModuloCalculationDialog({ 
  roomType, 
  currentRate, 
  unitId,
  children,
  calculationDetails,
  ruleAdjustedRate,
  appliedRuleName,
  serviceLine
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

  // Effective (post-guardrail) adjustment = actual applied change from street rate to final rate.
  // This matches the % shown in the rate card table and is arithmetically correct.
  // calcDetails.totalAdjustment is the pre-guardrail group average, which can differ when guardrails cap the rate.
  const effectiveAdj = (() => {
    if (!calcDetails) return 0;
    if (typeof calcDetails.baseRate === 'number' && typeof calcDetails.finalRate === 'number' && calcDetails.baseRate > 0) {
      return (calcDetails.finalRate - calcDetails.baseRate) / calcDetails.baseRate;
    }
    return calcDetails.totalAdjustment ?? 0;
  })();

  // Guardrails were applied if the new object format says so, or old array format is non-empty
  const guardrailsWereApplied = !!(
    calcDetails?.guardrailsApplied?.wasAdjusted === true ||
    (Array.isArray(calcDetails?.guardrailsApplied) && calcDetails.guardrailsApplied.length > 0)
  );

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

  // Use the actual final rate from the backend calculation
  // This ensures the popup shows the exact same rate as the rate card table
  const getFinalRate = (details: any) => {
    if (!details) return currentRate;
    // Use the finalRate from calculation details (which includes guardrails)
    return details.finalRate || currentRate;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto sm:w-full">
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
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Base Rate</p>
                      <p className="text-lg font-bold">{formatCurrency(calcDetails.baseRate || currentRate)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Adjustment</p>
                      <p className="text-lg font-bold flex items-center gap-1">
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
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Modulo Rate</p>
                      <p className={`text-lg font-bold ${ruleAdjustedRate ? 'text-muted-foreground line-through' : 'text-primary'}`}>
                        {formatCurrency(getFinalRate(calcDetails))}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {appliedRuleName ? 'Applied Rate' : 'Final Rate'}
                      </p>
                      <p className="text-lg font-bold text-primary">
                        {formatCurrency(ruleAdjustedRate || getFinalRate(calcDetails))}
                      </p>
                      {appliedRuleName && (
                        <Badge variant="default" className="mt-1 text-xs bg-green-600">
                          {appliedRuleName}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Weights Disabled Message */}
              {calcDetails.weightsDisabled && (
                <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
                          Modulo Algorithm Disabled
                        </h4>
                        <p className="text-xs text-blue-800 dark:text-blue-200">
                          The Modulo pricing algorithm is currently turned off. Only manual adjustment rules are being applied to pricing. 
                          To enable the algorithm, go to the Pricing Weights section and toggle "Use Modulo Algorithm Weights".
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Algorithm Weights */}
              {calcDetails.weights && !calcDetails.weightsDisabled && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Algorithm Weights Configuration</CardTitle>
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

              {/* Modulo Algorithm Calculation */}
              {!calcDetails.weightsDisabled && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Modulo Algorithm Calculation</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {calcDetails.adjustments && calcDetails.adjustments.length > 0 ? (
                      <>
                        {calcDetails.adjustments.filter((adj: any) => !adj.factor.startsWith('Rule:')).map((adj: any, index: number, filteredArray: any[]) => (
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
                            <div className="bg-muted/50 rounded-md px-3 py-2 mb-2">
                              <p className="text-xs font-mono">{adj.formula || adj.calculation}</p>
                            </div>
                            
                            {/* Sentence Explanation */}
                            <div className="border-l-2 border-primary/20 pl-3 mb-2">
                              <p className="text-xs text-muted-foreground">{adj.description}</p>
                            </div>
                            
                            <Collapsible>
                              <CollapsibleTrigger className="w-full group">
                                <div className="flex items-center gap-2 text-xs hover:bg-muted/50 rounded p-2 transition-colors">
                                  <ChevronRight className="h-3 w-3 group-data-[state=open]:rotate-90 transition-transform" />
                                  <div className="flex items-center gap-4 flex-1">
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
                                  <span className="text-xs text-muted-foreground italic">Click for details</span>
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
                                      {adj.signalExplanation || 'The normalized signal is converted to a percentage adjustment based on the algorithm\'s scaling factors.'}
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
                                            <span className="font-mono">{typeof value === 'number' ? value.toFixed(2) : value}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                            
                            {index < filteredArray.length - 1 && <Separator className="mt-3" />}
                          </div>
                        ))}
                        
                        {/* Modulo Subtotal */}
                        {calcDetails.adjustments.filter((adj: any) => !adj.factor.startsWith('Rule:')).length > 0 && (
                          <div className="mt-4 pt-4 border-t-2 border-[var(--trilogy-teal)]">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold">Modulo Algorithm Result</span>
                              <span className={`text-base font-bold ${getAdjustmentColor(
                                calcDetails.adjustments
                                  .filter((adj: any) => !adj.factor.startsWith('Rule:'))
                                  .reduce((sum: number, adj: any) => sum + adj.weightedAdjustment, 0)
                              )}`}>
                                {calcDetails.adjustments
                                  .filter((adj: any) => !adj.factor.startsWith('Rule:'))
                                  .reduce((sum: number, adj: any) => sum + adj.weightedAdjustment, 0) > 0 ? '+' : ''}
                                {formatPercent(calcDetails.adjustments
                                  .filter((adj: any) => !adj.factor.startsWith('Rule:'))
                                  .reduce((sum: number, adj: any) => sum + adj.weightedAdjustment, 0))}
                              </span>
                            </div>
                          </div>
                        )}
                      </>
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
              )}

              {/* Manual Adjustment Rules */}
              {calcDetails.adjustments && calcDetails.adjustments.filter((adj: any) => adj.factor.startsWith('Rule:')).length > 0 && (
                <Card className="border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Settings className="h-4 w-4 text-blue-600" />
                      Manual Adjustment Rules
                      <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
                        Overrides Modulo
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        The following manual rules were applied to override the Modulo algorithm:
                      </p>
                      {calcDetails.adjustments.filter((adj: any) => adj.factor.startsWith('Rule:')).map((adj: any, index: number) => (
                        <div key={index} className="space-y-2 p-3 bg-white dark:bg-gray-900 rounded border border-blue-200 dark:border-blue-800">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium">{adj.factor.replace('Rule: ', '')}</p>
                            <p className={`text-lg font-bold ${getAdjustmentColor(adj.weightedAdjustment)}`}>
                              {adj.weightedAdjustment > 0 ? '+' : ''}{formatPercent(adj.weightedAdjustment)}
                            </p>
                          </div>
                          
                          {/* Formula Display */}
                          <div className="bg-blue-50 dark:bg-blue-950/30 rounded-md px-3 py-2">
                            <p className="text-xs font-mono">{adj.formula || adj.calculation}</p>
                          </div>
                          
                          {/* Sentence Explanation */}
                          <div className="border-l-2 border-blue-500/30 pl-3">
                            <p className="text-xs text-muted-foreground">{adj.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Smart Adjustments (Guardrails) - shown only for old array-format guardrail data */}
              {Array.isArray(calcDetails.guardrailsApplied) && calcDetails.guardrailsApplied.length > 0 && (
                <Card className="border-amber-500 bg-amber-50 dark:bg-amber-950/30 shadow-md">
                  <CardHeader className="pb-3 bg-amber-100 dark:bg-amber-950/50">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Shield className="h-5 w-5 text-amber-600" />
                      <span className="font-semibold">Guardrails Applied</span>
                      <Badge variant="default" className="bg-amber-600 text-white">
                        Safety Limits Active
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="space-y-4">
                      {/* Show the impact of guardrails */}
                      <div className="bg-white dark:bg-gray-900 rounded-lg p-3 border-2 border-amber-400">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Algorithm Calculated</p>
                            <p className="text-lg font-bold text-red-600">
                              {formatCurrency(calcDetails.finalRate)}
                            </p>
                            <p className="text-xs text-red-600">
                              ({effectiveAdj > 0 ? '+' : ''}{formatPercent(effectiveAdj)})
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">After Guardrails</p>
                            <p className="text-lg font-bold text-green-600">
                              {formatCurrency(Math.round(calcDetails.baseRate * 0.95))}
                            </p>
                            <p className="text-xs text-green-600">
                              (-5.0% max decrease)
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      <p className="text-xs text-amber-800 dark:text-amber-200 font-medium">
                        The algorithm recommended a larger adjustment, but guardrails limited it to protect pricing stability:
                      </p>
                      
                      {calcDetails.guardrailsApplied.map((rule: string, index: number) => (
                        <div key={index} className="flex items-start gap-2 p-3 bg-white dark:bg-gray-900 rounded border-l-4 border-amber-500">
                          <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">{rule}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {rule.includes('Minimum') && 'This guardrail prevents rates from dropping more than 5% at once to maintain revenue stability'}
                              {rule.includes('Maximum') && 'This guardrail prevents rates from increasing more than 15% at once to avoid pricing shocks'}
                              {rule.includes('Competitor variance floor') && 'This guardrail ensures rates stay within 10% of competitor pricing'}
                              {rule.includes('Competitor variance ceiling') && 'This guardrail ensures rates stay within 10% of competitor pricing'}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

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
                      {/* Unit Calculation Subtotal — arithmetic sum of the individual factor rows above */}
                      {(() => {
                        const unitSubtotal = calcDetails.adjustments.reduce((sum: number, adj: any) => sum + (adj.weightedAdjustment || 0), 0);
                        const groupAdj = calcDetails.totalAdjustment;
                        const groupDiffersFromUnit = typeof groupAdj === 'number' && Math.abs(groupAdj - unitSubtotal) > 0.0001;
                        return (
                          <>
                            <div className="flex items-center justify-between text-xs pt-1 border-t border-dashed border-muted-foreground/30">
                              <span className="text-muted-foreground italic">Unit Calculation Subtotal</span>
                              <span className="text-muted-foreground">{unitSubtotal > 0 ? '+' : ''}{formatPercent(unitSubtotal)}</span>
                            </div>
                            {groupDiffersFromUnit && (
                              <div className="flex items-center justify-between text-xs text-amber-700 dark:text-amber-500">
                                <span
                                  className="flex items-center gap-1 cursor-help"
                                  title="All units sharing the same Location + Service Line + Room Type receive the same % adjustment (group average), ensuring consistent pricing across comparable units. The group average may differ from this unit's individual calculation."
                                >
                                  <Info className="h-3 w-3" />
                                  Group Avg Adjustment (overrides unit)
                                </span>
                                <span>{groupAdj > 0 ? '+' : ''}{formatPercent(groupAdj)}</span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                      <Separator />
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Total Adjustment</span>
                        <span className={`font-medium ${getAdjustmentColor(effectiveAdj)}`}>
                          {effectiveAdj > 0 ? '+' : ''}{formatPercent(effectiveAdj)}
                        </span>
                      </div>
                      {guardrailsWereApplied && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-1 text-amber-700 dark:text-amber-500">
                            <Shield className="h-3 w-3" />
                            Guardrails Applied
                          </span>
                          <span className="text-amber-700 dark:text-amber-500 font-medium">Capped</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between font-bold">
                        <span>Recommended Rate</span>
                        <span className="text-lg text-primary">{formatCurrency(getFinalRate(calcDetails))}</span>
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
                      {formatCurrency(calcDetails.baseRate || currentRate)} × (1 + {formatPercent(effectiveAdj)}) = {formatCurrency(getFinalRate(calcDetails))}
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