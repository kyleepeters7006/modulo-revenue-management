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

/**
 * What happened to the rules the AI drafted but never showed. Without this the
 * run silently reads as "the AI didn't find much", which hides both a weak
 * scope and a broken suggestion prompt behind the same empty-looking result.
 */
interface SuggestionDiagnostics {
  drafted: number;
  shown: number;
  dropped: number;
  overCap: number;
  byReason: Array<{ code: string; label: string; count: number; examples: string[] }>;
  driftWarning: string | null;
  summary: string | null;
}

/**
 * Which model actually wrote these rules. The server falls back to a different
 * model whenever the primary one fails, so "the AI suggested this" is not a
 * specific enough provenance for a pricing change someone is about to approve.
 */
interface SuggestionModelInfo {
  name: string;
  usedFallback: boolean;
  fallbackReason: string | null;
  elapsedMs?: number;
}

interface SuggestRunResponse {
  suggestions?: RuleSuggestion[];
  diagnostics?: SuggestionDiagnostics | null;
  model?: SuggestionModelInfo | null;
  context?: { campus?: string | null; reason?: string | null; reasonMessage?: string | null } | null;
}

/** A failed run needs to stay on the page; a toast that fades leaves nothing to act on. */
interface RunFailure {
  title: string;
  message: string;
  /** True when the run stopped because it ran out of time rather than erroring. */
  timedOut: boolean;
}

// Hard stop on the client. The server gives up at 3 minutes and returns a
// specific message, so this only fires when the socket itself is dead and no
// response is ever coming.
const CLIENT_RUN_TIMEOUT_MS = 300_000;
// Past this, the run is outside its normal range and the operator deserves to
// be told rather than left guessing whether it is stuck.
const RUN_SLOW_AFTER_MS = 120_000;

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

/** Turn apiRequest's "<status>: <raw JSON body>" into something readable. */
function readRunError(error: any): RunFailure {
  const raw: string = error?.message ?? '';
  const timedOut = error?.name === 'TimeoutError' || raw.startsWith('504');
  const body = raw.slice(raw.indexOf(':') + 1).trim();
  let message = raw || 'The suggestion run failed.';
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error) {
      message = String(parsed.error);
      if (parsed.detail) message += ` (${parsed.detail})`;
    }
  } catch {
    // Not JSON — a network-level failure. The raw text is all there is.
    if (error?.name === 'TimeoutError') {
      message = 'The run did not finish within 5 minutes and was stopped. Narrow the scope to a region or a single campus and try again.';
    }
  }
  return { title: timedOut ? 'Suggestion run timed out' : 'Suggestion run failed', message, timedOut };
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
  const [diagnostics, setDiagnostics] = useState<SuggestionDiagnostics | null>(null);
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const [showDroppedDetail, setShowDroppedDetail] = useState(false);
  const [modelInfo, setModelInfo] = useState<SuggestionModelInfo | null>(null);
  const [runError, setRunError] = useState<RunFailure | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  // Aborting rejects a fetch that is still in flight, but a response that has
  // already arrived will settle regardless. Each run therefore carries an id,
  // and only the run that is still current is allowed to write to the panel —
  // otherwise a cancel could be overwritten a moment later by the very results
  // the operator just declined to wait for.
  const runSeqRef = useRef(0);
  const currentRunRef = useRef<number | null>(null);

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
  const { data: lastRun } = useQuery<(SuggestRunResponse & { generatedAt?: string }) | null>({
    queryKey: ["/api/adjustment-rules/suggest/last"],
    staleTime: Infinity,
  });
  useEffect(() => {
    if (hasGenerated || !lastRun) return;
    // An empty cached run still has something to say — a run where every
    // drafted rule was rejected is the outcome most worth explaining, and it
    // must not go silent on reload. `context.reason` is only set when the run
    // produced nothing at generation time, so a run whose cards were merely
    // accepted or denied away is correctly left unrestored.
    const wasExplainedEmpty = !!lastRun.context?.reason;
    if (!lastRun.suggestions?.length && !wasExplainedEmpty) return;
    setSuggestions(lastRun.suggestions ?? []);
    setGeneratedAt(lastRun.generatedAt ?? null);
    // The cached run was made under whatever filters were active at the time —
    // say which, so restored suggestions are never mistaken for the current scope.
    setRestoredScope(lastRun.context?.campus ?? null);
    // A restored run must carry its drop tally too, or reloading the page turns
    // "3 of 10 shown" back into a bare 3.
    setDiagnostics(lastRun.diagnostics ?? null);
    setEmptyMessage(lastRun.context?.reasonMessage ?? null);
    // Attribution has to survive the reload too — otherwise a run written by
    // the fallback model looks, after a refresh, exactly like one written by Opus.
    setModelInfo(lastRun.model ?? null);
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
      // One controller per run: the operator's Cancel button aborts it, and a
      // hard timeout aborts it too, so a dead socket can never park the UI on
      // an indeterminate spinner forever.
      const controller = new AbortController();
      abortRef.current = controller;
      const runId = ++runSeqRef.current;
      currentRunRef.current = runId;
      const timeoutId = window.setTimeout(
        () => controller.abort(new DOMException('Run exceeded the client timeout', 'TimeoutError')),
        CLIENT_RUN_TIMEOUT_MS,
      );
      try {
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
        }, { signal: controller.signal });
        return { ...(await response.json()), __runId: runId } as SuggestRunResponse & { __runId: number };
      } finally {
        window.clearTimeout(timeoutId);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    onSuccess: (data: SuggestRunResponse & { __runId?: number }) => {
      // A cancelled or superseded run has no claim on the panel any more.
      if (data.__runId !== currentRunRef.current) return;
      currentRunRef.current = null;
      const list = data.suggestions ?? [];
      const diag = data.diagnostics ?? null;
      setSuggestions(list);
      setDiagnostics(diag);
      setModelInfo(data.model ?? null);
      setEmptyMessage(data.context?.reasonMessage ?? null);
      setRunError(null);
      setShowDroppedDetail(false);
      setHasGenerated(true);
      setGeneratedAt(new Date().toISOString());
      setRestoredFromCache(false);
      toast({
        title: list.length ? "Suggestions ready" : "No suggestions",
        description: list.length
          ? `AI proposed ${list.length} pricing rule${list.length > 1 ? 's' : ''}.` +
            (diag?.dropped ? ` ${diag.dropped} more could not be turned into enforceable rules.` : '') +
            ' Review and accept the ones you want.'
          // Each empty-result cause implies a different next step, so say which
          // one happened rather than always suggesting a different filter.
          : (data.context?.reasonMessage
            ?? "AI did not return any rule suggestions for this scope. Try a different location or service line."),
      });
    },
    onError: (error: any) => {
      // Cancelling is a choice, not a failure: cancelRun has already
      // acknowledged it, and the existing suggestions, diagnostics and
      // attribution are deliberately left exactly as they were.
      if (currentRunRef.current === null || error?.name === 'AbortError') return;
      currentRunRef.current = null;
      const failure = readRunError(error);
      // A failed re-run must not destroy what is already on screen. The server
      // does not overwrite its cached run on failure either, so the panel and
      // the cache stay in agreement.
      setRunError(failure);
      toast({ title: failure.title, description: failure.message, variant: "destructive" });
    },
  });

  const isRunning = suggestRulesMutation.isPending;

  // Elapsed time is the minimum honest progress signal available for a single
  // non-streaming call: it cannot say how far along the model is, but it does
  // tell the operator the run is alive and how long they have been waiting.
  useEffect(() => {
    if (!isRunning) { setElapsedMs(0); return; }
    const startedAt = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  // A run left in flight by an unmounting panel has nobody to return to.
  useEffect(() => () => abortRef.current?.abort(), []);

  const cancelRun = () => {
    // Retire the run id first: a response already on the wire must not be able
    // to land after the operator has said stop. Acknowledge immediately rather
    // than waiting for the fetch rejection to travel back.
    currentRunRef.current = null;
    abortRef.current?.abort();
    toast({ title: "Run cancelled", description: "Your previous suggestions are still here." });
  };

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
      // apiRequest throws "<status>: <raw body>", and the body is JSON, so show
      // the server's sentence rather than the serialized object.
      const raw: string = error?.message ?? "";
      let description = raw || "Failed to create the rule. Please try again.";
      const body = raw.slice(raw.indexOf(":") + 1).trim();
      try {
        const parsedBody = JSON.parse(body);
        if (parsedBody?.error) description = String(parsedBody.error);
      } catch { /* not JSON — keep the raw message */ }
      toast({
        title: "Accept Failed",
        description,
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
      {isRunning && (
        <div
          className="p-4 bg-blue-50 rounded-lg border border-blue-100 text-sm text-blue-800"
          data-testid="status-suggest-running"
        >
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <div className="flex-1 min-w-0">
              <p className="font-medium">
                Analyzing {scopeSummary} and drafting rule suggestions…
              </p>
              {/* Elapsed time plus the normal range: without the range a
                  counter alone still can't tell the operator whether 90
                  seconds is fine or a sign that nothing is coming back. */}
              <p className="text-xs text-blue-700/80 mt-0.5" data-testid="text-run-elapsed">
                {formatElapsed(elapsedMs)} elapsed · a run usually takes 30–90 seconds
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={cancelRun}
              className="shrink-0 border-blue-300 bg-white text-blue-800 hover:bg-blue-100"
              data-testid="button-cancel-suggest"
            >
              <X className="h-3.5 w-3.5 mr-1.5" />
              Cancel
            </Button>
          </div>
          {elapsedMs >= RUN_SLOW_AFTER_MS && (
            <p className="mt-2 text-xs text-blue-900" data-testid="text-run-slow">
              This is taking longer than usual for this scope. It will stop on its own if the
              AI doesn't answer — you can cancel now and narrow to a region or a single campus.
            </p>
          )}
        </div>
      )}

      {/* A failed run has to leave something behind. The toast is gone in
          seconds, and the operator needs to know why they are looking at the
          previous run's cards rather than new ones. */}
      {!isRunning && runError && (
        <div
          className="p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-900"
          data-testid="text-run-error"
        >
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <p className="font-medium">{runError.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-red-800">{runError.message}</p>
              {suggestions.length > 0 && (
                <p className="mt-1 text-xs text-red-800/80">
                  The suggestions below are from the previous run and were left untouched.
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => suggestRulesMutation.mutate(undefined)}
                className="border-red-300 bg-white text-red-800 hover:bg-red-100"
                data-testid="button-retry-suggest"
              >
                Try again
              </Button>
              <button
                type="button"
                onClick={() => setRunError(null)}
                className="text-red-700/70 hover:text-red-900"
                aria-label="Dismiss error"
                data-testid="button-dismiss-run-error"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* When a run just failed, the error banner is the current truth — the
          stale "no suggestions for this scope" reason from an earlier run would
          contradict it. */}
      {!isRunning && !runError && hasGenerated && suggestions.length === 0 && (
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-500" data-testid="text-no-suggestions">
          {/* The four empty-result causes need four different next steps — a
              scope that matched no campuses is not the same as a run where the
              AI drafted rules that all failed the enforceability gate. */}
          {emptyMessage
            ?? "No rule suggestions were returned for this scope. Try a different location or service line, then click Suggest Rules again."}
          {!!diagnostics?.dropped && (
            <span className="block mt-2 text-gray-600" data-testid="text-no-suggestions-dropped">
              The AI drafted {diagnostics.drafted} rule{diagnostics.drafted === 1 ? '' : 's'}, but{' '}
              {diagnostics.dropped === diagnostics.drafted ? 'none' : `${diagnostics.dropped}`} could be used.
            </span>
          )}
          {diagnostics?.driftWarning && (
            <span className="block mt-2 text-amber-700" data-testid="text-no-suggestions-drift">
              {diagnostics.driftWarning}
            </span>
          )}
        </div>
      )}

      {suggestions.length > 0 && (
        <div data-testid="card-suggestions">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-blue-600" />
            <h4 className="font-semibold text-gray-900">AI-Suggested Rules</h4>
            <Badge variant="secondary" className="text-xs">{suggestions.length} pending</Badge>
            {/* Which model wrote these. Called out only when it was NOT the
                model we intended — a silent fallback is the case where the
                operator's expectation and reality diverge. */}
            {modelInfo?.usedFallback && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="text-[10px] font-medium border-amber-300 bg-amber-50 text-amber-900 cursor-help"
                      data-testid="badge-model-fallback"
                    >
                      Written by {modelInfo.name}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    The primary model was unavailable{modelInfo.fallbackReason ? ` (${modelInfo.fallbackReason})` : ''},
                    so these rules were drafted by the fallback model. They may differ in quality from a normal run.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {generatedAt && (
              <span className="text-[11px] text-gray-400 ml-auto" data-testid="text-generated-at">
                {restoredFromCache ? `Restored from last run · ${restoredScope ? restoredScope + " · " : ""}` : ""}
                {new Date(generatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {modelInfo && !modelInfo.usedFallback && (
                  <span data-testid="text-model-name"> · {modelInfo.name}</span>
                )}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Each suggestion becomes an adjustment rule when accepted. Estimated impact is based on price elasticity.
            The AI learns from every Accept, Edit, and Deny — future suggestions are calibrated to your past decisions.
          </p>

          {/* Drafted-but-dropped tally. Stated plainly and once; the per-reason
              breakdown stays behind a disclosure so the raw parser wording never
              becomes the headline. */}
          {!!diagnostics?.dropped && (
            <div
              className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              data-testid="text-dropped-summary"
            >
              <div className="flex items-start gap-2">
                <span className="flex-1">
                  {diagnostics.summary
                    ?? `Showing ${diagnostics.shown} of ${diagnostics.drafted} drafted — ${diagnostics.dropped} could not be turned into an enforceable pricing rule.`}
                </span>
                <button
                  type="button"
                  className="shrink-0 font-medium underline underline-offset-2 hover:text-amber-950"
                  onClick={() => setShowDroppedDetail(v => !v)}
                  data-testid="button-toggle-dropped-detail"
                >
                  {showDroppedDetail ? 'Hide' : 'Why?'}
                </button>
              </div>
              {diagnostics.driftWarning && (
                <p className="mt-1.5 font-medium" data-testid="text-drift-warning">
                  {diagnostics.driftWarning}
                </p>
              )}
              {showDroppedDetail && (
                <ul className="mt-2 space-y-1.5" data-testid="list-dropped-reasons">
                  {diagnostics.byReason.map(r => (
                    <li key={r.code}>
                      <span className="font-medium">{r.count}×</span> {r.label}
                      {r.examples.length > 0 && (
                        <span className="mt-0.5 block font-mono text-[10px] leading-relaxed text-amber-800/80">
                          {r.examples.map((ex, i) => <span key={i} className="block truncate">“{ex}”</span>)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
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
                            s.elasticity >= 1.5   ? 'bg-emerald-50 border-emerald-200' :
                            s.elasticity > 0.5    ? 'bg-emerald-50/60 border-emerald-100' :
                            s.elasticity >= -0.5  ? 'bg-amber-50 border-amber-200' :
                                                    'bg-rose-50 border-rose-200'
                          }`}>
                            <p className={`text-sm font-semibold ${
                              s.elasticity == null ? 'text-gray-900' :
                              // Low-confidence (< 6 samples) overrides direction color with amber warning
                              (s.elasticitySampleSize != null && s.elasticitySampleSize < 6) ? 'text-amber-600' :
                              s.elasticity >= 1.5   ? 'text-emerald-700' :
                              s.elasticity > 0.5    ? 'text-emerald-600' :
                              s.elasticity >= -0.5  ? 'text-amber-600' :
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
                            <li><span className="text-emerald-700">Dark green</span> ≥ +1.5 — strongly elastic (normal)</li>
                            <li><span className="text-emerald-600">Green</span> +0.5 to +1.5 — elastic (normal)</li>
                            <li><span className="text-amber-600">Amber</span> −0.5 to +0.5 — weak signal</li>
                            <li><span className="text-rose-600">Rose</span> &lt; −0.5 — counter-intuitive (flag)</li>
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
