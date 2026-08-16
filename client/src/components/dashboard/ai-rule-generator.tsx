import { useState, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sparkles, Target, Loader2, Save, Check, X, TrendingUp, TrendingDown, Pencil, History, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface TargetGrowth {
  HC: string;
  "HC/MC": string;
  AL: string;
  "AL/MC": string;
  SL: string;
  VIL: string;
}

interface RuleSuggestion {
  suggestionId: string;
  name: string;
  intent: string;
  description: string;
  ruleDetail: string;
  serviceLine: string;
  serviceLines?: string[];
  locationId: string | null;
  unitsImpacted: number | null;
  monthlyImpact: number | null;
  annualImpact: number | null;
  elasticity: number | null;
  elasticityMin: number | null;
  elasticityMax: number | null;
  elasticitySegments: number;
  daysToSellAfter: number | null;
  predictedDaysToSellChange: number | null;
  elasticitySampleSize: number | null;
  elasticityMonthlyImpact: number | null;
  elasticityAnnualImpact: number | null;
}

interface AiRuleGeneratorProps {
  locationId?: string;
  selectedServiceLine: string;
  selectedRegions: string[];
  selectedDivisions: string[];
  selectedLocations: string[];
  /** Load a suggestion into the Rule Designer's Natural Language editor for tweaking. */
  onEditSuggestion?: (s: { description: string; serviceLines?: string[] }) => void;
  /** Called after a suggestion is accepted and its rule created — lets the host refresh non-React-Query rule lists (e.g. Rule Administration). */
  onRuleAccepted?: () => void;
  /** When set, auto-generate suggestions focused on this recommendation text. */
  focus?: string | null;
  /** Called once the focus request has been kicked off (so the parent can clear it). */
  onFocusHandled?: () => void;
}

export default function AiRuleGenerator({
  locationId,
  selectedServiceLine,
  selectedRegions,
  selectedDivisions,
  selectedLocations,
  onEditSuggestion,
  onRuleAccepted,
  focus,
  onFocusHandled,
}: AiRuleGeneratorProps) {
  const { toast } = useToast();

  const [targetGrowth, setTargetGrowth] = useState<TargetGrowth>({
    HC: "3",
    "HC/MC": "3",
    AL: "5",
    "AL/MC": "5",
    SL: "4",
    VIL: "4",
  });
  const [suggestions, setSuggestions] = useState<RuleSuggestion[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [includeInHouse, setIncludeInHouse] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [restoredFromCache, setRestoredFromCache] = useState(false);
  const [restoredScope, setRestoredScope] = useState<string | null>(null);
  const [showLearningHistory, setShowLearningHistory] = useState(false);

  // What this run will analyze, in the user's own filter terms.
  const scopeSummary = useMemo(() => {
    const sl = selectedServiceLine === "All" ? "all service lines" : selectedServiceLine;
    let where = "all campuses";
    if (selectedLocations.length === 1) where = selectedLocations[0];
    else if (selectedLocations.length > 1) where = `${selectedLocations.length} campuses`;
    else if (selectedRegions.length) where = selectedRegions.join(", ");
    else if (selectedDivisions.length) where = selectedDivisions.join(", ");
    return `${sl} · ${where}`;
  }, [selectedServiceLine, selectedLocations, selectedRegions, selectedDivisions]);

  // Learning history: past Accept/Edit/Deny decisions that shape AI suggestions.
  const { data: learningHistory, isLoading: learningLoading } = useQuery<{
    entries: Array<{ id: number; verdict: 'accepted' | 'denied' | 'edited'; name: string | null; description: string | null; serviceLine: string | null; createdAt: string }>;
  }>({
    queryKey: ["/api/adjustment-rules/suggestions/feedback"],
    enabled: showLearningHistory,
  });

  const clearLearningMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/adjustment-rules/suggestions/feedback", "DELETE", { confirm: "clear-learning-history" });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/adjustment-rules/suggestions/feedback"] });
      toast({
        title: "Learning history cleared",
        description: `Removed ${data?.deleted ?? 0} past decision${data?.deleted === 1 ? '' : 's'}. The next suggestion run starts fresh.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to clear learning history",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Restore the last AI run (cached server-side) so suggestions survive reloads.
  const { data: lastRun } = useQuery<{ suggestions?: RuleSuggestion[]; generatedAt?: string; context?: { campus?: string | null } } | null>({
    queryKey: ["/api/adjustment-rules/suggest/last"],
    staleTime: Infinity,
  });
  useEffect(() => {
    if (hasGenerated || !lastRun?.suggestions?.length) return;
    setSuggestions(lastRun.suggestions);
    setGeneratedAt(lastRun.generatedAt ?? null);
    // The cached run was made under whatever filters were active at the time —
    // say which, so restored suggestions are never mistaken for the current scope.
    setRestoredScope(lastRun.context?.campus ?? null);
    setRestoredFromCache(true);
    setHasGenerated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRun]);

  // Build query string for fetching saved targets
  const targetsQueryParams = new URLSearchParams();
  if (selectedServiceLine !== "All") targetsQueryParams.set("serviceLine", selectedServiceLine);
  if (selectedRegions.length > 0) targetsQueryParams.set("regions", selectedRegions.join(","));
  if (selectedDivisions.length > 0) targetsQueryParams.set("divisions", selectedDivisions.join(","));
  if (selectedLocations.length > 0) targetsQueryParams.set("locations", selectedLocations.join(","));

  const { data: savedTargetsData } = useQuery<{
    targets: Record<string, string>;
    locationsMatched: number;
    hasData: boolean;
  }>({
    queryKey: ["/api/pricing/targets", targetsQueryParams.toString()],
    queryFn: async () => {
      const response = await fetch(`/api/pricing/targets?${targetsQueryParams.toString()}`);
      return response.json();
    },
  });

  useEffect(() => {
    if (savedTargetsData?.hasData && savedTargetsData.targets) {
      setTargetGrowth(prev => {
        const updated = { ...prev };
        for (const [sl, value] of Object.entries(savedTargetsData.targets)) {
          if (sl in updated) {
            updated[sl as keyof TargetGrowth] = value;
          }
        }
        return updated;
      });
    }
  }, [savedTargetsData]);

  const saveTargetsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/pricing/targets/save", "POST", {
        targets: targetGrowth,
        filters: {
          serviceLine: selectedServiceLine === "All" ? null : selectedServiceLine,
          regions: selectedRegions.length > 0 ? selectedRegions : null,
          divisions: selectedDivisions.length > 0 ? selectedDivisions : null,
          locations: selectedLocations.length > 0 ? selectedLocations : null,
        },
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Targets Saved",
        description: `Successfully saved targets for ${data.locationsAffected} location(s) and ${data.serviceLines.length} service line(s).`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Save Failed",
        description: error.message || "Failed to save revenue growth targets. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Generate AI rule suggestions to hit the revenue growth targets.
  const suggestRulesMutation = useMutation({
    mutationFn: async (focusText?: string) => {
      const targetSLs = (selectedServiceLine === "All"
        ? (["HC", "HC/MC", "AL", "AL/MC", "SL", "VIL"] as const)
        : [selectedServiceLine]) as Array<keyof TargetGrowth>;

      // Single combined request — the server analyzes all service lines
      // together and returns at most 10 rules total.
      const targets: Record<string, number> = {};
      for (const sl of targetSLs) {
        if (targetGrowth[sl]) targets[sl] = Number(targetGrowth[sl]);
      }
      const response = await apiRequest("/api/adjustment-rules/suggest", "POST", {
        locationId: locationId ?? null,
        // The page's campus filters scope the analysis the same way the service
        // line does — suggestions must only cover what the user is looking at.
        locations: selectedLocations,
        regions: selectedRegions,
        divisions: selectedDivisions,
        serviceLines: targetSLs,
        targets,
        includeInHouse,
        ...(focusText ? { focus: focusText } : {}),
      });
      const data = await response.json();
      return (data.suggestions || []) as RuleSuggestion[];
    },
    onSuccess: (data) => {
      setSuggestions(data);
      setHasGenerated(true);
      setGeneratedAt(new Date().toISOString());
      setRestoredFromCache(false);
      toast({
        title: data.length ? "Suggestions ready" : "No suggestions",
        description: data.length
          ? `AI proposed ${data.length} pricing rule${data.length > 1 ? 's' : ''}. Review and accept the ones you want.`
          : "AI did not return any rule suggestions for this scope. Try a different location or service line.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Suggestion Failed",
        description: error.message || "Failed to generate rule suggestions. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Auto-generate when the parent hands us a focus recommendation (e.g. the
  // "Draft rule" button on a strategy-overview recommendation bullet).
  useEffect(() => {
    if (focus && focus.trim() && !suggestRulesMutation.isPending) {
      suggestRulesMutation.mutate(focus.trim());
      onFocusHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Keep the React Query cache of the last run in sync with accept/deny so an
  // SPA remount can't restore a suggestion that was just removed.
  const removeFromLastRunCache = (suggestionId: string) => {
    queryClient.setQueryData<{ suggestions?: RuleSuggestion[] } | null>(
      ["/api/adjustment-rules/suggest/last"],
      (prev) => prev
        ? { ...prev, suggestions: (prev.suggestions ?? []).filter(x => x.suggestionId !== suggestionId) }
        : prev,
    );
  };

  const acceptSuggestionMutation = useMutation({
    mutationFn: async (s: RuleSuggestion) => {
      const response = await apiRequest("/api/adjustment-rules/suggestions/accept", "POST", {
        suggestionId: s.suggestionId,
        name: s.name,
        description: s.description,
        locationId: s.locationId ?? locationId ?? null,
        serviceLine: s.serviceLine,
        serviceLines: s.serviceLines ?? undefined,
      });
      return response.json();
    },
    onSuccess: (_data, s) => {
      setSuggestions(prev => prev.filter(x => x.suggestionId !== s.suggestionId));
      removeFromLastRunCache(s.suggestionId);
      queryClient.invalidateQueries({ queryKey: ["/api/adjustment-rules"], exact: false });
      onRuleAccepted?.();
      toast({
        title: "Rule created",
        description: `"${s.name}" was added to your rules.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Accept Failed",
        description: error.message || "Failed to create the rule. Please try again.",
        variant: "destructive",
      });
    },
  });

  const denySuggestionMutation = useMutation({
    mutationFn: async (s: RuleSuggestion) => {
      const response = await apiRequest("/api/adjustment-rules/suggestions/deny", "POST", {
        suggestionId: s.suggestionId,
      });
      return response.json();
    },
    onSuccess: (_data, s) => {
      setSuggestions(prev => prev.filter(x => x.suggestionId !== s.suggestionId));
      removeFromLastRunCache(s.suggestionId);
    },
  });

  const handleTargetChange = (serviceLine: keyof TargetGrowth, value: string) => {
    const numValue = value.replace(/[^0-9.]/g, '');
    if (numValue === '' || (parseFloat(numValue) >= 0 && parseFloat(numValue) <= 25)) {
      setTargetGrowth(prev => ({ ...prev, [serviceLine]: numValue }));
    }
  };

  return (
    <div className="space-y-6" data-testid="ai-rule-generator">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Target className="h-4 w-4 text-blue-600" />
          <h4 className="font-semibold text-foreground text-sm">Target Annual Revenue Growth</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Set your target annual revenue growth percentage for each service line. AI will suggest pricing rules to help achieve these targets — and it learns from your Accept/Edit/Deny decisions, so suggestions get better over time.
        </p>
      </div>

      {/* Target % inputs for each service line */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {(["HC", "HC/MC", "AL", "AL/MC", "SL", "VIL"] as const).map((sl) => {
          const isDisabled = selectedServiceLine !== "All" && selectedServiceLine !== sl;
          return (
            <div key={sl} className={`space-y-1.5 ${isDisabled ? 'opacity-50' : ''}`}>
              <label className="text-sm font-medium text-gray-700">{sl}</label>
              <div className="relative">
                <Input
                  type="text"
                  value={targetGrowth[sl]}
                  onChange={(e) => handleTargetChange(sl, e.target.value)}
                  disabled={isDisabled}
                  className="pr-8 text-right"
                  data-testid={`input-target-${sl.toLowerCase().replace('/', '-')}`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Save and Generate Buttons */}
      <div className="flex flex-col gap-4 pt-4 border-t border-gray-100">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => saveTargetsMutation.mutate()}
              disabled={saveTargetsMutation.isPending}
              data-testid="button-save-targets"
            >
              {saveTargetsMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Targets
                </>
              )}
            </Button>
            <Button
              onClick={() => suggestRulesMutation.mutate(undefined)}
              disabled={suggestRulesMutation.isPending}
              data-testid="button-suggest-rules"
            >
              {suggestRulesMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating Suggestions...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Suggest Rules with AI
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-gray-500">
            Save targets to persist them, or let AI propose pricing rules to reach your growth targets. Accepted suggestions become adjustment rules.
            {' '}Suggestions cover <span className="font-medium text-gray-700" data-testid="text-ai-scope">{scopeSummary}</span> — the page filters above.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <Checkbox
            checked={includeInHouse}
            onCheckedChange={(v) => setIncludeInHouse(v === true)}
            data-testid="checkbox-include-in-house"
          />
          Also suggest in-house rate increases (street-rate rules only by default)
        </label>
      </div>

      {/* AI Rule Suggestions */}
      {suggestRulesMutation.isPending && (
        <div className="p-6 bg-blue-50 rounded-lg border border-blue-100 flex items-center justify-center gap-3 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Analyzing your portfolio and drafting rule suggestions...
        </div>
      )}

      {!suggestRulesMutation.isPending && hasGenerated && suggestions.length === 0 && (
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-500" data-testid="text-no-suggestions">
          No rule suggestions were returned for this scope. Try a different location or service line, then click Suggest Rules again.
        </div>
      )}

      {suggestions.length > 0 && (
        <div data-testid="card-suggestions">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-blue-600" />
            <h4 className="font-semibold text-gray-900">AI-Suggested Rules</h4>
            <Badge variant="secondary" className="text-xs">{suggestions.length} pending</Badge>
            {generatedAt && (
              <span className="text-[11px] text-gray-400 ml-auto" data-testid="text-generated-at">
                {restoredFromCache ? `Restored from last run · ${restoredScope ? restoredScope + " · " : ""}` : ""}
                {new Date(generatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Each suggestion becomes an adjustment rule when accepted. Estimated impact is based on price elasticity.
            The AI learns from every Accept, Edit, and Deny — future suggestions are calibrated to your past decisions.
          </p>
          <div className="space-y-3">
            {suggestions.map((s) => {
              const monthly = s.monthlyImpact ?? 0;
              const annual = s.annualImpact ?? 0;
              const isPos = monthly >= 0;
              const isAccepting = acceptSuggestionMutation.isPending && acceptSuggestionMutation.variables?.suggestionId === s.suggestionId;
              const isDenying = denySuggestionMutation.isPending && denySuggestionMutation.variables?.suggestionId === s.suggestionId;
              const busy = isAccepting || isDenying;
              return (
                <div
                  key={s.suggestionId}
                  className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                  data-testid={`suggestion-${s.suggestionId}`}
                >
                  {/* Title + badge row (always full-width) */}
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900 leading-snug">{s.name}</span>
                    <Badge variant="outline" className="text-[10px] font-medium shrink-0">{s.serviceLine}</Badge>
                  </div>
                  {s.intent && <p className="text-xs text-gray-500 mt-1 leading-relaxed">{s.intent}</p>}
                  <p className="text-xs font-mono text-gray-700 bg-gray-50 border border-gray-100 rounded px-2 py-1.5 mt-2">{s.ruleDetail}</p>
                  {/* Action buttons — stack on mobile, row on sm+ */}
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {onEditSuggestion && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-gray-600 flex-1 sm:flex-none"
                        onClick={() => {
                          // Learning signal (fire-and-forget): editing means the
                          // suggestion was close but needed tweaks.
                          apiRequest("/api/adjustment-rules/suggestions/feedback", "POST", {
                            suggestionId: s.suggestionId,
                            verdict: "edited",
                          }).catch(() => {});
                          onEditSuggestion({ description: s.description, serviceLines: s.serviceLines ?? (s.serviceLine ? s.serviceLine.split(',').map(x => x.trim()).filter(Boolean) : undefined) });
                        }}
                        disabled={busy}
                        data-testid={`button-edit-${s.suggestionId}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="h-8 gap-1.5 bg-green-600 hover:bg-green-700 text-white flex-1 sm:flex-none"
                      onClick={() => acceptSuggestionMutation.mutate(s)}
                      disabled={busy}
                      data-testid={`button-accept-${s.suggestionId}`}
                    >
                      {isAccepting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-gray-600 flex-1 sm:flex-none"
                      onClick={() => denySuggestionMutation.mutate(s)}
                      disabled={busy}
                      data-testid={`button-deny-${s.suggestionId}`}
                    >
                      {isDenying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                      Deny
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                    <div className="rounded-md bg-gray-50 border border-gray-100 px-2.5 py-1.5 text-center">
                      <p className="text-sm font-semibold text-gray-900">{(s.unitsImpacted ?? 0).toLocaleString()}</p>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">Units</p>
                    </div>
                    <div className="rounded-md bg-gray-50 border border-gray-100 px-2.5 py-1.5 text-center">
                      <p className={`text-sm font-semibold inline-flex items-center justify-center gap-1 ${isPos ? 'text-green-700' : 'text-red-700'}`}>
                        {isPos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                        {isPos ? '+' : '-'}${Math.abs(Math.round(monthly)).toLocaleString()}
                      </p>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">Monthly</p>
                    </div>
                    <div className="rounded-md bg-gray-50 border border-gray-100 px-2.5 py-1.5 text-center">
                      <p className={`text-sm font-semibold ${annual >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        {annual >= 0 ? '+' : '-'}${Math.abs(Math.round(annual)).toLocaleString()}
                      </p>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">Annual</p>
                    </div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className={`rounded-md border px-2.5 py-1.5 text-center cursor-default ${
                            s.elasticity == null ? 'bg-gray-50 border-gray-100' :
                            s.elasticity <= -1.5  ? 'bg-emerald-50 border-emerald-200' :
                            s.elasticity < -0.5   ? 'bg-emerald-50/60 border-emerald-100' :
                            s.elasticity <= 0.5   ? 'bg-amber-50 border-amber-200' :
                                                    'bg-rose-50 border-rose-200'
                          }`}>
                            <p className={`text-sm font-semibold ${
                              s.elasticity == null ? 'text-gray-900' :
                              // Low-confidence (< 6 samples) overrides direction color with amber warning
                              (s.elasticitySampleSize != null && s.elasticitySampleSize < 6) ? 'text-amber-600' :
                              s.elasticity <= -1.5  ? 'text-emerald-700' :
                              s.elasticity < -0.5   ? 'text-emerald-600' :
                              s.elasticity <= 0.5   ? 'text-amber-600' :
                                                      'text-rose-600'
                            }`}>
                              {s.elasticity != null ? s.elasticity.toFixed(1) : '—'}
                            </p>
                            <p className="text-[10px] uppercase tracking-wide text-gray-400">
                              {s.elasticitySampleSize != null ? `Avg. Elast. (min ${s.elasticitySampleSize}mo)` : 'Avg. Elast.'}
                            </p>
                            {s.elasticityMin != null && s.elasticityMax != null && s.elasticityMin !== s.elasticityMax && (
                              <p className="text-[10px] text-gray-400 mt-0.5 whitespace-nowrap">
                                {s.elasticityMin.toFixed(1)} – {s.elasticityMax.toFixed(1)}
                              </p>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[260px] text-xs">
                          <p>Count-weighted average elasticity across the {s.unitsImpacted ?? 'affected'} unit{s.unitsImpacted === 1 ? '' : 's'} this rule would impact.
                          {s.elasticityMin != null && s.elasticityMax != null && s.elasticityMin !== s.elasticityMax
                            ? ` Range: ${s.elasticityMin.toFixed(1)} to ${s.elasticityMax.toFixed(1)} across ${s.elasticitySegments} segment${s.elasticitySegments === 1 ? '' : 's'} — a wide spread means the average may not describe any single segment well. Check Reference Data for per-segment values.`
                            : ' Segments with opposite signs can average toward zero — check Reference Data for per-segment values.'}
                          {s.elasticitySampleSize != null ? ` The least-observed segment has ${s.elasticitySampleSize} month${s.elasticitySampleSize === 1 ? '' : 's'} of history${s.elasticitySampleSize < 6 ? ' — too few for a stable reading, shown in amber' : ''}.` : ''}</p>
                          <p className="mt-1.5 font-semibold">Direction color scale:</p>
                          <ul className="mt-0.5 space-y-0.5">
                            <li><span className="text-emerald-700">Dark green</span> ≤ −1.5 — strongly elastic (healthy)</li>
                            <li><span className="text-emerald-600">Green</span> −1.5 to −0.5 — elastic (healthy)</li>
                            <li><span className="text-amber-600">Amber</span> −0.5 to +0.5 — near-zero (unusual)</li>
                            <li><span className="text-rose-600">Rose</span> &gt; +0.5 — positive (flag)</li>
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  {(s.daysToSellAfter != null || s.predictedDaysToSellChange != null) && (
                    <p className="text-[11px] text-gray-500 mt-2">
                      {s.daysToSellAfter != null && <>Projected days-to-sell: <span className="font-medium text-gray-700">{Math.round(s.daysToSellAfter)}</span> </>}
                      {s.predictedDaysToSellChange != null && (
                        <>({s.predictedDaysToSellChange >= 0 ? '+' : ''}{Math.round(s.predictedDaysToSellChange)} days vs. today)</>
                      )}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Learning history: what the AI has learned from past Accept/Edit/Deny decisions. */}
      <div className="border border-gray-200 rounded-lg" data-testid="card-learning-history">
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-3 text-left"
          onClick={() => setShowLearningHistory(v => !v)}
          data-testid="button-toggle-learning-history"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <History className="h-4 w-4 text-gray-500" />
            Learning history
            <span className="text-xs font-normal text-gray-400">— past decisions shaping AI suggestions</span>
          </span>
          {showLearningHistory ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
        </button>
        {showLearningHistory && (
          <div className="px-4 pb-4 space-y-3">
            {learningLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading learning history...
              </div>
            ) : !learningHistory?.entries?.length ? (
              <p className="text-sm text-gray-500 py-1" data-testid="text-no-learning-history">
                No learning history yet. Accept, edit, or deny AI suggestions and your decisions will appear here — the AI uses them to calibrate future suggestions.
              </p>
            ) : (
              <>
                <p className="text-xs text-gray-500">
                  The AI favors rules similar to accepted/edited ones and avoids re-proposing denied ones. Showing the {learningHistory.entries.length} most recent decisions.
                </p>
                {(['accepted', 'edited', 'denied'] as const).map((verdict) => {
                  const group = learningHistory.entries.filter(e => e.verdict === verdict);
                  if (!group.length) return null;
                  const styles = {
                    accepted: { label: 'Accepted', badge: 'bg-green-100 text-green-800' },
                    edited: { label: 'Edited', badge: 'bg-amber-100 text-amber-800' },
                    denied: { label: 'Denied', badge: 'bg-red-100 text-red-800' },
                  }[verdict];
                  return (
                    <div key={verdict} data-testid={`learning-group-${verdict}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge variant="secondary" className={`text-[10px] ${styles.badge}`}>{styles.label}</Badge>
                        <span className="text-xs text-gray-400">{group.length}</span>
                      </div>
                      <ul className="space-y-1">
                        {group.map((e) => (
                          <li key={e.id} className="text-xs text-gray-600 flex items-baseline gap-2" data-testid={`learning-entry-${e.id}`}>
                            <span className="text-gray-400 whitespace-nowrap">
                              {new Date(e.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                            {e.serviceLine && <span className="text-gray-400 whitespace-nowrap">[{e.serviceLine}]</span>}
                            <span className="truncate">{e.description || e.name || '—'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                      disabled={clearLearningMutation.isPending}
                      data-testid="button-clear-learning-history"
                    >
                      {clearLearningMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      Clear learning history
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Clear AI learning history?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes all {learningHistory.entries.length >= 40 ? '40+' : learningHistory.entries.length} recorded Accept/Edit/Deny decisions. The AI will stop calibrating suggestions to your past choices and start fresh on the next run. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel data-testid="button-cancel-clear-learning">Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-red-600 hover:bg-red-700"
                        onClick={() => clearLearningMutation.mutate()}
                        data-testid="button-confirm-clear-learning"
                      >
                        Clear history
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
