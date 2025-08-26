import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const weightConfigs = [
  { key: "occupancyPressure", label: "Occupancy Pressure", default: 25 },
  { key: "daysVacantDecay", label: "Days Vacant Decay", default: 20 },
  { key: "roomAttributes", label: "Room Attributes", default: 25 },
  { key: "seasonality", label: "Seasonality", default: 10 },
  { key: "competitorRates", label: "Competitor Rates", default: 10 },
  { key: "stockMarket", label: "Stock Market", default: 10 },
];

export default function PricingWeights() {
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [saveStatus, setSaveStatus] = useState("Weights ready to save...");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ["/api/status"],
  });

  useEffect(() => {
    if (status?.weights) {
      setWeights({
        occupancyPressure: status.weights.occupancy_pressure,
        daysVacantDecay: status.weights.days_vacant_decay,
        roomAttributes: status.weights.room_attributes,
        seasonality: status.weights.seasonality,
        competitorRates: status.weights.competitor_rates,
        stockMarket: status.weights.stock_market,
      });
    } else {
      // Set defaults
      const defaultWeights: Record<string, number> = {};
      weightConfigs.forEach(config => {
        defaultWeights[config.key] = config.default;
      });
      setWeights(defaultWeights);
    }
  }, [status]);

  const saveWeightsMutation = useMutation({
    mutationFn: async (weightsData: Record<string, number>) => {
      const payload = {
        occupancy_pressure: weightsData.occupancyPressure,
        days_vacant_decay: weightsData.daysVacantDecay,
        room_attributes: weightsData.roomAttributes,
        seasonality: weightsData.seasonality,
        competitor_rates: weightsData.competitorRates,
        stock_market: weightsData.stockMarket,
      };
      return apiRequest('POST', '/api/weights', payload);
    },
    onSuccess: () => {
      setSaveStatus("Weights saved successfully");
      toast({
        title: "Weights Saved",
        description: "Pricing algorithm weights updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/recommendations'] });
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

  const handleWeightChange = (key: string, value: number[]) => {
    setWeights(prev => ({
      ...prev,
      [key]: value[0]
    }));
  };

  const handleSave = () => {
    setSaveStatus("Saving...");
    saveWeightsMutation.mutate(weights);
  };

  return (
    <div className="dashboard-card mb-8">
      <div className="flex items-center space-x-3 mb-6">
        <div className="w-10 h-10 bg-[var(--trilogy-navy)]/10 rounded-lg flex items-center justify-center">
          <Settings className="w-5 h-5 text-[var(--trilogy-navy)]" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-[var(--dashboard-text)]">
            Pricing Algorithm Weights
          </h3>
          <p className="text-sm text-[var(--dashboard-muted)]">
            Adjust factors influencing dynamic pricing decisions
          </p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {weightConfigs.map((config) => (
          <div key={config.key} className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-[var(--dashboard-text)]">
                {config.label}
              </label>
              <span 
                className="px-2 py-1 text-xs font-mono bg-[var(--dashboard-bg)] border border-[var(--dashboard-border)] rounded text-[var(--dashboard-text)]"
                data-testid={`value-weight-${config.key}`}
              >
                {weights[config.key] || config.default}
              </span>
            </div>
            <Slider
              value={[weights[config.key] || config.default]}
              onValueChange={(value) => handleWeightChange(config.key, value)}
              min={0}
              max={100}
              step={1}
              className="w-full"
              data-testid={`slider-weight-${config.key}`}
            />
          </div>
        ))}
      </div>
      
      <div className="flex justify-end mt-6">
        <Button
          onClick={handleSave}
          className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white"
          disabled={saveWeightsMutation.isPending}
          data-testid="button-save-weights"
        >
          {saveWeightsMutation.isPending ? "Saving..." : "Save Weights"}
        </Button>
      </div>
      
      <div 
        className="text-sm text-[var(--dashboard-muted)] mt-2"
        data-testid="text-weights-status"
      >
        {saveStatus}
      </div>
    </div>
  );
}
