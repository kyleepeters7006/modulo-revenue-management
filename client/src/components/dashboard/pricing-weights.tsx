import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings, AlertCircle } from "lucide-react";
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
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ["/api/status"],
  });

  // Calculate total weight
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const isValid = totalWeight === 100;

  useEffect(() => {
    if (status && 'weights' in status && status.weights) {
      const apiWeights = status.weights as any;
      const loadedWeights = {
        occupancyPressure: apiWeights.occupancy_pressure ?? 25,
        daysVacantDecay: apiWeights.days_vacant_decay ?? 20,
        roomAttributes: apiWeights.room_attributes ?? 25,
        seasonality: apiWeights.seasonality ?? 10,
        competitorRates: apiWeights.competitor_rates ?? 10,
        stockMarket: apiWeights.stock_market ?? 10,
      };
      
      // Verify weights total 100 (they should from backend)
      const currentTotal = Object.values(loadedWeights).reduce((sum, w) => sum + w, 0);
      if (currentTotal === 100) {
        setWeights(loadedWeights);
      } else {
        // This shouldn't happen if backend validates, but handle it gracefully
        console.warn(`Weights from API total ${currentTotal}, expected 100`);
        // Set defaults instead
        const defaultWeights: Record<string, number> = {};
        weightConfigs.forEach(config => {
          defaultWeights[config.key] = config.default;
        });
        setWeights(defaultWeights);
      }
    } else {
      // Set defaults (which already total 100)
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
      return apiRequest('/api/weights', 'POST', payload);
    },
    onSuccess: () => {
      toast({
        title: "Weights Saved",
        description: "Pricing algorithm weights updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/recommendations'] });
    },
    onError: (error) => {
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleWeightChange = (key: string, value: number[]) => {
    const newValue = value[0];
    const oldValue = weights[key] || 0;
    const difference = newValue - oldValue;
    
    // Get other keys (excluding the one being changed)
    const otherKeys = Object.keys(weights).filter(k => k !== key);
    const otherTotal = otherKeys.reduce((sum, k) => sum + weights[k], 0);
    
    if (otherTotal === 0) {
      // If all others are 0, distribute the remainder equally
      const remainingValue = 100 - newValue;
      const perWeight = Math.floor(remainingValue / otherKeys.length);
      const newWeights = { ...weights, [key]: newValue };
      
      otherKeys.forEach((k, index) => {
        if (index === otherKeys.length - 1) {
          // Last one gets the remainder to ensure exactly 100
          newWeights[k] = remainingValue - (perWeight * (otherKeys.length - 1));
        } else {
          newWeights[k] = perWeight;
        }
      });
      
      setWeights(newWeights);
    } else {
      // Proportionally adjust other weights
      const newWeights = { ...weights, [key]: newValue };
      const targetTotal = 100 - newValue;
      
      if (targetTotal >= 0) {
        // Scale other weights proportionally
        otherKeys.forEach(k => {
          newWeights[k] = Math.round((weights[k] / otherTotal) * targetTotal);
        });
        
        // Adjust for rounding errors
        const currentTotal = Object.values(newWeights).reduce((sum, w) => sum + w, 0);
        if (currentTotal !== 100) {
          // Find the weight with the largest value to adjust
          const largestOtherKey = otherKeys.reduce((max, k) => 
            newWeights[k] > newWeights[max] ? k : max
          );
          newWeights[largestOtherKey] += 100 - currentTotal;
        }
      }
      
      setWeights(newWeights);
    }
  };

  const handleSave = () => {
    if (!isValid) {
      toast({
        title: "Invalid Weights",
        description: "Weights must total exactly 100%",
        variant: "destructive",
      });
      return;
    }
    saveWeightsMutation.mutate(weights);
  };

  return (
    <div className="dashboard-card mb-8">
      <div className="flex items-center space-x-3 mb-6">
        <div className="w-10 h-10 bg-[var(--trilogy-navy)]/10 rounded-lg flex items-center justify-center">
          <Settings className="w-5 h-5 text-[var(--trilogy-navy)]" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-[var(--dashboard-text)]">
            Pricing Algorithm Weights
          </h3>
          <p className="text-sm text-[var(--dashboard-muted)]">
            Adjust factors influencing dynamic pricing decisions
          </p>
        </div>
        <div className={`px-3 py-1 rounded-lg text-sm font-medium ${
          isValid 
            ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300' 
            : 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300'
        }`}>
          Total: {totalWeight}%
        </div>
      </div>
      
      {!isValid && (
        <div className="flex items-center space-x-2 p-3 mb-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <AlertCircle className="w-4 h-4 text-amber-600" />
          <span className="text-sm text-amber-800 dark:text-amber-200">
            Weights must total exactly 100%. Currently: {totalWeight}%
          </span>
        </div>
      )}
      
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
                {weights[config.key] !== undefined ? weights[config.key] : config.default}%
              </span>
            </div>
            <Slider
              value={[weights[config.key] !== undefined ? weights[config.key] : config.default]}
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
      
      <div className="flex items-center justify-between mt-6">
        <div className="text-sm text-[var(--dashboard-muted)]">
          {!isValid ? "Adjust weights to total 100%" : "Weights ready to save"}
        </div>
        <Button
          onClick={handleSave}
          className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white"
          disabled={saveWeightsMutation.isPending || !isValid}
          data-testid="button-save-weights"
        >
          {saveWeightsMutation.isPending ? "Saving..." : "Save Weights"}
        </Button>
      </div>
    </div>
  );
}