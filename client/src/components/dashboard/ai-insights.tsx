import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Brain, Upload, Lightbulb, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function AiInsights() {
  const [suggestions, setSuggestions] = useState("AI insights will appear here after analysis...");
  const [trainingStatus, setTrainingStatus] = useState("Upload data to begin training");
  const [modelMetrics, setModelMetrics] = useState<{ r2?: number; rows?: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
        return apiRequest('POST', '/api/ai/train', formData);
      } else {
        return apiRequest('POST', '/api/ai/train');
      }
    },
    onSuccess: async (response) => {
      const data = await response.json();
      if (data.ok) {
        setTrainingStatus(`Training completed successfully`);
        setModelMetrics({ r2: data.r2, rows: data.rows });
        toast({
          title: "Model Training Complete",
          description: `Trained on ${data.rows} records with accuracy score of ${(data.r2 * 100).toFixed(1)}%`,
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Smart Recommendations */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Lightbulb className="w-5 h-5 text-purple-500" />
              <span>AI Recommendations</span>
            </CardTitle>
            <CardDescription>AI-powered insights and suggestions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={handleGenerateInsights}
              className="w-full bg-purple-500 hover:bg-purple-600 text-white"
              disabled={aiSuggestMutation.isPending}
              data-testid="button-generate-insights"
            >
              {aiSuggestMutation.isPending ? "Analyzing..." : "Generate AI Insights"}
            </Button>
            
            <div className="p-4 bg-[var(--dashboard-bg)] rounded-lg border border-[var(--dashboard-border)]">
              <div className="text-xs text-[var(--dashboard-text)] whitespace-pre-wrap" data-testid="text-smart-suggestions">
                {suggestions}
              </div>
            </div>

            <div className="text-xs text-[var(--dashboard-muted)] p-3 bg-[var(--dashboard-bg)] rounded-lg">
              Set <code className="px-1 py-0.5 bg-[var(--dashboard-border)] rounded text-[var(--dashboard-text)]">
                OPENAI_API_KEY
              </code> in environment variables for enhanced insights
            </div>
          </CardContent>
        </Card>

        {/* Predictive Model Training */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Activity className="w-5 h-5 text-blue-500" />
              <span>Predictive Model</span>
            </CardTitle>
            <CardDescription>Train models on historical data for better predictions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div 
              className="border-2 border-dashed border-[var(--dashboard-border)] rounded-lg p-4 text-center hover:border-[var(--trilogy-teal)]/50 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              data-testid="dropzone-model-upload"
            >
              <Upload className="w-6 h-6 text-[var(--dashboard-muted)] mx-auto mb-2" />
              <p className="text-xs text-[var(--dashboard-muted)]">Upload historical data (CSV)</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileInputChange}
                data-testid="input-model-file"
              />
            </div>

            <div className="p-4 bg-[var(--dashboard-bg)] rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                {getStatusIcon()}
                <span className={`text-sm ${getStatusColor()}`} data-testid="text-model-status">
                  {trainModelMutation.isPending ? "Training..." : modelMetrics ? "Model Ready" : "Ready to train"}
                </span>
              </div>
              <p className="text-xs text-[var(--dashboard-muted)]" data-testid="text-model-details">
                {modelMetrics 
                  ? `Accuracy Score: ${(modelMetrics.r2! * 100).toFixed(1)}% | Trained on: ${modelMetrics.rows} records`
                  : trainingStatus
                }
              </p>
            </div>

            <div className="space-y-2">
              <Button
                onClick={handleTrainWithCurrentData}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white"
                disabled={trainModelMutation.isPending}
                data-testid="button-train-current-data"
              >
                {trainModelMutation.isPending ? "Training..." : "Train with Current Data"}
              </Button>
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                className="w-full border-[var(--dashboard-border)] text-[var(--dashboard-text)] hover:bg-[var(--dashboard-bg)]"
                disabled={trainModelMutation.isPending}
                data-testid="button-upload-historical-data"
              >
                Upload Historical Data
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}