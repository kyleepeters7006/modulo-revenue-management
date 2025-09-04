import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Info, Save, RefreshCw } from 'lucide-react';

interface AiPricingWeights {
  occupancyPressure: number;
  daysVacantDecay: number;
  roomAttributes: number;
  competitorRates: number;
  seasonality: number;
  stockMarket: number;
}

const defaultWeights: AiPricingWeights = {
  occupancyPressure: 20,
  daysVacantDecay: 20,
  roomAttributes: 15,
  competitorRates: 15,
  seasonality: 15,
  stockMarket: 15,
};

const weightDescriptions = {
  occupancyPressure: 'How much occupancy level affects pricing (high occupancy = higher rates)',
  daysVacantDecay: 'Price reduction based on vacancy duration (longer vacancy = lower rates)',
  roomAttributes: 'Premium for unit features like renovations, views, and amenities',
  competitorRates: 'Influence of competitor pricing on unit rates',
  seasonality: 'Seasonal demand impact (peak vs off-season pricing)',
  stockMarket: 'Market trends and economic indicators influence',
};

export function AiPricingWeights() {
  const { toast } = useToast();
  const [localWeights, setLocalWeights] = useState<AiPricingWeights>(defaultWeights);
  const [hasChanges, setHasChanges] = useState(false);

  const { data: weights, isLoading } = useQuery<AiPricingWeights>({
    queryKey: ['/api/ai-pricing-weights'],
  });

  useEffect(() => {
    if (weights) {
      setLocalWeights(weights);
    }
  }, [weights]);

  const saveMutation = useMutation({
    mutationFn: async (data: AiPricingWeights) => {
      await apiRequest('/api/ai-pricing-weights', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ai-pricing-weights'] });
      setHasChanges(false);
      toast({
        title: 'AI Weights Saved',
        description: 'AI pricing weights have been updated successfully.',
      });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to save AI pricing weights.',
        variant: 'destructive',
      });
    },
  });

  const handleWeightChange = (key: keyof AiPricingWeights, value: number) => {
    const oldValue = localWeights[key];
    const diff = value - oldValue;
    
    // Don't update if no change
    if (diff === 0) return;
    
    const otherKeys = Object.keys(localWeights).filter(k => k !== key) as (keyof AiPricingWeights)[];
    const totalOthers = otherKeys.reduce((sum, k) => sum + localWeights[k], 0);
    
    const newWeights = { ...localWeights };
    newWeights[key] = value;
    
    // Redistribute the difference proportionally among other weights
    if (totalOthers > 0) {
      otherKeys.forEach(k => {
        const proportion = localWeights[k] / totalOthers;
        newWeights[k] = Math.max(0, Math.min(100, localWeights[k] - diff * proportion));
      });
    }
    
    // Ensure total is 100 (handle rounding errors)
    const total = Object.values(newWeights).reduce((sum, v) => sum + v, 0);
    if (Math.abs(total - 100) > 0.1) {
      const adjustment = (100 - total) / otherKeys.length;
      otherKeys.forEach(k => {
        newWeights[k] = Math.max(0, Math.min(100, newWeights[k] + adjustment));
      });
    }
    
    // Round to nearest integer
    Object.keys(newWeights).forEach(k => {
      newWeights[k as keyof AiPricingWeights] = Math.round(newWeights[k as keyof AiPricingWeights]);
    });
    
    // Final adjustment to ensure exactly 100
    const finalTotal = Object.values(newWeights).reduce((sum, v) => sum + v, 0);
    if (finalTotal !== 100) {
      const largestKey = otherKeys.reduce((max, k) => 
        newWeights[k] > newWeights[max] ? k : max, otherKeys[0]);
      newWeights[largestKey] += 100 - finalTotal;
    }
    
    setLocalWeights(newWeights);
    setHasChanges(true);
  };

  const handleReset = () => {
    setLocalWeights(weights || defaultWeights);
    setHasChanges(false);
  };

  const handleSave = () => {
    saveMutation.mutate(localWeights);
  };

  const total = Object.values(localWeights).reduce((sum, weight) => sum + weight, 0);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Pricing Weights</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-[var(--dashboard-muted)]">Loading weights...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>AI Pricing Weights</CardTitle>
            <CardDescription>
              Configure how AI algorithm factors influence pricing decisions (must total 100%)
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold ${Math.abs(total - 100) < 0.1 ? 'text-green-700' : 'text-red-700'}`}>
              Total: {total}%
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {Object.entries(localWeights).map(([key, value]) => (
          <div key={key} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-[var(--dashboard-text)] capitalize">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </label>
                <div className="group relative">
                  <Info className="h-3 w-3 text-[var(--dashboard-muted)]" />
                  <div className="absolute left-0 bottom-full mb-1 hidden group-hover:block w-64 p-2 bg-[var(--dashboard-card)] border border-[var(--dashboard-border)] rounded-md shadow-lg z-10">
                    <p className="text-xs text-[var(--dashboard-muted)]">
                      {weightDescriptions[key as keyof AiPricingWeights]}
                    </p>
                  </div>
                </div>
              </div>
              <span className="text-sm font-medium text-[var(--dashboard-accent)] min-w-[3rem] text-right">
                {value}%
              </span>
            </div>
            <Slider
              value={[value]}
              onValueChange={(values) => handleWeightChange(key as keyof AiPricingWeights, values[0])}
              min={0}
              max={100}
              step={1}
              className="w-full"
              data-testid={`slider-ai-weight-${key}`}
            />
          </div>
        ))}
        
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
              data-testid="button-reset-ai-weights"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Reset
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges || Math.abs(total - 100) > 0.1 || saveMutation.isPending}
              data-testid="button-save-ai-weights"
            >
              <Save className="h-4 w-4 mr-1" />
              Save AI Weights
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}