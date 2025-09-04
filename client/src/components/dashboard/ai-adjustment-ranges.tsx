import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Save, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { DialPicker } from '@/components/ui/dial-picker';

interface AiAdjustmentRanges {
  occupancyMin: number;
  occupancyMax: number;
  vacancyMin: number;
  vacancyMax: number;
  attributesMin: number;
  attributesMax: number;
  competitorMin: number;
  competitorMax: number;
  seasonalMin: number;
  seasonalMax: number;
  marketMin: number;
  marketMax: number;
}

const defaultRanges: AiAdjustmentRanges = {
  occupancyMin: -0.15,
  occupancyMax: 0.15,
  vacancyMin: -0.30,
  vacancyMax: 0.00,
  attributesMin: 0.00,
  attributesMax: 0.20,
  competitorMin: -0.15,
  competitorMax: 0.15,
  seasonalMin: -0.08,
  seasonalMax: 0.08,
  marketMin: 0.00,
  marketMax: 0.05
};

const rangeDescriptions = {
  occupancy: 'Price adjustment based on occupancy levels',
  vacancy: 'Price reduction for vacant units over time',
  attributes: 'Premium for unit features and amenities',
  competitor: 'Adjustment based on competitor pricing',
  seasonal: 'Seasonal demand fluctuation impact',
  market: 'Market trends and economic conditions',
};

export function AiAdjustmentRanges() {
  const { toast } = useToast();
  const [localRanges, setLocalRanges] = useState<AiAdjustmentRanges>(defaultRanges);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: ranges, isLoading } = useQuery<AiAdjustmentRanges>({
    queryKey: ['/api/ai-adjustment-ranges'],
  });

  useEffect(() => {
    if (ranges) {
      setLocalRanges(ranges);
    }
  }, [ranges]);

  const saveMutation = useMutation({
    mutationFn: async (data: AiAdjustmentRanges) => {
      await apiRequest('/api/ai-adjustment-ranges', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-adjustment-ranges'] });
      setHasChanges(false);
      toast({
        title: 'AI Ranges Saved',
        description: 'AI adjustment ranges have been updated successfully.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to save AI adjustment ranges.',
        variant: 'destructive',
      });
    },
  });

  const handleRangeChange = (key: keyof AiAdjustmentRanges, value: string) => {
    const numValue = parseFloat(value) || 0;
    setLocalRanges(prev => ({ ...prev, [key]: numValue }));
    setHasChanges(true);
  };

  const handleReset = () => {
    setLocalRanges(ranges || defaultRanges);
    setHasChanges(false);
  };

  const handleSave = () => {
    saveMutation.mutate(localRanges);
  };

  const formatPercentage = (value: number) => {
    return (value * 100).toFixed(0);
  };

  const parsePercentage = (value: string) => {
    return parseFloat(value) / 100;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Adjustment Ranges</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-[var(--dashboard-muted)]">Loading ranges...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Adjustment Ranges</CardTitle>
        <CardDescription>
          Set min/max pricing adjustment limits for each AI factor
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Occupancy Pressure */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Occupancy Pressure</Label>
          <p className="text-xs text-[var(--dashboard-muted)]">{rangeDescriptions.occupancy}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="h-5 w-5 text-red-500" strokeWidth={3.5} />
                <Label className="text-xs">Min Adjustment</Label>
              </div>
              <div className="flex items-center gap-2">
                <DialPicker
                  value={parseFloat(formatPercentage(localRanges.occupancyMin))}
                  onChange={(value) => handleRangeChange('occupancyMin', parsePercentage(value.toString()).toString())}
                  min={-50}
                  max={50}
                  step={1}
                  suffix="%"
                  className="w-20"
                  data-testid="input-ai-occupancy-min"
                />
                <span className="text-sm text-[var(--dashboard-muted)]">%</span>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-5 w-5 text-green-500" strokeWidth={3.5} />
                <Label className="text-xs">Max Adjustment</Label>
              </div>
              <div className="flex items-center gap-2">
                <DialPicker
                  value={parseFloat(formatPercentage(localRanges.occupancyMax))}
                  onChange={(value) => handleRangeChange('occupancyMax', parsePercentage(value.toString()).toString())}
                  min={-50}
                  max={50}
                  step={1}
                  suffix="%"
                  className="w-20"
                  data-testid="input-ai-occupancy-max"
                />
                <span className="text-sm text-[var(--dashboard-muted)]">%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Vacancy Decay */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Vacancy Decay</Label>
          <p className="text-xs text-[var(--dashboard-muted)]">{rangeDescriptions.vacancy}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="h-5 w-5 text-red-500" strokeWidth={3.5} />
                <Label className="text-xs">Min Adjustment</Label>
              </div>
              <div className="flex items-center gap-2">
                <DialPicker
                  value={parseFloat(formatPercentage(localRanges.vacancyMin))}
                  onChange={(value) => handleRangeChange('vacancyMin', parsePercentage(value.toString()).toString())}
                  min={-50}
                  max={50}
                  step={1}
                  suffix="%"
                  className="w-20"
                  data-testid="input-ai-vacancy-min"
                />
                <span className="text-sm text-[var(--dashboard-muted)]">%</span>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-5 w-5 text-green-500" strokeWidth={3.5} />
                <Label className="text-xs">Max Adjustment</Label>
              </div>
              <div className="flex items-center gap-2">
                <DialPicker
                  value={parseFloat(formatPercentage(localRanges.vacancyMax))}
                  onChange={(value) => handleRangeChange('vacancyMax', parsePercentage(value.toString()).toString())}
                  min={-50}
                  max={50}
                  step={1}
                  suffix="%"
                  className="w-20"
                  data-testid="input-ai-vacancy-max"
                />
                <span className="text-sm text-[var(--dashboard-muted)]">%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Room Attributes */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Room Attributes</Label>
          <p className="text-xs text-[var(--dashboard-muted)]">{rangeDescriptions.attributes}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="h-5 w-5 text-red-500" strokeWidth={3.5} />
                <Label className="text-xs">Min Adjustment</Label>
              </div>
              <div className="flex items-center gap-2">
                <DialPicker
                  value={parseFloat(formatPercentage(localRanges.attributesMin))}
                  onChange={(value) => handleRangeChange('attributesMin', parsePercentage(value.toString()).toString())}
                  min={-50}
                  max={50}
                  step={1}
                  suffix="%"
                  className="w-20"
                  data-testid="input-ai-attributes-min"
                />
                <span className="text-sm text-[var(--dashboard-muted)]">%</span>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-5 w-5 text-green-500" strokeWidth={3.5} />
                <Label className="text-xs">Max Adjustment</Label>
              </div>
              <div className="flex items-center gap-2">
                <DialPicker
                  value={parseFloat(formatPercentage(localRanges.attributesMax))}
                  onChange={(value) => handleRangeChange('attributesMax', parsePercentage(value.toString()).toString())}
                  min={-50}
                  max={50}
                  step={1}
                  suffix="%"
                  className="w-20"
                  data-testid="input-ai-attributes-max"
                />
                <span className="text-sm text-[var(--dashboard-muted)]">%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Competitor Rates */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Competitor Rates</Label>
          <p className="text-xs text-[var(--dashboard-muted)]">{rangeDescriptions.competitor}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="h-5 w-5 text-red-500" strokeWidth={3.5} />
                <Label className="text-xs">Min Adjustment</Label>
              </div>
              <div className="flex items-center gap-2">
                <DialPicker
                  value={parseFloat(formatPercentage(localRanges.competitorMin))}
                  onChange={(value) => handleRangeChange('competitorMin', parsePercentage(value.toString()).toString())}
                  min={-50}
                  max={50}
                  step={1}
                  suffix="%"
                  className="w-20"
                  data-testid="input-ai-competitor-min"
                />
                <span className="text-sm text-[var(--dashboard-muted)]">%</span>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-5 w-5 text-green-500" strokeWidth={3.5} />
                <Label className="text-xs">Max Adjustment</Label>
              </div>
              <div className="flex items-center gap-2">
                <DialPicker
                  value={parseFloat(formatPercentage(localRanges.competitorMax))}
                  onChange={(value) => handleRangeChange('competitorMax', parsePercentage(value.toString()).toString())}
                  min={-50}
                  max={50}
                  step={1}
                  suffix="%"
                  className="w-20"
                  data-testid="input-ai-competitor-max"
                />
                <span className="text-sm text-[var(--dashboard-muted)]">%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Seasonality */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Seasonality</Label>
          <p className="text-xs text-[var(--dashboard-muted)]">{rangeDescriptions.seasonal}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="h-5 w-5 text-red-500" strokeWidth={3.5} />
                <Label className="text-xs">Min Adjustment</Label>
              </div>
              <div className="flex items-center gap-2">
                <DialPicker
                  value={parseFloat(formatPercentage(localRanges.seasonalMin))}
                  onChange={(value) => handleRangeChange('seasonalMin', parsePercentage(value.toString()).toString())}
                  min={-50}
                  max={50}
                  step={1}
                  suffix="%"
                  className="w-20"
                  data-testid="input-ai-seasonal-min"
                />
                <span className="text-sm text-[var(--dashboard-muted)]">%</span>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-5 w-5 text-green-500" strokeWidth={3.5} />
                <Label className="text-xs">Max Adjustment</Label>
              </div>
              <div className="flex items-center gap-2">
                <DialPicker
                  value={parseFloat(formatPercentage(localRanges.seasonalMax))}
                  onChange={(value) => handleRangeChange('seasonalMax', parsePercentage(value.toString()).toString())}
                  min={-50}
                  max={50}
                  step={1}
                  suffix="%"
                  className="w-20"
                  data-testid="input-ai-seasonal-max"
                />
                <span className="text-sm text-[var(--dashboard-muted)]">%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Market Conditions */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Market Conditions</Label>
          <p className="text-xs text-[var(--dashboard-muted)]">{rangeDescriptions.market}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="h-5 w-5 text-red-500" strokeWidth={3.5} />
                <Label className="text-xs">Min Adjustment</Label>
              </div>
              <div className="flex items-center gap-2">
                <DialPicker
                  value={parseFloat(formatPercentage(localRanges.marketMin))}
                  onChange={(value) => handleRangeChange('marketMin', parsePercentage(value.toString()).toString())}
                  min={-50}
                  max={50}
                  step={1}
                  suffix="%"
                  className="w-20"
                  data-testid="input-ai-market-min"
                />
                <span className="text-sm text-[var(--dashboard-muted)]">%</span>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-5 w-5 text-green-500" strokeWidth={3.5} />
                <Label className="text-xs">Max Adjustment</Label>
              </div>
              <div className="flex items-center gap-2">
                <DialPicker
                  value={parseFloat(formatPercentage(localRanges.marketMax))}
                  onChange={(value) => handleRangeChange('marketMax', parsePercentage(value.toString()).toString())}
                  min={-50}
                  max={50}
                  step={1}
                  suffix="%"
                  className="w-20"
                  data-testid="input-ai-market-max"
                />
                <span className="text-sm text-[var(--dashboard-muted)]">%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-[var(--dashboard-border)]">
          <div className="text-sm text-[var(--dashboard-muted)]">
            {hasChanges && 'You have unsaved changes'}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!hasChanges || saveMutation.isPending}
              data-testid="button-reset-ai-ranges"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges || saveMutation.isPending}
              data-testid="button-save-ai-ranges"
            >
              <Save className="h-4 w-4 mr-1" />
              Save AI Ranges
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}