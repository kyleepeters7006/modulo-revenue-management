import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Filter, MapPin, Edit3, Save, X, RefreshCw, Clock, PlayCircle, MessageSquare, Send, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const AI_INSIGHTS_FILTERS_KEY = 'ai-insights-filters-v2';

const saveFilters = (filters: { location: string; serviceLine: string }) => {
  try { localStorage.setItem(AI_INSIGHTS_FILTERS_KEY, JSON.stringify(filters)); } catch {}
};

const loadFilters = (): { location: string; serviceLine: string } | null => {
  try {
    const stored = localStorage.getItem(AI_INSIGHTS_FILTERS_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
};

function renderInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const regex = /\*\*(.*?)\*\*/g;
  let lastIdx = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    parts.push(<strong key={match.index} className="font-semibold text-gray-900">{match[1]}</strong>);
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

function renderFormattedInsights(text: string) {
  // Transient states (loading, generating, failed) are rendered explicitly by
  // the caller rather than smuggled through this string, so no prefix sniffing
  // happens here — that used to misclassify any real analysis whose first word
  // matched a sentinel.
  if (!text) return null;

  const lines = text.split('\n');
  const elements: JSX.Element[] = [];
  let bulletGroup: string[] = [];

  const flushBullets = (key: string) => {
    if (bulletGroup.length === 0) return;
    elements.push(
      <ul key={key} className="list-disc pl-5 space-y-1 my-2">
        {bulletGroup.map((b, i) => (
          <li key={i} className="text-sm text-gray-700 leading-relaxed">{renderInline(b)}</li>
        ))}
      </ul>
    );
    bulletGroup = [];
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    if (!trimmed) {
      flushBullets(`flush-${idx}`);
      return;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ')) {
      bulletGroup.push(trimmed.slice(2));
      return;
    }

    flushBullets(`flush-${idx}`);

    const isHeader =
      trimmed.startsWith('#') ||
      (trimmed.endsWith(':') && trimmed.length < 80 && !trimmed.includes('.')) ||
      /^[A-Z][A-Z\s&\/\-:]{4,}$/.test(trimmed);

    if (isHeader) {
      const headerText = trimmed.replace(/^#+\s*/, '').replace(/:$/, '');
      elements.push(
        <h4 key={idx} className="font-bold text-gray-900 text-sm mt-5 mb-1 first:mt-0 border-b border-gray-200 pb-0.5">
          {renderInline(headerText)}
        </h4>
      );
      return;
    }

    elements.push(
      <p key={idx} className="text-sm text-gray-700 leading-relaxed my-1">
        {renderInline(trimmed)}
      </p>
    );
  });

  flushBullets('final');
  return <div className="space-y-0.5">{elements}</div>;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  suggestClearFilters?: boolean;
}

export default function AiInsights() {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [selectedServiceLine, setSelectedServiceLine] = useState<string>("all");
  const [isHydrated, setIsHydrated] = useState(false);
  // Generation failure is its own state. It used to be written into the
  // displayed text, which made a failed run suppress both the Run Analysis
  // button and the load-error banner, stranding the user with no action.
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: locationsData } = useQuery({ queryKey: ["/api/locations"] });

  const locationNames: string[] = ((locationsData as any)?.locations || [])
    .map((loc: any) => loc?.name)
    .filter((name: unknown): name is string => typeof name === 'string' && name.trim() !== '');
  const locations: string[] = Array.from(new Set(locationNames)).sort((a, b) => a.localeCompare(b));
  const serviceLines = ["HC", "HC/MC", "AL", "AL/MC", "SL", "VIL"];

  // Fetch persisted insight from DB.
  //
  // A failed read must not be reported as "no analysis exists". The tenant
  // middleware silently falls back to the demo client when a session cannot be
  // revalidated, so a dropped session returns a perfectly valid
  // `{ found: false }` for a scope whose analysis is sitting in the database
  // under the real tenant. Swallowing the HTTP status here made that
  // indistinguishable from a genuine empty state, and the offered remedy —
  // Run Analysis — spends a full AI run to rediscover work already done.
  const insightQueryKey = ["/api/ai/insights", selectedLocation, selectedServiceLine];
  const {
    data: insightData,
    isLoading: insightLoading,
    isError: insightFailed,
    error: insightError,
    refetch: refetchInsight,
    isFetching: insightFetching,
  } = useQuery({
    queryKey: insightQueryKey,
    queryFn: async () => {
      const loc = selectedLocation !== 'all' ? selectedLocation : 'all';
      const sl = selectedServiceLine !== 'all' ? selectedServiceLine : 'all';
      const res = await fetch(
        `/api/ai/insights?location=${encodeURIComponent(loc)}&serviceLine=${encodeURIComponent(sl)}`,
        { credentials: 'include' },
      );
      if (!res.ok) {
        throw new Error(
          res.status === 401 || res.status === 403
            ? 'Your session has expired. Sign in again to see your saved analysis.'
            : `Could not load the saved analysis (server returned ${res.status}).`,
        );
      }
      return res.json();
    },
    enabled: isHydrated,
  });

  // A row can exist with empty content. That is not an analysis, and treating
  // it as one left the card showing a placeholder with no way to act.
  const rawStored = insightData?.found ? insightData.content : null;
  const storedContent: string | null =
    typeof rawStored === 'string' && rawStored.trim() !== '' ? rawStored : null;
  const storedGeneratedAt: string | null = insightData?.found ? insightData.generatedAt : null;
  const hasAnalysis = !!storedContent;

  // The query is disabled until the saved filters are restored, and a disabled
  // query reports isLoading === false, so hydration has to be part of the
  // not-ready test or the never-run placeholder paints first.
  const notReady = !isHydrated || insightLoading;

  // A refetch keeps the previous data in cache, so a failure with content in
  // hand is a different screen from a failure with nothing: one can still show
  // the last known-good analysis, the other has nothing to show.
  const loadFailedWithoutCache = insightFailed && !hasAnalysis;
  const staleAfterFailedRefetch = insightFailed && hasAnalysis;

  // Only a read that actually succeeded and came back with nothing usable
  // proves this scope has no analysis. A failed or in-flight read proves
  // nothing. This covers both found:false and a stored row with empty content.
  const confirmedEmpty = !insightFailed && !notReady && !!insightData && !storedContent;

  const displayText = storedContent ?? "";

  // Generation is asynchronous and the filters are not. Every completion is
  // matched against the scope it was started for, so a run for one scope can
  // never report its result — or its failure — against another.
  const scopeKey = `${selectedLocation}||${selectedServiceLine}`;
  const currentScopeRef = useRef(scopeKey);
  useEffect(() => { currentScopeRef.current = scopeKey; }, [scopeKey]);

  // ── Hydration: restore filters from localStorage ──────────────────────────
  useEffect(() => {
    const savedFilters = loadFilters();
    if (savedFilters) {
      setSelectedLocation(savedFilters.location || "all");
      setSelectedServiceLine(savedFilters.serviceLine || "all");
    }
    setIsHydrated(true);
  }, []);

  // ── Persist filter changes & clear scope-specific state ───────────────────
  // A generation failure belongs to the scope it was attempted for; carrying
  // it across a filter change would report it against the wrong data.
  //
  // An open editor is abandoned for the same reason, and more urgently: the
  // draft is text for the old scope, but Save writes to whatever the filters
  // currently say, so keeping it would let one scope's edit overwrite
  // another's saved analysis.
  useEffect(() => {
    if (!isHydrated) return;
    saveFilters({ location: selectedLocation, serviceLine: selectedServiceLine });
    setGenerationError(null);
    setIsEditing(false);
    setEditedContent("");
  }, [selectedLocation, selectedServiceLine, isHydrated]);

  // ── Generate insights mutation ────────────────────────────────────────────
  type GenerationScope = { location: string; serviceLine: string };

  // The toast always fires — the run really did finish — but the inline error
  // is only shown when the filters still point at the scope that produced it.
  const reportGenerationFailure = (scope: GenerationScope, msg: string) => {
    if (`${scope.location}||${scope.serviceLine}` === currentScopeRef.current) {
      setGenerationError(msg);
    }
    toast({ title: "Analysis Failed", description: msg, variant: "destructive" });
  };

  const aiSuggestMutation = useMutation({
    mutationFn: async (scope: GenerationScope) => {
      return apiRequest('/api/ai/suggest', 'POST', {
        location: scope.location !== 'all' ? scope.location : undefined,
        serviceLine: scope.serviceLine !== 'all' ? scope.serviceLine : undefined
      });
    },
    onSuccess: async (response, scope) => {
      try {
        const data = await response.json();
        if (data.ok) {
          if (`${scope.location}||${scope.serviceLine}` === currentScopeRef.current) {
            setGenerationError(null);
          }
          // Invalidate the scope that was actually generated, not whatever the
          // filters happen to show now.
          await queryClient.invalidateQueries({
            queryKey: ["/api/ai/insights", scope.location, scope.serviceLine],
          });
          toast({ title: "Analysis Complete", description: "New insights generated successfully" });
        } else {
          reportGenerationFailure(scope, data.error || 'Unknown error');
        }
      } catch (err: any) {
        reportGenerationFailure(scope, err?.message || 'Failed to process response');
      }
    },
    onError: (error: any, scope) => {
      reportGenerationFailure(scope, error?.message || 'Unknown error');
    },
  });

  // A run started under different filters must not make this scope look busy.
  const generatingScope = aiSuggestMutation.variables;
  const isGeneratingThisScope = aiSuggestMutation.isPending
    && !!generatingScope
    && `${generatingScope.location}||${generatingScope.serviceLine}` === scopeKey;

  // ── Save edited content to DB ─────────────────────────────────────────────
  const saveEditMutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch('/api/ai/insights', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: selectedLocation !== 'all' ? selectedLocation : 'all',
          serviceLine: selectedServiceLine !== 'all' ? selectedServiceLine : 'all',
          content,
        }),
      });
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: insightQueryKey });
      setIsEditing(false);
      toast({ title: "Changes Saved", description: "Your edits have been saved" });
    },
    onError: () => {
      toast({ title: "Save Failed", description: "Could not save edits", variant: "destructive" });
    },
  });

  // ── Chat mutation ─────────────────────────────────────────────────────────
  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest('/api/ai/chat', 'POST', {
        message,
        location: selectedLocation !== 'all' ? selectedLocation : undefined,
        serviceLine: selectedServiceLine !== 'all' ? selectedServiceLine : undefined,
        history: chatMessages.slice(-8).map(m => ({ role: m.role, content: m.content })),
      });
      return res.json();
    },
    onSuccess: (data) => {
      setChatMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.reply, suggestClearFilters: data.suggestClearFilters },
      ]);
      setTimeout(() => {
        chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
      }, 50);
    },
    onError: (err: any) => {
      setChatMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ]);
    },
  });

  const handleSendChat = () => {
    const msg = chatInput.trim();
    if (!msg || chatMutation.isPending) return;
    setChatMessages(prev => [...prev, { role: 'user', content: msg }]);
    setChatInput('');
    setTimeout(() => {
      chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
    chatMutation.mutate(msg);
  };

  const handleGenerateInsights = () => {
    setGenerationError(null);
    aiSuggestMutation.mutate({ location: selectedLocation, serviceLine: selectedServiceLine });
  };

  const handleEditClick = () => { setEditedContent(displayText); setIsEditing(true); };
  const handleSaveEdit = () => saveEditMutation.mutate(editedContent);
  const handleCancelEdit = () => { setEditedContent(displayText); setIsEditing(false); };

  const getFilterDescription = () => {
    const parts = [];
    if (selectedLocation !== 'all') parts.push(selectedLocation);
    if (selectedServiceLine !== 'all') parts.push(selectedServiceLine);
    return parts.length > 0 ? parts.join(' • ') : 'All locations & service lines';
  };

  const formatTimestamp = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  return (
    <div className="dashboard-card mb-8">
      <div className="max-w-4xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Lightbulb className="w-5 h-5 text-blue-500" />
              <span>AI Recommendations</span>
            </CardTitle>
            <CardDescription>AI-powered insights and suggestions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <Filter className="w-4 h-4 text-slate-500 flex-shrink-0" />
              <span className="text-sm font-medium text-slate-600">Filters:</span>

              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger className="w-[200px]" data-testid="select-ai-location">
                  <MapPin className="w-4 h-4 mr-2 text-slate-400" />
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map((location: string) => (
                    <SelectItem key={location} value={location}>{location}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedServiceLine} onValueChange={setSelectedServiceLine}>
                <SelectTrigger className="w-[160px]" data-testid="select-ai-serviceline">
                  <SelectValue placeholder="All Service Lines" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Service Lines</SelectItem>
                  {serviceLines.map((sl) => (
                    <SelectItem key={sl} value={sl}>{sl}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* ── Chat Panel ─────────────────────────────────────────────────── */}
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              {/* Toggle button */}
              <button
                onClick={() => setChatOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                data-testid="button-toggle-chat"
              >
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-blue-500" />
                  <span className="text-sm font-medium text-slate-700">Ask AI about this data</span>
                  {chatMessages.length > 0 && (
                    <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">
                      {chatMessages.length} message{chatMessages.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                {chatOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </button>

              {chatOpen && (
                <div className="border-t border-slate-200">
                  {/* Context badge */}
                  <div className="px-4 pt-2.5 pb-1 text-xs text-slate-500 flex items-center gap-1.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
                    Responding with data for: <span className="font-medium text-slate-600">{getFilterDescription()}</span>
                  </div>

                  {/* Message history */}
                  <div
                    ref={chatScrollRef}
                    className="flex flex-col gap-3 px-4 py-3 max-h-80 overflow-y-auto"
                  >
                    {chatMessages.length === 0 && (
                      <p className="text-xs text-slate-400 italic text-center py-4">
                        Ask a question about occupancy, rates, competitors, or pricing strategy.
                      </p>
                    )}
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                            msg.role === 'user'
                              ? 'bg-blue-500 text-white rounded-br-sm'
                              : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                          }`}
                        >
                          {msg.role === 'assistant'
                            ? <div className="space-y-1">{renderFormattedInsights(msg.content)}</div>
                            : msg.content
                          }
                        </div>
                        {msg.suggestClearFilters && (
                          <div className="flex items-start gap-1.5 max-w-[85%] bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-500" />
                            <span>
                              For a full portfolio view, try setting both filters to <strong>All</strong> — this response is scoped to {getFilterDescription()}.
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                    {chatMutation.isPending && (
                      <div className="flex items-start">
                        <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                          <div className="flex gap-1 items-center h-4">
                            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Input bar */}
                  <div className="flex items-center gap-2 px-4 pb-3 pt-1 border-t border-slate-100">
                    <Input
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                      placeholder="Ask about rates, occupancy, competitors…"
                      className="flex-1 h-9 text-sm"
                      disabled={chatMutation.isPending}
                      data-testid="input-chat"
                    />
                    <Button
                      size="sm"
                      onClick={handleSendChat}
                      disabled={!chatInput.trim() || chatMutation.isPending}
                      className="h-9 w-9 p-0 bg-blue-500 hover:bg-blue-600"
                      data-testid="button-send-chat"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Load failure — reported, never downgraded into an empty state.
                With cached content in hand this is a staleness warning; with
                nothing cached it is the only thing standing between the user
                and a "you never ran this" screen that would be a lie. */}
            {insightFailed && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
                data-testid="banner-insights-load-failed"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1 text-amber-800">
                  <p className="text-sm font-medium">
                    {staleAfterFailedRefetch
                      ? "Couldn't refresh — showing the last copy loaded"
                      : "Couldn't load the saved analysis"}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed">
                    {(insightError as Error)?.message || 'The request failed.'}{' '}
                    {staleAfterFailedRefetch
                      ? `The analysis below may no longer be current for ${getFilterDescription()}.`
                      : `Anything already generated for ${getFilterDescription()} is still saved — this is a loading problem, not a missing result, so there is no need to re-run it.`}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchInsight()}
                  disabled={insightFetching}
                  className="h-7 flex-shrink-0 gap-1.5 text-xs"
                  data-testid="button-retry-insights"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${insightFetching ? 'animate-spin' : ''}`} />
                  {insightFetching ? 'Retrying…' : 'Retry'}
                </Button>
              </div>
            )}

            {/* Generation failure — kept separate from the load failure so it
                never suppresses the controls that let the user try again. */}
            {generationError && !isGeneratingThisScope && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5"
                data-testid="banner-generation-failed"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                <div className="min-w-0 flex-1 text-red-800">
                  <p className="text-sm font-medium">Analysis failed</p>
                  <p className="mt-0.5 text-xs leading-relaxed">{generationError}</p>
                </div>
              </div>
            )}

            {/* Timestamp + Refresh row — shown when analysis exists */}
            {hasAnalysis && storedGeneratedAt && (
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Last run: <span className="font-medium text-slate-600">{formatTimestamp(storedGeneratedAt)}</span></span>
                  <span className="text-slate-300 mx-1">|</span>
                  <span className="text-slate-400">{getFilterDescription()}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateInsights}
                  disabled={aiSuggestMutation.isPending}
                  className="h-7 text-xs gap-1.5"
                  data-testid="button-refresh-insights"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingThisScope ? 'animate-spin' : ''}`} />
                  {isGeneratingThisScope ? 'Refreshing…' : 'Refresh'}
                </Button>
              </div>
            )}

            {/* Primary Run Analysis button — only once a successful read has
                confirmed this scope genuinely has no stored analysis. It stays
                visible after a failed run so a first-time user is never left
                without an action. */}
            {confirmedEmpty && (
              <Button
                onClick={handleGenerateInsights}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white gap-2"
                disabled={aiSuggestMutation.isPending}
                data-testid="button-generate-insights"
              >
                <PlayCircle className="w-4 h-4" />
                {isGeneratingThisScope ? "Analyzing…" : "Run Analysis"}
              </Button>
            )}

            {/* Analysis content. Hidden only when a failed initial load left
                nothing to show — the banner above owns that state, and the
                never-run placeholder would contradict it. */}
            {!(loadFailedWithoutCache && !isGeneratingThisScope) && (
            <div className="p-4 bg-[var(--dashboard-bg)] rounded-lg border border-[var(--dashboard-border)]">
              {isEditing ? (
                <div className="space-y-3">
                  <Textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="min-h-[200px] text-xs font-mono"
                    data-testid="textarea-edit-insights"
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={handleCancelEdit} data-testid="button-cancel-edit">
                      <X className="w-4 h-4 mr-1" />Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveEdit} disabled={saveEditMutation.isPending} data-testid="button-save-edit">
                      <Save className="w-4 h-4 mr-1" />{saveEditMutation.isPending ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </div>
              ) : notReady ? (
                <p role="status" className="text-sm text-gray-500 italic" data-testid="text-insights-loading">
                  Loading saved analysis…
                </p>
              ) : isGeneratingThisScope ? (
                <p role="status" className="text-sm text-gray-500 italic" data-testid="text-insights-generating">
                  Analyzing property data and market conditions…
                </p>
              ) : !hasAnalysis ? (
                <p className="text-sm text-gray-500 italic" data-testid="text-smart-suggestions">
                  AI insights will appear here after analysis...
                </p>
              ) : (
                <div className="relative group" data-testid="text-smart-suggestions">
                  {renderFormattedInsights(displayText)}
                  {hasAnalysis && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={handleEditClick}
                      data-testid="button-edit-insights"
                    >
                      <Edit3 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
            )}

          </CardContent>
        </Card>
      </div>
    </div>
  );
}
