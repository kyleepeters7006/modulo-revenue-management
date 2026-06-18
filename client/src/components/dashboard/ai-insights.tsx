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
  const placeholder = !text
    || text === "AI insights will appear here after analysis..."
    || text.startsWith("Analyzing")
    || text.startsWith("Analysis failed");

  if (placeholder) {
    return <p className="text-sm text-gray-500 italic">{text}</p>;
  }

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
  const [pendingText, setPendingText] = useState<string | null>(null);

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

  // Fetch persisted insight from DB
  const insightQueryKey = ["/api/ai/insights", selectedLocation, selectedServiceLine];
  const { data: insightData, isLoading: insightLoading } = useQuery({
    queryKey: insightQueryKey,
    queryFn: async () => {
      const loc = selectedLocation !== 'all' ? selectedLocation : 'all';
      const sl = selectedServiceLine !== 'all' ? selectedServiceLine : 'all';
      const res = await fetch(`/api/ai/insights?location=${encodeURIComponent(loc)}&serviceLine=${encodeURIComponent(sl)}`);
      return res.json();
    },
    enabled: isHydrated,
  });

  const storedContent: string | null = insightData?.found ? insightData.content : null;
  const storedGeneratedAt: string | null = insightData?.found ? insightData.generatedAt : null;

  // Displayed content: pending (optimistic) → DB → placeholder
  const displayText = pendingText
    ?? storedContent
    ?? "AI insights will appear here after analysis...";

  const hasAnalysis = !!storedContent && !pendingText?.startsWith("Analyzing");

  // ── Hydration: restore filters from localStorage ──────────────────────────
  useEffect(() => {
    const savedFilters = loadFilters();
    if (savedFilters) {
      setSelectedLocation(savedFilters.location || "all");
      setSelectedServiceLine(savedFilters.serviceLine || "all");
    }
    setIsHydrated(true);
  }, []);

  // ── Persist filter changes & clear optimistic state ───────────────────────
  useEffect(() => {
    if (!isHydrated) return;
    saveFilters({ location: selectedLocation, serviceLine: selectedServiceLine });
    setPendingText(null);
  }, [selectedLocation, selectedServiceLine, isHydrated]);

  // ── Generate insights mutation ────────────────────────────────────────────
  const aiSuggestMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('/api/ai/suggest', 'POST', {
        location: selectedLocation !== 'all' ? selectedLocation : undefined,
        serviceLine: selectedServiceLine !== 'all' ? selectedServiceLine : undefined
      });
    },
    onSuccess: async (response) => {
      try {
        const data = await response.json();
        if (data.ok) {
          setPendingText(null);
          // Invalidate DB cache so it re-fetches the newly saved insight
          await queryClient.invalidateQueries({ queryKey: insightQueryKey });
          toast({ title: "Analysis Complete", description: "New insights generated successfully" });
        } else {
          setPendingText(`Analysis failed: ${data.error || 'Unknown error'}`);
          toast({ title: "Analysis Failed", description: data.error || 'Unknown error', variant: "destructive" });
        }
      } catch (err: any) {
        const msg = err?.message || 'Failed to process response';
        setPendingText(`Analysis failed: ${msg}`);
        toast({ title: "Analysis Failed", description: msg, variant: "destructive" });
      }
    },
    onError: (error: any) => {
      const msg = error?.message || 'Unknown error';
      setPendingText(`Analysis failed: ${msg}`);
      toast({ title: "Analysis Failed", description: msg, variant: "destructive" });
    },
  });

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
    setPendingText("Analyzing property data and market conditions...");
    aiSuggestMutation.mutate();
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
                  <RefreshCw className={`w-3.5 h-3.5 ${aiSuggestMutation.isPending ? 'animate-spin' : ''}`} />
                  {aiSuggestMutation.isPending ? 'Refreshing…' : 'Refresh'}
                </Button>
              </div>
            )}

            {/* Primary Run Analysis button — shown when no stored analysis for this filter */}
            {!hasAnalysis && !pendingText && (
              <Button
                onClick={handleGenerateInsights}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white gap-2"
                disabled={aiSuggestMutation.isPending || insightLoading}
                data-testid="button-generate-insights"
              >
                <PlayCircle className="w-4 h-4" />
                {insightLoading ? "Loading…" : aiSuggestMutation.isPending ? "Analyzing…" : "Run Analysis"}
              </Button>
            )}

            {/* Analysis content */}
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

          </CardContent>
        </Card>
      </div>
    </div>
  );
}
