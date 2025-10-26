import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings, AlertCircle, RotateCcw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const weightConfigs = [
  { key: "occupancyPressure", label: "Occupancy Pressure", default: 25 },
  { key: "daysVacantDecay", label: "Days Vacant Decay", default: 15 },
  { key: "roomAttributes", label: "Room Attributes", default: 20 },
  { key: "seasonality", label: "Seasonality", default: 10 },
  { key: "competitorRates", label: "Competitor Rates", default: 10 },
  { key: "stockMarket", label: "Stock Market", default: 10 },
  { key: "inquiryTourVolume", label: "Inquiry & Tour Volume", default: 10 },
];

const weightDetails: Record<string, {
  title: string;
  description: string;
  calculation: string;
  dataSource: string;
  example: {
    scenario: string;
    baseRate: number;
    adjustment: number;
    finalRate: number;
  };
}> = {
  occupancyPressure: {
    title: "Occupancy Pressure",
    description: "Adjusts pricing based on current occupancy levels to balance revenue optimization with occupancy targets.",
    calculation: "Adjustment = (Current Occupancy - Target Occupancy) × Weight × Sensitivity Factor",
    dataSource: "Real-time occupancy data from rent_roll_data table (occupied_yn field)",
    example: {
      scenario: "Campus at 90% occupancy (target: 85%)",
      baseRate: 5000,
      adjustment: 150,
      finalRate: 5150
    }
  },
  daysVacantDecay: {
    title: "Days Vacant Decay",
    description: "Gradually reduces rates for units that remain vacant longer to accelerate occupancy.",
    calculation: "Adjustment = -1 × (Days Vacant / 30) × Weight × Base Rate",
    dataSource: "Days vacant calculated from rent_roll_data.move_out_date field",
    example: {
      scenario: "Unit vacant for 45 days",
      baseRate: 5000,
      adjustment: -250,
      finalRate: 4750
    }
  },
  roomAttributes: {
    title: "Room Attributes",
    description: "Premium or discount pricing based on room features like view, floor level, proximity to amenities.",
    calculation: "Adjustment = Σ(Attribute Value × Attribute Weight) × Overall Weight",
    dataSource: "Room attributes from rent_roll_data (view, floor, amenities columns)",
    example: {
      scenario: "Premium corner unit with city view",
      baseRate: 5000,
      adjustment: 400,
      finalRate: 5400
    }
  },
  seasonality: {
    title: "Seasonality",
    description: "Adjusts rates based on seasonal demand patterns (higher in spring/fall, lower in winter/summer).",
    calculation: "Adjustment = Base Rate × Seasonal Index × Weight",
    dataSource: "Historical occupancy trends by month from rent_roll_data aggregated by move-in dates",
    example: {
      scenario: "Peak season (October)",
      baseRate: 5000,
      adjustment: 300,
      finalRate: 5300
    }
  },
  competitorRates: {
    title: "Competitor Rates",
    description: "Positions your rates relative to nearby competitors to remain competitive while optimizing revenue.",
    calculation: "Adjustment = (Competitor Avg Rate - Your Rate) × Market Position Factor × Weight",
    dataSource: "Competitor pricing from competitors table (street_rate field by location)",
    example: {
      scenario: "Competitor avg: $5,200, Your rate: $5,000",
      baseRate: 5000,
      adjustment: 120,
      finalRate: 5120
    }
  },
  stockMarket: {
    title: "Stock Market",
    description: "Correlates pricing with broader economic indicators (S&P 500 performance) as a proxy for consumer confidence.",
    calculation: "Adjustment = (S&P YTD Change %) × Correlation Factor × Weight × Base Rate",
    dataSource: "S&P 500 index data from Alpha Vantage API (cached daily)",
    example: {
      scenario: "S&P 500 up 8% YTD",
      baseRate: 5000,
      adjustment: 200,
      finalRate: 5200
    }
  },
  inquiryTourVolume: {
    title: "Inquiry & Tour Volume",
    description: "Increases rates for units with high inquiry and tour activity, indicating strong demand. Reduces rates for units with low interest to stimulate inquiries.",
    calculation: "Adjustment = ((Inquiry Count + Tour Count × 2) / Target Volume - 1) × Weight × Base Rate",
    dataSource: "Inquiry and tour counts from rent_roll_data table (inquiry_count and tour_count fields), tracked over trailing 30 days",
    example: {
      scenario: "Unit with 8 inquiries and 4 tours (16 total demand score)",
      baseRate: 5000,
      adjustment: 250,
      finalRate: 5250
    }
  }
};

export default function PricingWeights() {
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [selectedWeightKey, setSelectedWeightKey] = useState<string | null>(null);
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
        daysVacantDecay: apiWeights.days_vacant_decay ?? 15,
        roomAttributes: apiWeights.room_attributes ?? 20,
        seasonality: apiWeights.seasonality ?? 10,
        competitorRates: apiWeights.competitor_rates ?? 10,
        stockMarket: apiWeights.stock_market ?? 10,
        inquiryTourVolume: apiWeights.inquiry_tour_volume ?? 10,
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
        inquiry_tour_volume: weightsData.inquiryTourVolume,
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
    
    if (otherTotal === 0 && otherKeys.length > 0) {
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
    } else if (otherKeys.length > 0) {
      // Proportionally adjust other weights based on their current ratios
      const newWeights = { ...weights, [key]: newValue };
      const targetTotal = 100 - newValue;
      
      // Ensure we don't have negative target total
      if (targetTotal >= 0 && targetTotal <= 100) {
        if (otherTotal > 0) {
          // Scale other weights proportionally to their current values
          otherKeys.forEach(k => {
            // Maintain the relative proportion of each other weight
            const proportion = weights[k] / otherTotal;
            newWeights[k] = Math.round(proportion * targetTotal);
          });
        } else {
          // If somehow all others are 0, distribute equally
          const perWeight = Math.floor(targetTotal / otherKeys.length);
          otherKeys.forEach((k, index) => {
            if (index === otherKeys.length - 1) {
              newWeights[k] = targetTotal - (perWeight * (otherKeys.length - 1));
            } else {
              newWeights[k] = perWeight;
            }
          });
        }
        
        // Adjust for rounding errors to ensure exactly 100%
        const currentTotal = Object.values(newWeights).reduce((sum, w) => sum + w, 0);
        if (currentTotal !== 100 && otherKeys.length > 0) {
          // Find the weight with the largest value among others to adjust
          const largestOtherKey = otherKeys.reduce((max, k) => 
            (newWeights[k] > newWeights[max] ? k : max), otherKeys[0]
          );
          if (largestOtherKey) {
            newWeights[largestOtherKey] += 100 - currentTotal;
          }
        }
      } else if (targetTotal < 0) {
        // If trying to set more than 100%, cap at 100%
        newWeights[key] = 100;
        otherKeys.forEach(k => {
          newWeights[k] = 0;
        });
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

  const handleResetToDefaults = () => {
    const defaultWeights: Record<string, number> = {};
    weightConfigs.forEach(config => {
      defaultWeights[config.key] = config.default;
    });
    setWeights(defaultWeights);
    toast({
      title: "Weights Reset",
      description: "Weights have been reset to default values",
    });
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
        <div className={`px-3 py-1 rounded-lg text-sm font-bold ${
          isValid 
            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-100' 
            : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-100'
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
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-[var(--dashboard-text)]">
                  {config.label}
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 p-0 hover:bg-[var(--trilogy-teal)]/10"
                  onClick={() => setSelectedWeightKey(config.key)}
                  data-testid={`button-info-${config.key}`}
                >
                  <Info className="h-4 w-4 text-[var(--trilogy-teal)]" />
                </Button>
              </div>
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
        <div className="flex gap-2">
          <Button
            onClick={handleResetToDefaults}
            variant="outline"
            className="border-[var(--dashboard-border)] hover:bg-[var(--dashboard-bg)]"
            data-testid="button-reset-weights"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset to Default
          </Button>
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

      {/* Weight Details Dialog */}
      <Dialog open={selectedWeightKey !== null} onOpenChange={(open) => !open && setSelectedWeightKey(null)}>
        <DialogContent className="max-w-2xl">
          {selectedWeightKey && weightDetails[selectedWeightKey] && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl font-semibold flex items-center gap-2">
                  {weightDetails[selectedWeightKey].title}
                  <Badge variant="outline" className="ml-2">
                    {weights[selectedWeightKey] !== undefined ? weights[selectedWeightKey] : weightConfigs.find(c => c.key === selectedWeightKey)?.default}% Weight
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-base">
                  {weightDetails[selectedWeightKey].description}
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-6 mt-4">
                {/* Calculation Formula */}
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm text-[var(--dashboard-text)] flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[var(--trilogy-teal)]/10 flex items-center justify-center text-[var(--trilogy-teal)] text-xs">1</span>
                    Calculation Formula
                  </h4>
                  <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                    <code className="text-sm text-gray-900 dark:text-gray-100 font-mono">
                      {weightDetails[selectedWeightKey].calculation}
                    </code>
                  </div>
                </div>

                {/* Data Source */}
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm text-[var(--dashboard-text)] flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[var(--trilogy-teal)]/10 flex items-center justify-center text-[var(--trilogy-teal)] text-xs">2</span>
                    Data Source
                  </h4>
                  <p className="text-sm text-muted-foreground bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                    {weightDetails[selectedWeightKey].dataSource}
                  </p>
                </div>

                {/* Example Application */}
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm text-[var(--dashboard-text)] flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[var(--trilogy-teal)]/10 flex items-center justify-center text-[var(--trilogy-teal)] text-xs">3</span>
                    Example Application
                  </h4>
                  <div className="p-4 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-200 dark:border-green-800 space-y-3">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {weightDetails[selectedWeightKey].example.scenario}
                    </p>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Base Rate</p>
                        <p className="font-semibold text-lg">
                          ${weightDetails[selectedWeightKey].example.baseRate.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Adjustment</p>
                        <p className={`font-semibold text-lg ${weightDetails[selectedWeightKey].example.adjustment >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {weightDetails[selectedWeightKey].example.adjustment >= 0 ? '+' : ''}${weightDetails[selectedWeightKey].example.adjustment.toLocaleString()}
                          <span className="text-xs ml-1">
                            ({((weightDetails[selectedWeightKey].example.adjustment / weightDetails[selectedWeightKey].example.baseRate) * 100).toFixed(1)}%)
                          </span>
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Final Rate</p>
                        <p className="font-semibold text-lg text-[var(--trilogy-teal)]">
                          ${weightDetails[selectedWeightKey].example.finalRate.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}