import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Calculator, TrendingUp, TrendingDown, Shield, AlertCircle, Info, Settings, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { isRuleAdditive } from "@shared/ruleStacking";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface WeightsApiResponse {
  weights: {
    occupancy_pressure: number;
    days_vacant_decay: number;
    seasonality: number;
    competitor_rates: number;
    stock_market: number;
    inquiry_tour_volume: number;
    enable_weights: boolean;
  };
}

interface ModuloCalculationDialogProps {
  roomType: string;
  currentRate: number;
  unitId: string;
  children: React.ReactNode;
  calculationDetails?: string; // JSON string with calculation details
  ruleAdjustedRate?: number | null; // Rate after manual rules are applied
  appliedRuleName?: string | null; // Name of the applied rule
  serviceLine?: string | null; // Service line for rate formatting
  locationId?: string | null; // Location ID for fetching current weights
}

export default function ModuloCalculationDialog({ 
  roomType, 
  currentRate, 
  unitId,
  children,
  calculationDetails,
  ruleAdjustedRate,
  appliedRuleName,
  serviceLine,
  locationId
}: ModuloCalculationDialogProps) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<any>(null);
  const [recalcStatus, setRecalcStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [showSignalDetails, setShowSignalDetails] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const queryClient = useQueryClient();

  // Fetch active rules when dialog is open and rules were applied to this unit
  const { data: activeRules } = useQuery<any[]>({
    queryKey: ['/api/adjustment-rules'],
    queryFn: async () => {
      const res = await fetch('/api/adjustment-rules', { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && !!appliedRuleName,
    staleTime: 30_000,
  });

  const recalculateMutation = useMutation({
    mutationFn: async () => {
      if (!locationId) throw new Error('No locationId available');
      const res = await apiRequest(`/api/locations/${locationId}/recalculate`, 'POST', {});
      return res.json() as Promise<{ jobId: string; targetMonth: string }>;
    },
    onSuccess: (data) => {
      setRecalcStatus('running');
      pollForCompletion(data.jobId);
    },
    onError: () => {
      setRecalcStatus('error');
    }
  });

  const pollForCompletion = (jobId: string) => {
    let attempts = 0;
    const maxAttempts = 120;
    const poll = async () => {
      try {
        const res = await fetch(`/api/pricing/job-status/${jobId}`, { credentials: 'include' });
        const data = await res.json();
        if (data.status === 'completed') {
          setRecalcStatus('done');
          queryClient.invalidateQueries({ queryKey: ['/api/rent-roll'] });
          queryClient.invalidateQueries({ queryKey: ['/api/locations'] });
        } else if (data.status === 'failed') {
          setRecalcStatus('error');
        } else if (attempts < maxAttempts) {
          attempts++;
          pollRef.current = setTimeout(poll, 2000);
        } else {
          setRecalcStatus('error');
        }
      } catch {
        setRecalcStatus('error');
      }
    };
    poll();
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

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

  // Fetch current weights to detect staleness — uses query params so service
  // lines containing '/' (e.g. AL/MC) are encoded correctly.
  const weightsUrl = (() => {
    const params = new URLSearchParams();
    if (locationId) params.set('locationId', locationId);
    if (serviceLine) params.set('serviceLine', serviceLine);
    const qs = params.toString();
    return qs ? `/api/weights?${qs}` : '/api/weights';
  })();

  const { data: currentWeightsResponse } = useQuery<WeightsApiResponse>({
    queryKey: ['/api/weights', locationId ?? null, serviceLine ?? null],
    queryFn: async () => {
      const res = await fetch(weightsUrl, { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return res.json() as Promise<WeightsApiResponse>;
    },
    enabled: open,
  });

  // Use provided details or API details
  const calcDetails = details || apiDetails;

  // Determine if stored weights differ from current weights
  const hasStaleWeights = (() => {
    if (!calcDetails?.weights || !currentWeightsResponse) return false;
    const stored = calcDetails.weights;
    const current = currentWeightsResponse.weights;
    if (!current) return false;
    const numericFields: Array<{ stored: string; current: keyof WeightsApiResponse['weights'] }> = [
      { stored: 'occupancyPressure', current: 'occupancy_pressure' },
      { stored: 'daysVacantDecay', current: 'days_vacant_decay' },
      { stored: 'seasonality', current: 'seasonality' },
      { stored: 'competitorRates', current: 'competitor_rates' },
      { stored: 'stockMarket', current: 'stock_market' },
      { stored: 'inquiryTourVolume', current: 'inquiry_tour_volume' },
    ];
    const numericDiffers = numericFields.some(({ stored: sk, current: ck }) => {
      const storedVal = (stored[sk] as number) ?? 0;
      const currentVal = (current[ck] as number) ?? 0;
      return storedVal !== currentVal;
    });
    // Also check enable_weights flag so toggling the algorithm on/off surfaces the banner
    const storedEnable = stored.enableWeights !== false;
    const currentEnable = current.enable_weights !== false;
    return numericDiffers || storedEnable !== currentEnable;
  })();

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

  // Use the actual final rate from the backend calculation
  // This ensures the popup shows the exact same rate as the rate card table
  const getFinalRate = (details: any) => {
    if (!details) return currentRate;
    return details.finalRate || currentRate;
  };

  // Derive a human-readable description from a rule's stored trigger JSONB.
  // Handles the array-based multi-condition format written by the structured rule builder,
  // as well as the singular trigger.condition object written by the natural language parser.
  function describeTrigger(triggerRaw: any): string {
    if (!triggerRaw) return '';
    const trigger = typeof triggerRaw === 'string' ? JSON.parse(triggerRaw) : triggerRaw;

    // Immediate / unconditional rule
    if (trigger.type === 'immediate' || trigger.immediate === true) {
      return 'Applies unconditionally';
    }

    const FIELD_LABELS: Record<string, string> = {
      occupancy: 'Campus Occupancy',
      campus_occupancy: 'Campus Occupancy',
      service_line_occupancy: 'SL Occupancy',
      room_type_occupancy: 'RT Occupancy',
      vacant_units: 'Vacant Units',
      vacant_beds: 'Vacant Beds',
      competitor_rate: 'Competitor Rate',
      competitor_variance: 'Competitor Rate Var %',
      street_to_comp_var: 'Street Rate to Top Comp Var %',
      quality_mix: 'Quality Mix',
      private_pay: 'Private Pay %',
      inquiry_volume: 'Inquiry Volume',
      inquiry_tour_volume: 'Inquiry & Tour Volume',
      inquiry_count: 'Inquiry Count',
      tour_count: 'Tour Count',
      tour_volume: 'Tour Volume',
      avg_days_vacant: 'Avg Days Vacant',
      days_vacant_campus: 'Days Vacant',
      ih_street_variance: 'IH-to-Street Rate Var %',
      revenue_growth_target: 'Revenue Growth Target',
      growth_target: 'Revenue Growth Target',
      price_elasticity: 'Price Elasticity',
      elasticity: 'Price Elasticity',
      days_to_sell_before: 'Days To Sell Before',
      days_to_sell_after: 'Days To Sell After',
      days_to_sell_change: 'Days To Sell Change',
    };

    const OP_LABELS: Record<string, string> = {
      '<': '<', '<=': '≤', '>': '>', '>=': '≥',
      '=': '=', '==': '=', '===': '=',
    };

    const formatCond = (c: { field: string; operator: string; value: number }) => {
      const label = FIELD_LABELS[c.field] || c.field;
      const op = OP_LABELS[c.operator] || c.operator;
      return `${label} ${op} ${c.value}`;
    };

    // Array-based multi-condition format (structured rule builder)
    if (Array.isArray(trigger.conditions) && trigger.conditions.length > 0) {
      const condOperator = (trigger.conditionOperator || 'AND').toUpperCase();
      const condParts = (trigger.conditions as Array<{ field: string; operator: string; value: number }>)
        .map(formatCond);
      return `If ${condParts.join(` ${condOperator} `)}`;
    }

    // Singular condition object format (natural language parser)
    if (trigger.condition && trigger.condition.field) {
      return `If ${formatCond(trigger.condition as { field: string; operator: string; value: number })}`;
    }

    return '';
  }

  // Build a step-by-step breakdown of each rule applied to this unit.
  // Replays the same stacking logic used by adjustmentRulesService.ts.
  const ruleChainSteps: Array<{
    name: string;
    description: string;
    actionLabel: string;
    before: number;
    after: number;
    delta: number;
    isAdditive: boolean;
    priorityNum: number;
  }> = (() => {
    if (!appliedRuleName || !activeRules?.length || !calcDetails) return [];
    const appliedNames = appliedRuleName.split(' + ').map((n: string) => n.trim());
    // Preserve order by matching names in the order they appear in appliedRuleName
    const matchedRules = appliedNames
      .map((name: string) => activeRules.find((r: any) => r.name === name))
      .filter(Boolean);
    if (!matchedRules.length) return [];
    const streetRate = calcDetails.baseRate || currentRate; // rules start from Street Rate
    let current = streetRate;
    let exclusiveCount = 0;
    return matchedRules.map((rule: any, idx: number) => {
      const action = typeof rule.action === 'string' ? JSON.parse(rule.action) : rule.action;
      const trigger = typeof rule.trigger === 'string' ? JSON.parse(rule.trigger) : rule.trigger;
      const isAdditive = isRuleAdditive(action);
      if (!isAdditive) exclusiveCount++;
      const adjType = action?.adjustmentType || 'percentage';
      const adjValue = action?.adjustmentValue ?? action?.percentage ?? 0;
      const before = current;
      if (adjType === 'percentage') {
        current = Math.round(current * (1 + adjValue / 100));
      } else {
        current = Math.round(current + adjValue);
      }
      const delta = current - before;
      const pctStr = `${adjValue > 0 ? '+' : ''}${adjValue}%`;
      const dollarStr = `${adjValue >= 0 ? '+' : ''}$${Math.abs(adjValue)}`;
      const actionLabel = adjType === 'percentage'
        ? `${adjValue > 0 ? 'Increase' : 'Decrease'} by ${pctStr}`
        : `${adjValue >= 0 ? 'Increase' : 'Decrease'} by ${dollarStr}`;
      return {
        name: rule.name,
        description: describeTrigger(trigger),
        actionLabel,
        before,
        after: current,
        delta,
        isAdditive,
        priorityNum: isAdditive ? idx + 1 : exclusiveCount,
      };
    });
  })();

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


  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[90vh] overflow-y-auto sm:w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Calculator className="h-5 w-5 text-[var(--trilogy-teal)]" />
            Rules Rate Calculation
            <Badge variant="secondary">{roomType}</Badge>
            {locationId && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7 text-xs gap-1.5"
                disabled={recalcStatus === 'running' || recalculateMutation.isPending}
                onClick={() => {
                  setRecalcStatus('idle');
                  recalculateMutation.mutate();
                }}
              >
                <RefreshCw className={`h-3 w-3 ${recalcStatus === 'running' ? 'animate-spin' : ''}`} />
                {recalcStatus === 'running' ? 'Recalculating…' : recalcStatus === 'done' ? 'Done — Reopen to see updated rates' : 'Recalculate'}
              </Button>
            )}
          </DialogTitle>
          {recalcStatus === 'error' && (
            <p className="text-xs text-red-600 mt-1">Recalculation failed. Please try again.</p>
          )}
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
                      <p className="text-xs text-muted-foreground">Street Rate</p>
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
                        {formatCurrency(
                          ruleChainSteps.length > 0
                            ? ruleChainSteps[ruleChainSteps.length - 1].after
                            : ruleAdjustedRate || getFinalRate(calcDetails)
                        )}
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

              {/* Rule Designer Adjustments — step-by-step breakdown */}
              {ruleChainSteps.length > 0 && (
                <Card className="border-green-300 bg-green-50 dark:bg-green-950/20">
                  <CardHeader className="pb-3 bg-green-100/60 dark:bg-green-950/40 rounded-t-lg">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Settings className="h-4 w-4 text-green-700" />
                      <span className="text-green-900 dark:text-green-100">Rule Designer Adjustments</span>
                      <Badge className="bg-green-600 text-white text-xs">
                        {ruleChainSteps.length} rule{ruleChainSteps.length !== 1 ? 's' : ''} applied
                      </Badge>
                    </CardTitle>
                    <p className="text-xs text-green-800 dark:text-green-300 mt-1">
                      Rules apply in priority order. Exclusive rules claim this unit — additive rules stack on top regardless. The final applied rate is the result after all rules have run.
                    </p>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-3">
                    {/* Street Rate baseline */}
                    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-gray-900 border border-green-200">
                      <span className="text-xs font-medium text-muted-foreground">Street Rate (baseline)</span>
                      <span className="text-sm font-bold">{formatCurrency(calcDetails.baseRate || currentRate)}</span>
                    </div>

                    {/* Each rule step */}
                    {ruleChainSteps.map((step, i) => (
                      <div key={i} className="relative">
                        {/* Connector arrow */}
                        <div className="flex justify-center my-1">
                          <ChevronRight className="h-4 w-4 rotate-90 text-green-500" />
                        </div>

                        <div className="rounded-lg border border-green-200 bg-white dark:bg-gray-900 overflow-hidden">
                          {/* Rule header */}
                          <div className="flex items-start justify-between px-3 py-2 bg-green-50 dark:bg-green-950/40 border-b border-green-200">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-xs font-semibold text-green-900 dark:text-green-100">
                                  Rule {i + 1}: {step.name}
                                </p>
                                <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${step.isAdditive ? 'bg-teal-100 text-teal-800 border-teal-300' : 'bg-amber-100 text-amber-800 border-amber-300'}`}>
                                  {step.isAdditive ? 'stacks' : `#${step.priorityNum} exclusive`}
                                </span>
                              </div>
                              {step.description && (
                                <p className="text-xs text-muted-foreground mt-0.5 italic">"{step.description}"</p>
                              )}
                            </div>
                            <Badge
                              variant="outline"
                              className={`ml-2 shrink-0 text-xs font-mono ${step.delta >= 0 ? 'border-green-400 text-green-700' : 'border-red-400 text-red-700'}`}
                            >
                              {step.delta >= 0 ? '+' : ''}{formatCurrency(step.delta)}
                            </Badge>
                          </div>

                          {/* Rate chain */}
                          <div className="flex items-center gap-2 px-3 py-2 text-xs">
                            <span className="font-mono text-muted-foreground">{formatCurrency(step.before)}</span>
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="text-xs text-muted-foreground">{step.actionLabel}</span>
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className={`font-mono font-semibold ${step.delta >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                              {formatCurrency(step.after)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Final applied rate */}
                    <div className="flex justify-center my-1">
                      <ChevronRight className="h-4 w-4 rotate-90 text-green-500" />
                    </div>
                    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-green-600 text-white">
                      <span className="text-xs font-semibold">Final Applied Rate</span>
                      <div className="text-right">
                        {(() => {
                          const chainFinal = ruleChainSteps[ruleChainSteps.length - 1].after;
                          const streetRateBase = calcDetails.baseRate ?? currentRate;
                          const netDelta = chainFinal - streetRateBase;
                          const netPct = streetRateBase > 0 ? (netDelta / streetRateBase) * 100 : 0;
                          return (
                            <>
                              <span className="text-sm font-bold">{formatCurrency(chainFinal)}</span>
                              <span className="text-xs opacity-80 ml-2">
                                ({netDelta >= 0 ? '+' : ''}{formatCurrency(netDelta)} / {netDelta >= 0 ? '+' : ''}{netPct.toFixed(1)}% net)
                              </span>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Fallback: rule was applied but we couldn't load rule details */}
              {appliedRuleName && ruleChainSteps.length === 0 && (
                <Card className="border-green-300 bg-green-50 dark:bg-green-950/20">
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <Settings className="h-4 w-4 text-green-700 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-green-900 dark:text-green-100">Rule Designer Adjustments Applied</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Rules applied: <span className="font-medium text-green-800">{appliedRuleName.split(' + ').join(', ')}</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Street Rate {formatCurrency(calcDetails.baseRate || currentRate)} → Rules Rate {formatCurrency(getFinalRate(calcDetails))} → Applied Rate {formatCurrency(ruleAdjustedRate!)}
                          {' '}({ruleAdjustedRate! - (calcDetails.baseRate || currentRate) >= 0 ? '+' : ''}
                          {formatCurrency(ruleAdjustedRate! - (calcDetails.baseRate || currentRate))} net from Street Rate)
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Stale Weights Notice */}
              {hasStaleWeights && (
                <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <RefreshCw className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-1">
                          Rates calculated with older weights
                        </h4>
                        <p className="text-xs text-amber-800 dark:text-amber-200">
                          The pricing weights have been updated since these rates were last generated. Regenerate Rules Rate pricing to apply your latest settings.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Weights Disabled Message */}
              {calcDetails.weightsDisabled && (
                <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
                          Rules Rate Engine Disabled
                        </h4>
                        <p className="text-xs text-blue-800 dark:text-blue-200">
                          The Rules Rate engine is currently turned off. Only manual adjustment rules are being applied to pricing. 
                          To enable it, go to the Pricing Weights section and toggle "Use Rules Rate Algorithm Weights".
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Toggle for underlying signal calculation — hidden by default when rules drove the rate */}
              {ruleChainSteps.length > 0 && (
                <button
                  onClick={() => setShowSignalDetails(s => !s)}
                  className="w-full text-xs text-gray-500 flex items-center justify-center gap-1.5 py-2 hover:bg-gray-50 rounded border border-dashed border-gray-200 transition-colors"
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showSignalDetails ? 'rotate-180' : ''}`} />
                  {showSignalDetails ? 'Hide underlying signal calculation' : 'Show underlying signal calculation'}
                </button>
              )}

              {/* Algorithm Weights */}
              {(ruleChainSteps.length === 0 || showSignalDetails) && calcDetails.weights && !calcDetails.weightsDisabled && (
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
              {(ruleChainSteps.length === 0 || showSignalDetails) && !calcDetails.weightsDisabled && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Rules Rate Calculation</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {calcDetails.adjustments && calcDetails.adjustments.length > 0 ? (
                      <>
                        {calcDetails.adjustments.filter((adj: any) => !adj.factor.startsWith('Rule:')).map((adj: any, index: number, filteredArray: any[]) => (
                          <div key={index}>
                            <div className="flex items-start justify-between mb-2">
                              <div className="space-y-1 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="text-sm font-medium">{adj.factor}</h4>
                                  <Badge variant="outline" className="text-xs">
                                    Weight: {adj.weight}%
                                  </Badge>
                                  {/occupancy/i.test(adj.factor) && calcDetails.occupancySource && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Badge
                                            variant="secondary"
                                            className={`text-xs cursor-help ${
                                              calcDetails.occupancySource === 't3m'
                                                ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300 border-teal-300 dark:border-teal-700'
                                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-600'
                                            }`}
                                          >
                                            {calcDetails.occupancyUsed !== undefined
                                              ? `${(calcDetails.occupancyUsed * 100).toFixed(1)}% — `
                                              : ''}
                                            {calcDetails.occupancySource === 't3m' ? 'T3M avg' : 'Snapshot'}
                                          </Badge>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-xs text-xs">
                                          {calcDetails.occupancySource === 't3m'
                                            ? 'Trailing 3-month weighted average — uses recent historical move-in/move-out data for a smoother, more accurate occupancy signal.'
                                            : 'Real-time snapshot — uses the current point-in-time occupancy count. Applied when insufficient historical data is available.'}
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
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
                                <div className="flex flex-col gap-1 text-xs hover:bg-muted/50 rounded p-2 transition-colors">
                                  <div className="flex items-center gap-2">
                                  <ChevronRight className="h-3 w-3 group-data-[state=open]:rotate-90 transition-transform flex-shrink-0" />
                                  <div className="flex items-center gap-2 flex-1 flex-wrap">
                                    <span className="text-muted-foreground">(</span>
                                    <div className="flex items-center gap-1">
                                      <span className="text-muted-foreground">Signal</span>
                                      <span className="font-mono font-medium">
                                        {adj.signal !== undefined ? adj.signal.toFixed(3) : 'N/A'}
                                      </span>
                                    </div>
                                    <span className="text-muted-foreground">×</span>
                                    <div className="flex items-center gap-1">
                                      <span className="text-muted-foreground">Weight</span>
                                      <span className="font-mono font-medium">{adj.weight}%</span>
                                    </div>
                                    <span className="text-muted-foreground">)</span>
                                    <span className="text-muted-foreground">÷</span>
                                    <div className="flex items-center gap-1">
                                      <span className="text-muted-foreground">Blended</span>
                                      <span className="font-mono font-medium">
                                        {calcDetails?.blendedSignal !== undefined ? calcDetails.blendedSignal.toFixed(3) : 'N/A'}
                                      </span>
                                    </div>
                                    <span className="text-muted-foreground">×</span>
                                    <div className="flex items-center gap-1">
                                      <span className="text-muted-foreground">Total Adj</span>
                                      <span className="font-mono font-medium">
                                        {(() => {
                                          const derived = calcDetails?.adjustments
                                            ?.filter((a: any) => a.factor !== 'RevenueTarget')
                                            ?.reduce((sum: number, a: any) => sum + (a.weightedAdjustment || 0), 0);
                                          const val = derived ?? calcDetails?.preOverrideTotalAdj ?? calcDetails?.totalAdjustment;
                                          return val !== undefined
                                            ? `${val > 0 ? '+' : ''}${formatPercent(val)}`
                                            : 'N/A';
                                        })()}
                                      </span>
                                    </div>
                                    <span className="text-muted-foreground">=</span>
                                    <div className="flex items-center gap-1">
                                      <span className={`font-mono font-medium ${getAdjustmentColor(adj.weightedAdjustment)}`}>
                                        {adj.weightedAdjustment > 0 ? '+' : ''}{formatPercent(adj.weightedAdjustment)}
                                      </span>
                                    </div>
                                  </div>
                                  <span className="text-xs text-muted-foreground italic shrink-0">Click for details</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground italic pl-5">
                                    This factor's share of the blended signal, applied to the total adjustment
                                  </p>
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
                              <span className="text-sm font-semibold">Rules Rate Result</span>
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
                        <p className="text-xs mt-1">Generate Rules Rate suggestions to see detailed calculations</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              )}

              {/* Manual Adjustment Rules */}
              {(ruleChainSteps.length === 0 || showSignalDetails) && calcDetails.adjustments && calcDetails.adjustments.filter((adj: any) => adj.factor.startsWith('Rule:')).length > 0 && (
                <Card className="border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Settings className="h-4 w-4 text-blue-600" />
                      Manual Adjustment Rules
                      <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
                        Overrides Rules Rate
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        The following manual rules were applied to override the Rules Rate engine:
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
              {(ruleChainSteps.length === 0 || showSignalDetails) && calcDetails.adjustments && calcDetails.adjustments.length > 0 && (
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
                        const unitSubtotal = typeof calcDetails.rawUnitTotalAdjustment === 'number'
                          ? calcDetails.rawUnitTotalAdjustment
                          : calcDetails.adjustments.reduce((sum: number, adj: any) => sum + (adj.weightedAdjustment || 0), 0);
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
                                  Group Avg Override (pre-guardrail)
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
              {(ruleChainSteps.length === 0 || showSignalDetails) && <Card className="bg-gray-50 dark:bg-gray-800">
                <CardContent className="pt-4">
                  <h3 className="text-xs font-semibold text-muted-foreground mb-2">Formula:</h3>
                  <div className="text-xs font-mono space-y-1">
                    <div>Base Rate × (1 + Total Weighted Adjustments) = Recommended Rate</div>
                    <div className="text-primary">
                      {formatCurrency(calcDetails.baseRate || currentRate)} × (1 + {formatPercent(effectiveAdj)}) = {formatCurrency(getFinalRate(calcDetails))}
                    </div>
                  </div>
                </CardContent>
              </Card>}
            </>
          ) : (
            <div className="flex items-center justify-center p-8">
              <div className="text-center text-muted-foreground">
                <Info className="h-8 w-8 mx-auto mb-2" />
                <p className="text-sm">No calculation details available</p>
                <p className="text-xs mt-1">Generate Rules Rate suggestions to see detailed calculations</p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}