import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function AiInsights() {
  const [suggestions, setSuggestions] = useState("AI suggestions will appear here after analysis...");
  const { toast } = useToast();

  const aiSuggestMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/ai/suggest');
    },
    onSuccess: async (response) => {
      const data = await response.json();
      if (data.ok) {
        setSuggestions(data.text);
        toast({
          title: "AI Analysis Complete",
          description: "New insights generated successfully",
        });
      } else {
        setSuggestions(`Analysis failed: ${data.error}`);
        toast({
          title: "AI Analysis Failed",
          description: data.error,
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      setSuggestions(`Analysis failed: ${error.message}`);
      toast({
        title: "AI Analysis Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleGenerateInsights = () => {
    setSuggestions("Analyzing property data and market conditions...");
    aiSuggestMutation.mutate();
  };

  return (
    <div className="dashboard-card">
      <div className="flex items-center space-x-3 mb-4">
        <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
          <Lightbulb className="w-5 h-5 text-purple-500" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-[var(--dashboard-text)]">AI Insights</h3>
          <p className="text-sm text-[var(--dashboard-muted)]">OpenAI-powered recommendations</p>
        </div>
      </div>
      
      <div className="space-y-4">
        <Button
          onClick={handleGenerateInsights}
          className="w-full bg-purple-500 hover:bg-purple-600 text-white"
          disabled={aiSuggestMutation.isPending}
          data-testid="button-generate-ai"
        >
          {aiSuggestMutation.isPending ? "Analyzing..." : "Generate AI Suggestions"}
        </Button>
        
        <div className="text-xs text-[var(--dashboard-muted)] p-3 bg-[var(--dashboard-bg)] rounded-lg">
          Set <code className="px-1 py-0.5 bg-[var(--dashboard-border)] rounded text-[var(--dashboard-text)]">
            OPENAI_API_KEY
          </code> in environment variables
        </div>
        
        <div 
          className="p-4 bg-[var(--dashboard-bg)] border border-[var(--dashboard-border)] rounded-lg min-h-24 text-sm text-[var(--dashboard-muted)] whitespace-pre-wrap"
          data-testid="text-ai-output"
        >
          {suggestions}
        </div>
      </div>
    </div>
  );
}
