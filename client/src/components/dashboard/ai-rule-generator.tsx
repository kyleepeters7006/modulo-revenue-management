import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sparkles, Target, Loader2, Save, Check, X, TrendingUp, TrendingDown, Pencil } from "lucide-react";
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
  daysToSellAfter: number | null;
  predictedDaysToSellChange: number | null;
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
}

export default function AiRuleGenerator({
  locationId,
  selectedServiceLine,
  selectedRegions,
  selectedDivisions,
  selectedLocations,
  onEditSuggestion,
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

  // Restore the last AI run (cached server-side) so suggestions survive reloads.
  const { data: lastRun } = useQuery<{ suggestions?: RuleSuggestion[]; generatedAt?: string } | null>({
    queryKey: ["/api/adjustment-rules/suggest/last"],
    staleTime: Infinity,
  });
  useEffect(() => {
    if (hasGenerated || !lastRun?.suggestions?.length) return;
    setSuggestions(lastRun.suggestions);
    setGeneratedAt(lastRun.generatedAt ?? null);
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
    mutationFn: async () => {
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
        serviceLines: targetSLs,
        targets,
        includeInHouse,
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
          Set your target annual revenue growth percentage for each service line. AI will suggest pricing rules to help achieve these targets.
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
              onClick={() => suggestRulesMutation.mutate()}
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
                {restoredFromCache ? "Restored from last run · " : ""}
                {new Date(generatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Each suggestion becomes an adjustment rule when accepted. Estimated impact is based on price elasticity.
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
                        onClick={() => onEditSuggestion({ description: s.description, serviceLines: s.serviceLines ?? (s.serviceLine ? s.serviceLine.split(',').map(x => x.trim()).filter(Boolean) : undefined) })}
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
                    <div className="rounded-md bg-gray-50 border border-gray-100 px-2.5 py-1.5 text-center">
                      <p className="text-sm font-semibold text-gray-900">{s.elasticity != null ? s.elasticity.toFixed(1) : '—'}</p>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">Elasticity</p>
                    </div>
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
    </div>
  );
}
