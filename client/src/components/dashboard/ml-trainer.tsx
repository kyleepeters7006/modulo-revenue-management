import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Brain, Upload, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function MlTrainer() {
  const [trainingStatus, setTrainingStatus] = useState("Upload data to begin training");
  const [modelMetrics, setModelMetrics] = useState<{ r2?: number; rows?: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const trainModelMutation = useMutation({
    mutationFn: async (file?: File) => {
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        return apiRequest('POST', '/api/ml/train', formData);
      } else {
        return apiRequest('POST', '/api/ml/train');
      }
    },
    onSuccess: async (response) => {
      const data = await response.json();
      if (data.ok) {
        setTrainingStatus(`Training completed successfully`);
        setModelMetrics({ r2: data.r2, rows: data.rows });
        toast({
          title: "Model Training Complete",
          description: `Trained on ${data.rows} records with R² score of ${(data.r2 * 100).toFixed(1)}%`,
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
    if (trainModelMutation.isPending) return "text-yellow-400";
    if (modelMetrics) return "text-emerald-400";
    return "text-[var(--dashboard-text)]";
  };

  const getStatusIcon = () => {
    if (trainModelMutation.isPending) return <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />;
    if (modelMetrics) return <div className="w-2 h-2 bg-emerald-500 rounded-full" />;
    return <div className="w-2 h-2 bg-gray-500 rounded-full" />;
  };

  return (
    <div className="dashboard-card mb-8">
      <div className="flex items-center space-x-3 mb-6">
        <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
          <Brain className="w-5 h-5 text-blue-500" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-[var(--dashboard-text)]">
            Machine Learning Trainer
          </h3>
          <p className="text-sm text-[var(--dashboard-muted)]">
            Train predictive models on historical data
          </p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-4">
          <label className="block text-sm font-medium text-[var(--dashboard-text)]">
            Historical Data
          </label>
          <div 
            className="border-2 border-dashed border-[var(--dashboard-border)] rounded-lg p-4 text-center hover:border-blue-500/50 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            data-testid="dropzone-ml-upload"
          >
            <Upload className="w-6 h-6 text-[var(--dashboard-muted)] mx-auto mb-2" />
            <p className="text-xs text-[var(--dashboard-muted)]">Upload history.csv</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileInputChange}
              data-testid="input-ml-file"
            />
          </div>
        </div>
        
        <div className="space-y-4">
          <label className="block text-sm font-medium text-[var(--dashboard-text)]">
            Training Status
          </label>
          <div className="p-4 bg-[var(--dashboard-bg)] rounded-lg">
            <div className="flex items-center space-x-2">
              {getStatusIcon()}
              <span className={`text-sm ${getStatusColor()}`} data-testid="text-training-status">
                {trainModelMutation.isPending ? "Training..." : modelMetrics ? "Model Ready" : "Ready to train"}
              </span>
            </div>
            <p className="text-xs text-[var(--dashboard-muted)] mt-2" data-testid="text-model-metrics">
              {modelMetrics 
                ? `R² Score: ${(modelMetrics.r2! * 100).toFixed(1)}% | Rows: ${modelMetrics.rows}`
                : trainingStatus
              }
            </p>
          </div>
        </div>
        
        <div className="space-y-4">
          <label className="block text-sm font-medium text-[var(--dashboard-text)]">
            Actions
          </label>
          <div className="space-y-2">
            <Button
              onClick={handleTrainWithCurrentData}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white"
              disabled={trainModelMutation.isPending}
              data-testid="button-train-model"
            >
              {trainModelMutation.isPending ? "Training..." : "Train Model"}
            </Button>
            <Button
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
              className="w-full border-[var(--dashboard-border)] text-[var(--dashboard-text)] hover:bg-[var(--dashboard-bg)]"
              disabled={trainModelMutation.isPending}
              data-testid="button-upload-training-data"
            >
              Upload Training Data
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
