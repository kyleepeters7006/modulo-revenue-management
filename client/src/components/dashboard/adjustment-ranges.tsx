import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, RotateCcw, TrendingUp, TrendingDown, SlidersHorizontal } from "lucide-react";
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

interface AdjustmentRangesProps {
  locationId?: string;
  serviceLine?: string;
}

export default function AdjustmentRanges({ locationId, serviceLine }: AdjustmentRangesProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [ranges, setRanges] = useState<AdjustmentRange>(defaultRanges);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const queryParams = new URLSearchParams();
  if (locationId) queryParams.set('locationId', locationId);
  if (serviceLine) queryParams.set('serviceLine', serviceLine);
  const queryString = queryParams.toString();

  const { data: savedRanges, isLoading } = useQuery<AdjustmentRange>({
    queryKey: ['/api/adjustment-ranges', locationId, serviceLine],
    queryFn: async () => {
      const url = `/api/adjustment-ranges${queryString ? `?${queryString}` : ''}`;
      const res = await fetch(url);
      return res.json();
    },
  });

  const { mutate: saveRanges, isPending: isSavingMutation } = useMutation({
    mutationFn: async (data: AdjustmentRange) => {
      console.log('Saving adjustment ranges:', { locationId, serviceLine, data });
      await apiRequest('/api/adjustment-ranges', 'PUT', { 
        ...data, 
        locationId: locationId || null, 
        serviceLine: serviceLine || null 
      });
    },
    onSuccess: () => {
      console.log('Adjustment ranges saved successfully');
      // Invalidate all related cache keys
      queryClient.invalidateQueries({ queryKey: ['/api/adjustment-ranges'] });
      queryClient.invalidateQueries({ queryKey: ['/api/calculation'] });
      queryClient.invalidateQueries({ queryKey: ['/api/adjustment-rules'] });
      setHasChanges(false);
      setIsSaving(false);
      toast({
        title: "Saved",
        description: "Adjustment ranges updated successfully",
      });
    },
    onError: (error) => {
      console.error('Error saving adjustment ranges:', error);
      setIsSaving(false);
      toast({
        title: "Error",
        description: "Failed to update adjustment ranges.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (savedRanges && !hasChanges) {
      setRanges(savedRanges);
    }
  }, [savedRanges, hasChanges]);

  // Auto-save with debounce
  useEffect(() => {
    if (!hasChanges) return;
    
    console.log('Auto-save triggered, waiting 2s...', { ranges, locationId, serviceLine });
    const timeoutId = setTimeout(() => {
      console.log('Auto-save executing...');
      setIsSaving(true);
      saveRanges(ranges);
    }, 2000); // 2 second debounce

    return () => clearTimeout(timeoutId);
  }, [ranges, hasChanges, locationId, serviceLine, saveRanges]);

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
      <div className="dashboard-card mb-8">
        <div className="flex justify-center items-center h-64">
          <div className="text-[var(--dashboard-muted)]">Loading adjustment ranges...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-card mb-8">
      <div className="flex items-center space-x-3 mb-6">
        <div className="w-10 h-10 bg-[var(--trilogy-navy)]/10 rounded-lg flex items-center justify-center">
          <SlidersHorizontal className="w-5 h-5 text-[var(--trilogy-navy)]" />
        </div>
        <div className="flex-1">
          <div>
            <h3 className="text-lg font-semibold text-[var(--dashboard-text)]">
              Adjustment Ranges Configuration
            </h3>
            <p className="text-sm text-[var(--dashboard-muted)]">
              Set the minimum and maximum adjustment percentages for each pricing factor
            </p>
          </div>
        </div>
        {hasChanges && (
          <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            Unsaved Changes
          </Badge>
        )}
      </div>
      
      <div className="space-y-6">
        <div className="space-y-4">
          {factors.map((factor) => {
            const minKey = `${factor.key}Min` as keyof AdjustmentRange;
            const maxKey = `${factor.key}Max` as keyof AdjustmentRange;
            const minValue = ranges[minKey];
            const maxValue = ranges[maxKey];

            return (
              <div 
                key={factor.key} 
                className="p-4 bg-[var(--dashboard-surface)] rounded-lg border border-[var(--dashboard-border)] hover:border-[var(--trilogy-teal)]/30 transition-colors"
              >
                <div className="mb-3">
                  <Label className="text-base font-semibold text-[var(--dashboard-text)]">
                    {factor.label}
                  </Label>
                  <div className="text-xs text-[var(--dashboard-muted)] mt-1">{factor.description}</div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm text-[var(--dashboard-muted)] mb-1 flex items-center gap-1">
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
                      <span className="text-sm text-[var(--dashboard-muted)]">%</span>
                      {minValue < 0 ? <TrendingDown className="w-5 h-5 text-red-600" strokeWidth={3.5} /> : minValue > 0 ? <TrendingUp className="w-5 h-5 text-green-600" strokeWidth={3.5} /> : <span className="text-[var(--dashboard-muted)]">—</span>}
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm text-[var(--dashboard-muted)] mb-1 flex items-center gap-1">
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
                      <span className="text-sm text-[var(--dashboard-muted)]">%</span>
                      {maxValue < 0 ? <TrendingDown className="w-5 h-5 text-red-600" strokeWidth={3.5} /> : maxValue > 0 ? <TrendingUp className="w-5 h-5 text-green-600" strokeWidth={3.5} /> : <span className="text-[var(--dashboard-muted)]">—</span>}
                    </div>
                  </div>
                </div>

                <div className="mt-2 text-xs text-[var(--dashboard-muted)]">
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
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-[var(--dashboard-border)]">
          <div className="text-sm text-[var(--dashboard-muted)]">
            {hasChanges ? "Changes pending save" : "All changes saved"}
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={isSavingMutation}
              className="border-[var(--dashboard-border)] text-[var(--dashboard-text)] hover:bg-[var(--dashboard-surface)]"
              data-testid="button-reset-ranges"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset to Defaults
            </Button>
            <Button
              onClick={() => saveRanges(ranges)}
              disabled={!hasChanges || isSavingMutation}
              className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/90 text-white"
              data-testid="button-save-ranges"
            >
              <Save className="w-4 h-4 mr-2" />
              {isSavingMutation ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-6 p-4 bg-[var(--dashboard-bg)] rounded-lg border border-[var(--dashboard-border)]">
          <div className="text-sm text-[var(--dashboard-text)]">
            <strong className="text-[var(--dashboard-text)]">How it works:</strong> These ranges define the potential adjustment for each factor. 
            The actual adjustment applied depends on the weight percentage set in the Pricing Weights tab. 
            For example, if Occupancy has a range of -10% to +5% and a weight of 50%, the actual adjustment 
            will be between -5% and +2.5%.
          </div>
        </div>
      </div>
    </div>
  );
}