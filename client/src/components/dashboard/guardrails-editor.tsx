import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const defaultGuardrails = {
  min_price_change_pct: -15,
  max_price_change_pct: 25,
  min_absolute_price: 2500,
  max_absolute_price: 8000,
  occupancy_threshold: 0.95,
  vacancy_days_threshold: 30,
  seasonal_adjustments: {
    summer: 1.05,
    winter: 0.98
  }
};

export default function GuardrailsEditor() {
  const [guardrailsJson, setGuardrailsJson] = useState("");
  const [isValidJson, setIsValidJson] = useState(true);
  const [saveStatus, setSaveStatus] = useState("Configuration ready to save...");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: guardrails } = useQuery({
    queryKey: ["/api/guardrails"],
  });

  useEffect(() => {
    if (guardrails && Object.keys(guardrails).length > 0) {
      setGuardrailsJson(JSON.stringify(guardrails, null, 2));
    } else {
      setGuardrailsJson(JSON.stringify(defaultGuardrails, null, 2));
    }
  }, [guardrails]);

  const saveGuardrailsMutation = useMutation({
    mutationFn: async (config: any) => {
      return apiRequest('POST', '/api/guardrails', config);
    },
    onSuccess: () => {
      setSaveStatus("Guardrails saved successfully");
      toast({
        title: "Guardrails Saved",
        description: "Pricing constraints updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/guardrails'] });
    },
    onError: (error) => {
      setSaveStatus(`Save failed: ${error.message}`);
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleJsonChange = (value: string) => {
    setGuardrailsJson(value);
    
    try {
      JSON.parse(value);
      setIsValidJson(true);
      setSaveStatus("Valid JSON format");
    } catch (e) {
      setIsValidJson(false);
      setSaveStatus("Invalid JSON format");
    }
  };

  const handleSave = () => {
    if (!isValidJson) {
      toast({
        title: "Invalid JSON",
        description: "Please fix the JSON format before saving",
        variant: "destructive",
      });
      return;
    }

    try {
      const config = JSON.parse(guardrailsJson);
      setSaveStatus("Saving...");
      saveGuardrailsMutation.mutate(config);
    } catch (e) {
      setSaveStatus("Invalid JSON format");
      toast({
        title: "Invalid JSON",
        description: "Please check the JSON format",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="dashboard-card">
      <div className="flex items-center space-x-3 mb-6">
        <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center">
          <Shield className="w-5 h-5 text-amber-500" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-[var(--dashboard-text)]">
            Pricing Guardrails
          </h3>
          <p className="text-sm text-[var(--dashboard-muted)]">
            Define constraints and limits for automated pricing
          </p>
        </div>
      </div>
      
      <div className="space-y-4">
        <Textarea
          value={guardrailsJson}
          onChange={(e) => handleJsonChange(e.target.value)}
          rows={12}
          className="w-full dashboard-input font-mono text-sm resize-none"
          placeholder="Enter JSON configuration..."
          data-testid="textarea-guardrails"
        />
        
        <div className="flex justify-between items-center">
          <div className="text-xs text-[var(--dashboard-muted)]">
            <span className={isValidJson ? "text-emerald-400" : "text-red-400"}>
              {isValidJson ? "✓" : "✗"}
            </span>{" "}
            {isValidJson ? "Valid JSON format" : "Invalid JSON format"}
          </div>
          <Button
            onClick={handleSave}
            className="bg-amber-500 hover:bg-amber-600 text-white"
            disabled={!isValidJson || saveGuardrailsMutation.isPending}
            data-testid="button-save-guardrails"
          >
            {saveGuardrailsMutation.isPending ? "Saving..." : "Save Guardrails"}
          </Button>
        </div>
        
        <div 
          className="text-sm text-[var(--dashboard-muted)]"
          data-testid="text-guardrails-status"
        >
          {saveStatus}
        </div>
      </div>
    </div>
  );
}
