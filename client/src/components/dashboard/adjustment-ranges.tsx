import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, RotateCcw, TrendingUp, TrendingDown } from "lucide-react";
import { DialPicker } from "@/components/ui/dial-picker";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AdjustmentRange {
  occupancyMin: number;
  occupancyMax: number;
  vacancyMin: number;
  vacancyMax: number;
  attributesMin: number;
  attributesMax: number;
  seasonalityMin: number;
  seasonalityMax: number;
  competitorMin: number;
  competitorMax: number;
  marketMin: number;
  marketMax: number;
}

const defaultRanges: AdjustmentRange = {
  occupancyMin: -0.10,
  occupancyMax: 0.05,
  vacancyMin: -0.15,
  vacancyMax: 0.00,
  attributesMin: -0.05,
  attributesMax: 0.10,
  seasonalityMin: -0.05,
  seasonalityMax: 0.10,
  competitorMin: -0.10,
  competitorMax: 0.10,
  marketMin: -0.05,
  marketMax: 0.05,
};

export default function AdjustmentRanges() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [ranges, setRanges] = useState<AdjustmentRange>(defaultRanges);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: savedRanges, isLoading } = useQuery<AdjustmentRange>({
    queryKey: ['/api/adjustment-ranges'],
  });

  useEffect(() => {
    if (savedRanges) {
      setRanges(savedRanges);
    }
  }, [savedRanges]);

  const saveMutation = useMutation({
    mutationFn: async (data: AdjustmentRange) => {
      await apiRequest('/api/adjustment-ranges', 'PUT', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/adjustment-ranges'] });
      queryClient.invalidateQueries({ queryKey: ['/api/calculation'] });
      queryClient.invalidateQueries({ queryKey: ['/api/adjustment-rules'] });
      toast({
        title: "Success",
        description: "Adjustment ranges have been updated.",
      });
      setHasChanges(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update adjustment ranges.",
        variant: "destructive",
      });
    },
  });

  const handleRangeChange = (factor: string, type: 'Min' | 'Max', value: string) => {
    const key = `${factor}${type}` as keyof AdjustmentRange;
    const numValue = parseFloat(value);
    
    if (!isNaN(numValue)) {
      setRanges(prev => ({
        ...prev,
        [key]: numValue / 100 // Convert percentage to decimal
      }));
      setHasChanges(true);
    }
  };

  const handleReset = () => {
    setRanges(defaultRanges);
    setHasChanges(true);
  };

  const formatPercent = (value: number) => {
    return (value * 100).toFixed(0);
  };

  const getIcon = (value: number) => {
    if (value > 0) return <TrendingUp className="w-6 h-6 text-green-600" strokeWidth={3.5} />;
    if (value < 0) return <TrendingDown className="w-6 h-6 text-red-600" strokeWidth={3.5} />;
    return null;
  };

  const factors = [
    { 
      key: 'occupancy', 
      label: 'Occupancy Pressure',
      description: 'Adjust rates based on current occupancy levels'
    },
    { 
      key: 'vacancy', 
      label: 'Days Vacant Decay',
      description: 'Reduce rates for units that have been vacant longer'
    },
    { 
      key: 'attributes', 
      label: 'Room Attributes',
      description: 'Premium for renovated units, views, and amenities'
    },
    { 
      key: 'seasonality', 
      label: 'Seasonality',
      description: 'Seasonal demand adjustments'
    },
    { 
      key: 'competitor', 
      label: 'Competitor Rates',
      description: 'Adjust based on competitive positioning'
    },
    { 
      key: 'market', 
      label: 'Stock Market',
      description: 'Economic conditions impact'
    },
  ];

  if (isLoading) {
    return (
      <Card className="border-[var(--trilogy-teal)]/20 bg-white dark:bg-gray-900 shadow-lg">
        <CardContent className="p-6">
          <div className="flex justify-center items-center h-64">
            <div className="text-gray-500">Loading adjustment ranges...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-[var(--trilogy-teal)]/20 bg-white dark:bg-gray-900 shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-2xl font-bold text-gray-900 dark:text-white">
              Adjustment Ranges Configuration
            </CardTitle>
            <CardDescription className="text-gray-600 dark:text-gray-400 mt-1">
              Set the minimum and maximum adjustment percentages for each pricing factor
            </CardDescription>
          </div>
          {hasChanges && (
            <Badge variant="secondary" className="bg-amber-100 text-amber-800">
              Unsaved Changes
            </Badge>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="p-6 space-y-6">
        <div className="space-y-4">
          {factors.map((factor) => {
            const minKey = `${factor.key}Min` as keyof AdjustmentRange;
            const maxKey = `${factor.key}Max` as keyof AdjustmentRange;
            const minValue = ranges[minKey];
            const maxValue = ranges[maxKey];

            return (
              <div 
                key={factor.key} 
                className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <div className="mb-3">
                  <Label className="text-base font-semibold text-gray-700 dark:text-gray-300">
                    {factor.label}
                  </Label>
                  <div className="text-xs text-gray-500 mt-1">{factor.description}</div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1">
                      Minimum Adjustment {getIcon(minValue)}
                    </Label>
                    <div className="flex items-center gap-2">
                      <DialPicker
                        value={parseFloat(formatPercent(minValue))}
                        onChange={(value) => handleRangeChange(factor.key, 'Min', value.toString())}
                        min={-50}
                        max={50}
                        step={1}
                        suffix="%"
                        data-testid={`input-${factor.key}-min`}
                      />
                      <span className="text-sm text-gray-600 dark:text-gray-400">%</span>
                      {minValue < 0 ? <TrendingDown className="w-5 h-5 text-red-600" strokeWidth={3.5} /> : minValue > 0 ? <TrendingUp className="w-5 h-5 text-green-600" strokeWidth={3.5} /> : <span className="text-gray-500">—</span>}
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1">
                      Maximum Adjustment {getIcon(maxValue)}
                    </Label>
                    <div className="flex items-center gap-2">
                      <DialPicker
                        value={parseFloat(formatPercent(maxValue))}
                        onChange={(value) => handleRangeChange(factor.key, 'Max', value.toString())}
                        min={-50}
                        max={50}
                        step={1}
                        suffix="%"
                        data-testid={`input-${factor.key}-max`}
                      />
                      <span className="text-sm text-gray-600 dark:text-gray-400">%</span>
                      {maxValue < 0 ? <TrendingDown className="w-5 h-5 text-red-600" strokeWidth={3.5} /> : maxValue > 0 ? <TrendingUp className="w-5 h-5 text-green-600" strokeWidth={3.5} /> : <span className="text-gray-500">—</span>}
                    </div>
                  </div>
                </div>

                <div className="mt-2 text-xs text-gray-500">
                  Range: {formatPercent(minValue)}% to {formatPercent(maxValue)}% 
                  {minValue < 0 && maxValue > 0 && ' (can increase or decrease)'}
                  {minValue < 0 && maxValue <= 0 && ' (decrease only)'}
                  {minValue >= 0 && maxValue > 0 && ' (increase only)'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={saveMutation.isPending}
            data-testid="button-reset-ranges"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset to Defaults
          </Button>
          <Button
            onClick={() => saveMutation.mutate(ranges)}
            disabled={!hasChanges || saveMutation.isPending}
            className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/90"
            data-testid="button-save-ranges"
          >
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>

        {/* Info Box */}
        <div className="bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg p-4">
          <div className="text-sm text-gray-900 dark:text-gray-100 font-medium">
            <strong className="text-gray-900 dark:text-white">How it works:</strong> These ranges define the potential adjustment for each factor. 
            The actual adjustment applied depends on the weight percentage set in the Pricing Weights tab. 
            For example, if Occupancy has a range of -10% to +5% and a weight of 50%, the actual adjustment 
            will be between -5% and +2.5%.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}