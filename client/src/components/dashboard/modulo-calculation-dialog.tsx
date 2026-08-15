import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calculator, TrendingUp, TrendingDown, AlertCircle, Settings, RefreshCw, Pencil, ArrowRight } from "lucide-react";
import { getRuleAdjustment } from "@shared/ruleStacking";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatRateByServiceLine } from "@/lib/formatters";

interface ModuloCalculationDialogProps {
  roomType: string;
  /** The unit's street rate. */
  currentRate: number;
  children: React.ReactNode;
  /** The rate the rules were applied to, as recorded by the last pricing run. */
  baseRate?: number | null;
  /** The served rate after adjustment rules. */
  ruleAdjustedRate?: number | null;
  /** Names of the applied rules, joined with " + " in application order. */
  appliedRuleName?: string | null;
  serviceLine?: string | null;
  locationId?: string | null;
}

/**
 * Explains how the served rate for a unit was reached, in terms of the adjustment
 * rules that produced it.
 *
 * This dialog deliberately does NOT re-compute the rate in the browser. It previously
 * replayed the rule chain client-side and compared the result against the saved rate,
 * warning that "rules have changed" whenever the two disagreed — which was almost
 * always, because the replay could not reproduce what the engine does (the engine
 * applies rules to the base rate from the pricing run rather than the street rate,
 * rounds at every step, and then clamps the result against guardrails). The dialog
 * now reports the engine's own numbers and describes the rules behind them.
 *
 * Caveat worth knowing: the engine records applied rules by NAME, not by id, and keeps
 * no per-unit rule chain. Everything below that resolves a name back to a live rule is
 * therefore best-effort, and is written to stay silent rather than guess.
 */
export default function ModuloCalculationDialog({
  roomType,
  currentRate,
  children,
  baseRate,
  ruleAdjustedRate,
  appliedRuleName,
  serviceLine,
  locationId,
}: ModuloCalculationDialogProps) {
  const [open, setOpen] = useState(false);
  const [recalcStatus, setRecalcStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  // Rules currently on the books, used to attach each applied rule's definition
  // (trigger, adjustment, id for the edit link) to its name.
  const { data: rulesList, isSuccess: rulesLoaded } = useQuery<any[]>({
    queryKey: ['/api/adjustment-rules'],
    queryFn: async () => {
      const res = await fetch('/api/adjustment-rules', { credentials: 'include' });
      // Deliberately throws instead of falling back to []: an empty list is
      // indistinguishable from "every applied rule has been deleted", and would
      // turn a transient API or auth failure into a confident stale-rate warning.
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
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
    },
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
          queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
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

  const fmt = (amount: number) => formatRateByServiceLine(Math.round(amount), serviceLine ?? null);

  // Derive a human-readable description from a rule's stored trigger JSONB.
  // Handles the array-based multi-condition format written by the structured rule builder,
  // as well as the singular trigger.condition object written by the natural language parser.
  function describeTrigger(triggerRaw: any): string {
    if (!triggerRaw) return '';
    let trigger = triggerRaw;
    if (typeof triggerRaw === 'string') {
      try { trigger = JSON.parse(triggerRaw); } catch { return ''; }
    }

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

    if (Array.isArray(trigger.conditions) && trigger.conditions.length > 0) {
      const condOperator = (trigger.conditionOperator || 'AND').toUpperCase();
      const condParts = (trigger.conditions as Array<{ field: string; operator: string; value: number }>)
        .map(formatCond);
      return `If ${condParts.join(` ${condOperator} `)}`;
    }

    if (trigger.condition && trigger.condition.field) {
      return `If ${formatCond(trigger.condition as { field: string; operator: string; value: number })}`;
    }

    return '';
  }

  function describeAdjustment(actionRaw: any): string {
    let action = actionRaw;
    if (typeof actionRaw === 'string') {
      try { action = JSON.parse(actionRaw); } catch { return ''; }
    }
    const { adjustmentType, adjustmentValue } = getRuleAdjustment(action);
    if (!adjustmentValue) return '';
    if (adjustmentType === 'percentage') {
      return `${adjustmentValue > 0 ? '+' : ''}${adjustmentValue}%`;
    }
    return `${adjustmentValue >= 0 ? '+' : '−'}$${Math.abs(adjustmentValue)}`;
  }

  // Applied rules, matched back to their current definitions by name.
  const appliedNames = appliedRuleName
    ? appliedRuleName.split(' + ').map((n) => n.trim()).filter(Boolean)
    : [];

  const appliedRuleDetails = appliedNames.map((name) => {
    const matches = (rulesList ?? []).filter((r: any) => r.name === name);
    return {
      name,
      // Rule names are unique per scope rather than globally, so a name can match
      // more than one rule. Showing one of them — and an edit link to it — would be
      // a guess, so an ambiguous match is treated as no match.
      rule: matches.length === 1 ? matches[0] : null,
      ambiguous: matches.length > 1,
      missing: rulesLoaded && matches.length === 0,
    };
  });

  // The staleness signals we can state with confidence. Both are only evaluated once
  // the rule list has genuinely loaded, so a failed fetch cannot masquerade as one.
  const deletedRules = rulesLoaded ? appliedRuleDetails.filter((d) => d.missing).map((d) => d.name) : [];
  const switchedOffRules = rulesLoaded
    ? appliedRuleDetails.filter((d) => d.rule && d.rule.isActive === false).map((d) => d.name)
    : [];
  const staleRules = [...deletedRules, ...switchedOffRules];

  const finalRate = ruleAdjustedRate ?? currentRate;
  const netDelta = finalRate - currentRate;
  const netPct = currentRate > 0 ? (netDelta / currentRate) * 100 : 0;
  // Only worth showing when the rules started from something other than the street rate.
  const showBaseRate = typeof baseRate === 'number' && baseRate > 0 && Math.round(baseRate) !== Math.round(currentRate);

  const openRuleInDesigner = (ruleId: string) => {
    setOpen(false);
    navigate(`/pricing-controls?editRule=${encodeURIComponent(ruleId)}&scrollTo=rules`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto sm:w-full">
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
                data-testid="button-recalculate-rate"
              >
                <RefreshCw className={`h-3 w-3 ${recalcStatus === 'running' ? 'animate-spin' : ''}`} />
                {recalcStatus === 'running' ? 'Recalculating…' : recalcStatus === 'done' ? 'Done — reopen to see updated rates' : 'Recalculate'}
              </Button>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            How the served rate for this {roomType} unit was reached, and the pricing rules behind it.
          </DialogDescription>
          {recalcStatus === 'error' && (
            <p className="text-xs text-red-600 mt-1">Recalculation failed. Please try again.</p>
          )}
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* ── Rate summary ─────────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Rate Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`grid grid-cols-1 gap-4 ${showBaseRate ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                <div>
                  <p className="text-xs text-muted-foreground">Street Rate</p>
                  <p className="text-lg font-bold" data-testid="text-street-rate">{fmt(currentRate)}</p>
                </div>
                {showBaseRate && (
                  <div>
                    <p className="text-xs text-muted-foreground">Base Rate</p>
                    <p className="text-lg font-bold">{fmt(baseRate!)}</p>
                    <p className="text-[11px] text-muted-foreground">what rules applied to</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">
                    {appliedNames.length > 0 ? 'Applied Rate' : 'Served Rate'}
                  </p>
                  <p className="text-lg font-bold text-primary" data-testid="text-applied-rate">{fmt(finalRate)}</p>
                  {netDelta !== 0 && (
                    <p className={`text-[11px] font-medium flex items-center gap-1 ${netDelta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {netDelta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {netDelta > 0 ? '+' : '−'}{fmt(Math.abs(netDelta))} ({netPct > 0 ? '+' : ''}{netPct.toFixed(1)}%) vs street rate
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Rules applied ────────────────────────────────────────────────── */}
          {appliedNames.length === 0 ? (
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <Settings className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">No pricing rules applied</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      No adjustment rule matched this unit in the last pricing run, so the street rate is served
                      unchanged. Add a rule in the Rule Designer to adjust it.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 h-7 text-xs gap-1.5"
                      onClick={() => { setOpen(false); navigate('/pricing-controls?scrollTo=rules'); }}
                      data-testid="button-open-rule-designer"
                    >
                      <Settings className="h-3 w-3" />
                      Open Rule Designer
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  Rules Applied
                  <Badge variant="secondary" className="text-[11px]">{appliedNames.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {appliedRuleDetails.map(({ name, rule, ambiguous, missing }, idx) => {
                  const adjustment = rule ? describeAdjustment(rule.action) : '';
                  const condition = rule ? describeTrigger(rule.trigger) : '';
                  const inactive = rule?.isActive === false;
                  return (
                    <div
                      key={`${name}-${idx}`}
                      className="rounded-md border border-gray-200 dark:border-gray-800 p-3"
                      data-testid={`rule-detail-${idx}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold break-words">{name}</span>
                            {adjustment && (
                              <Badge
                                variant="secondary"
                                className={adjustment.startsWith('+') ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}
                              >
                                {adjustment}
                              </Badge>
                            )}
                            {inactive && (
                              <Badge variant="secondary" className="text-amber-700 bg-amber-50">Turned off</Badge>
                            )}
                          </div>
                          {condition && (
                            <p className="text-xs text-muted-foreground mt-1">{condition}</p>
                          )}
                          {rule?.description && rule.description !== name && (
                            <p className="text-xs text-muted-foreground mt-1">{rule.description}</p>
                          )}
                          {rule?.effectiveDate && (
                            <p className="text-[11px] text-muted-foreground mt-1">
                              Effective {String(rule.effectiveDate).slice(0, 10)}
                            </p>
                          )}
                          {missing && (
                            <p className="text-xs text-amber-700 mt-1">
                              No rule with this name exists any more, so its definition can't be shown.
                            </p>
                          )}
                          {ambiguous && (
                            <p className="text-xs text-amber-700 mt-1">
                              More than one rule currently uses this name, so we can't tell which one produced this
                              rate. Open the Rule Designer to review them.
                            </p>
                          )}
                        </div>
                        {rule?.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs gap-1.5 shrink-0"
                            onClick={() => openRuleInDesigner(rule.id)}
                            data-testid={`button-edit-rule-${idx}`}
                          >
                            <Pencil className="h-3 w-3" />
                            Edit rule
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {showBaseRate && (
                  <p className="text-[11px] text-muted-foreground pt-1 flex items-center gap-1.5">
                    <ArrowRight className="h-3 w-3 shrink-0" />
                    Rules were applied to the base rate of {fmt(baseRate!)} from the last pricing run, which is why the
                    net change from the street rate differs from each rule's own adjustment.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Staleness, stated only when we are certain of it ─────────────── */}
          {staleRules.length > 0 && (
            <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                      {staleRules.length === 1
                        ? 'A rule behind this rate has changed since it was calculated'
                        : 'Rules behind this rate have changed since it was calculated'}
                    </p>
                    {deletedRules.length > 0 && (
                      <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">
                        No longer exists: {deletedRules.join(', ')}.
                      </p>
                    )}
                    {switchedOffRules.length > 0 && (
                      <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">
                        Turned off: {switchedOffRules.join(', ')}.
                      </p>
                    )}
                    <p className="text-xs text-amber-800 dark:text-amber-200 mt-1">
                      The rate above still reflects {staleRules.length === 1 ? 'it' : 'them'}. Recalculate to bring it
                      up to date.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
