import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Brain, Lightbulb, Filter, MapPin, Edit3, Save, X, RefreshCw, Clock, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const AI_INSIGHTS_FILTERS_KEY = 'ai-insights-filters';

const getInsightKey = (location: string, serviceLine: string) =>
  `ai-insights::${location}::${serviceLine}`;

interface StoredInsights {
  content: string;
  generatedAt: string;
  filters: { location: string; serviceLine: string };
}

const saveInsights = (insights: StoredInsights) => {
  try {
    const key = getInsightKey(insights.filters.location, insights.filters.serviceLine);
    localStorage.setItem(key, JSON.stringify(insights));
  } catch {}
};

const loadInsights = (location: string, serviceLine: string): StoredInsights | null => {
  try {
    const key = getInsightKey(location, serviceLine);
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  } catch { return null; }
};

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

export default function AiInsights() {
  const [suggestions, setSuggestions] = useState("AI insights will appear here after analysis...");
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("AI insights will appear here after analysis...");
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [selectedServiceLine, setSelectedServiceLine] = useState<string>("all");
  const [isHydrated, setIsHydrated] = useState(false);

  const { toast } = useToast();

  const { data: locationsData } = useQuery({ queryKey: ["/api/locations"] });
  const { data: authData } = useQuery({ queryKey: ["/api/auth/user"] });

  const locations = (locationsData?.locations?.map((loc: any) => loc.name) || []).sort((a: string, b: string) => a.localeCompare(b));
  const serviceLines = ["HC", "HC/MC", "AL", "AL/MC", "SL", "VIL"];

  const hasAnalysis = suggestions !== "AI insights will appear here after analysis..." && !suggestions.startsWith("Analyzing");

  useEffect(() => {
    const savedFilters = loadFilters();
    if (savedFilters) {
      setSelectedLocation(savedFilters.location || "all");
      setSelectedServiceLine(savedFilters.serviceLine || "all");
      const saved = loadInsights(savedFilters.location || "all", savedFilters.serviceLine || "all");
      if (saved) {
        setSuggestions(saved.content);
        setLastGeneratedAt(saved.generatedAt);
        setEditedContent(saved.content);
      }
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    if ((authData as any)?.clientId === 'demo' && selectedLocation === 'all') {
      setSelectedLocation('Albany - 215');
    }
  }, [isHydrated, (authData as any)?.clientId]);

  useEffect(() => {
    if (!isHydrated) return;
    saveFilters({ location: selectedLocation, serviceLine: selectedServiceLine });
    const saved = loadInsights(selectedLocation, selectedServiceLine);
    if (saved) {
      setSuggestions(saved.content);
      setLastGeneratedAt(saved.generatedAt);
      setEditedContent(saved.content);
    } else {
      setSuggestions("AI insights will appear here after analysis...");
      setLastGeneratedAt(null);
      setEditedContent("AI insights will appear here after analysis...");
    }
  }, [selectedLocation, selectedServiceLine, isHydrated]);

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
          const generatedAt = new Date().toISOString();
          setSuggestions(data.text);
          setLastGeneratedAt(generatedAt);
          setEditedContent(data.text);
          saveInsights({ content: data.text, generatedAt, filters: { location: selectedLocation, serviceLine: selectedServiceLine } });
          toast({ title: "Analysis Complete", description: "New insights generated successfully" });
        } else {
          setSuggestions(`Analysis failed: ${data.error || 'Unknown error'}`);
          toast({ title: "Analysis Failed", description: data.error || 'Unknown error', variant: "destructive" });
        }
      } catch (err: any) {
        const msg = err?.message || 'Failed to process response';
        setSuggestions(`Analysis failed: ${msg}`);
        toast({ title: "Analysis Failed", description: msg, variant: "destructive" });
      }
    },
    onError: (error: any) => {
      const msg = error?.message || 'Unknown error';
      setSuggestions(`Analysis failed: ${msg}`);
      toast({ title: "Analysis Failed", description: msg, variant: "destructive" });
    },
  });

  const handleGenerateInsights = () => {
    setSuggestions("Analyzing property data and market conditions...");
    aiSuggestMutation.mutate();
  };

  const handleEditClick = () => { setEditedContent(suggestions); setIsEditing(true); };

  const handleSaveEdit = () => {
    setSuggestions(editedContent);
    setIsEditing(false);
    const generatedAt = lastGeneratedAt || new Date().toISOString();
    saveInsights({ content: editedContent, generatedAt, filters: { location: selectedLocation, serviceLine: selectedServiceLine } });
    toast({ title: "Changes Saved", description: "Your edits have been saved locally" });
  };

  const handleCancelEdit = () => { setEditedContent(suggestions); setIsEditing(false); };

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
      <div className="flex items-center space-x-3 mb-6">
        <div className="w-10 h-10 bg-[var(--trilogy-navy)]/10 rounded-lg flex items-center justify-center">
          <Brain className="w-5 h-5 text-[var(--trilogy-navy)]" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-[var(--dashboard-text)]" data-testid="text-ai-insights-title">
            AI Insights & Analytics
          </h3>
          <p className="text-sm text-[var(--dashboard-muted)]">
            AI-powered analytics and predictive insights for pricing optimization
          </p>
        </div>
      </div>

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

            {/* Timestamp + Refresh row — shown when analysis exists */}
            {hasAnalysis && lastGeneratedAt && (
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Last run: <span className="font-medium text-slate-600">{formatTimestamp(lastGeneratedAt)}</span></span>
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

            {/* Primary Run Analysis button — shown when no analysis yet for this filter */}
            {!hasAnalysis && (
              <Button
                onClick={handleGenerateInsights}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white gap-2"
                disabled={aiSuggestMutation.isPending}
                data-testid="button-generate-insights"
              >
                <PlayCircle className="w-4 h-4" />
                {aiSuggestMutation.isPending ? "Analyzing…" : "Run Analysis"}
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
                    <Button size="sm" onClick={handleSaveEdit} data-testid="button-save-edit">
                      <Save className="w-4 h-4 mr-1" />Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="relative group" data-testid="text-smart-suggestions">
                  {renderFormattedInsights(suggestions)}
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
