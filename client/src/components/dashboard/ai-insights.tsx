import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Brain, Upload, Lightbulb, Activity, Filter, MapPin, Edit3, Save, X } from "lucide-react";
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

const AI_INSIGHTS_STORAGE_KEY = 'ai-insights-content';
const AI_INSIGHTS_FILTERS_KEY = 'ai-insights-filters';

interface StoredInsights {
  content: string;
  generatedAt: string;
  filters: {
    location: string;
    serviceLine: string;
  };
}

const saveInsightsToStorage = (insights: StoredInsights) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AI_INSIGHTS_STORAGE_KEY, JSON.stringify(insights));
  } catch (error) {
    console.warn('Failed to save AI insights to localStorage:', error);
  }
};

const loadInsightsFromStorage = (): StoredInsights | null => {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(AI_INSIGHTS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.warn('Failed to load AI insights from localStorage:', error);
    return null;
  }
};

const saveFiltersToStorage = (filters: { location: string; serviceLine: string }) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AI_INSIGHTS_FILTERS_KEY, JSON.stringify(filters));
  } catch (error) {
    console.warn('Failed to save filters to localStorage:', error);
  }
};

const loadFiltersFromStorage = (): { location: string; serviceLine: string } | null => {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(AI_INSIGHTS_FILTERS_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.warn('Failed to load filters from localStorage:', error);
    return null;
  }
};

export default function AiInsights() {
  const [suggestions, setSuggestions] = useState(
    "AI insights will appear here after analysis..."
  );
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("AI insights will appear here after analysis...");
  const [trainingStatus, setTrainingStatus] = useState("Upload data to begin training");
  const [modelMetrics, setModelMetrics] = useState<{ r2?: number; rows?: number } | null>(null);
  
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [selectedServiceLine, setSelectedServiceLine] = useState<string>("all");
  const [isHydrated, setIsHydrated] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: locationsData } = useQuery({
    queryKey: ["/api/locations"],
  });

  const locations = (locationsData?.locations?.map((loc: any) => loc.name) || []).sort((a: string, b: string) => a.localeCompare(b));
  const serviceLines = ["HC", "HC/MC", "AL", "AL/MC", "SL", "VIL"];

  useEffect(() => {
    const savedFilters = loadFiltersFromStorage();
    const savedInsights = loadInsightsFromStorage();
    
    if (savedFilters) {
      setSelectedLocation(savedFilters.location || "all");
      setSelectedServiceLine(savedFilters.serviceLine || "all");
    }
    
    if (savedInsights) {
      setSuggestions(savedInsights.content || "AI insights will appear here after analysis...");
      setLastGeneratedAt(savedInsights.generatedAt || null);
      setEditedContent(savedInsights.content || "AI insights will appear here after analysis...");
    }
    
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    saveFiltersToStorage({ location: selectedLocation, serviceLine: selectedServiceLine });
  }, [selectedLocation, selectedServiceLine, isHydrated]);

  const aiSuggestMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('/api/ai/suggest', 'POST', {
        location: selectedLocation !== 'all' ? selectedLocation : undefined,
        serviceLine: selectedServiceLine !== 'all' ? selectedServiceLine : undefined
      });
    },
    onSuccess: async (response) => {
      const data = await response.json();
      if (data.ok) {
        const generatedAt = new Date().toISOString();
        setSuggestions(data.text);
        setLastGeneratedAt(generatedAt);
        setEditedContent(data.text);
        
        saveInsightsToStorage({
          content: data.text,
          generatedAt,
          filters: {
            location: selectedLocation,
            serviceLine: selectedServiceLine
          }
        });
        
        toast({
          title: "Analysis Complete",
          description: "New insights generated successfully",
        });
      } else {
        setSuggestions(`Analysis failed: ${data.error}`);
        toast({
          title: "Analysis Failed",
          description: data.error,
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      setSuggestions(`Analysis failed: ${error.message}`);
      toast({
        title: "Analysis Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const trainModelMutation = useMutation({
    mutationFn: async (file?: File) => {
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        return apiRequest('/api/ai/train', 'POST', formData);
      } else {
        return apiRequest('/api/ai/train', 'POST');
      }
    },
    onSuccess: async (response) => {
      const data = await response.json();
      if (data.ok) {
        setTrainingStatus(`Training completed successfully`);
        setModelMetrics({ r2: data.r2, rows: data.rows });
        toast({
          title: "Model Training Complete",
          description: `Trained on ${data.rows} records with accuracy score of ${Math.round(data.r2 * 100)}%`,
        });
      } else {
        setTrainingStatus(`Training failed: ${data.error}`);
        toast({
          title: "Training Failed",
          description: data.error,
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      setTrainingStatus(`Training failed: ${error.message}`);
      toast({
        title: "Training Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleGenerateInsights = () => {
    setSuggestions("Analyzing property data and market conditions...");
    aiSuggestMutation.mutate();
  };

  const handleFileUpload = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast({
        title: "Invalid File",
        description: "Please upload a CSV file",
        variant: "destructive",
      });
      return;
    }

    setTrainingStatus("Training model with uploaded data...");
    trainModelMutation.mutate(file);
  };

  const handleTrainWithCurrentData = () => {
    setTrainingStatus("Training model with current rent roll data...");
    trainModelMutation.mutate();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  const handleEditClick = () => {
    setEditedContent(suggestions);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    setSuggestions(editedContent);
    setIsEditing(false);
    
    const generatedAt = lastGeneratedAt || new Date().toISOString();
    saveInsightsToStorage({
      content: editedContent,
      generatedAt,
      filters: {
        location: selectedLocation,
        serviceLine: selectedServiceLine
      }
    });
    
    toast({
      title: "Changes Saved",
      description: "Your edits have been saved locally",
    });
  };

  const handleCancelEdit = () => {
    setEditedContent(suggestions);
    setIsEditing(false);
  };

  const getStatusColor = () => {
    if (trainModelMutation.isPending) return "text-[var(--trilogy-warning)]";
    if (modelMetrics) return "text-[var(--trilogy-success)]";
    return "text-[var(--dashboard-text)]";
  };

  const getStatusIcon = () => {
    if (trainModelMutation.isPending) return <div className="w-2 h-2 bg-[var(--trilogy-warning)] rounded-full animate-pulse" />;
    if (modelMetrics) return <div className="w-2 h-2 bg-[var(--trilogy-success)] rounded-full" />;
    return <div className="w-2 h-2 bg-gray-500 rounded-full" />;
  };

  const getFilterDescription = () => {
    const parts = [];
    if (selectedLocation !== 'all') parts.push(selectedLocation);
    if (selectedServiceLine !== 'all') parts.push(selectedServiceLine);
    return parts.length > 0 ? parts.join(' • ') : 'All locations and service lines';
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
            <div className="flex items-center gap-2 mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <Filter className="w-4 h-4 text-slate-500" />
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
            
            <Button
              onClick={handleGenerateInsights}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white"
              disabled={aiSuggestMutation.isPending}
              data-testid="button-generate-insights"
            >
              {aiSuggestMutation.isPending ? "Analyzing..." : "Generate AI Insights"}
            </Button>
            
            {lastGeneratedAt && (
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  Last generated: {new Date(lastGeneratedAt).toLocaleString()}
                </span>
                <span className="text-slate-400">
                  {getFilterDescription()}
                </span>
              </div>
            )}
            
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCancelEdit}
                      data-testid="button-cancel-edit"
                    >
                      <X className="w-4 h-4 mr-1" />
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveEdit}
                      data-testid="button-save-edit"
                    >
                      <Save className="w-4 h-4 mr-1" />
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="relative group">
                  <div className="text-xs text-[var(--dashboard-text)] whitespace-pre-wrap" data-testid="text-smart-suggestions">
                    {suggestions}
                  </div>
                  {suggestions !== "AI insights will appear here after analysis..." && (
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
