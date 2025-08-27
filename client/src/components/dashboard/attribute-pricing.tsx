import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Settings, Target, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface AttributePricing {
  viewPremium: number;
  renovatedPremium: number;
  cornerPremium: number;
  memoryCareUpcharge: number;
  vacancyDiscount: number;
  occupancyPremium: number;
}

export default function AttributePricing() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<AttributePricing>({
    viewPremium: 5,
    renovatedPremium: 8,
    cornerPremium: 2,
    memoryCareUpcharge: 2,
    vacancyDiscount: 4,
    occupancyPremium: 3,
  });

  const { data: recommendations, refetch } = useQuery({
    queryKey: ["/api/recommendations"],
    refetchInterval: false,
  });

  const updatePricingMutation = useMutation({
    mutationFn: async (newSettings: AttributePricing) => {
      return apiRequest('POST', '/api/attribute-pricing', newSettings);
    },
    onSuccess: () => {
      toast({
        title: "Pricing Updated",
        description: "Attribute pricing settings have been applied",
      });
      refetch();
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSliderChange = (attribute: keyof AttributePricing, value: number[]) => {
    setSettings(prev => ({
      ...prev,
      [attribute]: value[0]
    }));
  };

  const handleApplySettings = () => {
    updatePricingMutation.mutate(settings);
  };

  const handleReset = () => {
    const defaultSettings = {
      viewPremium: 5,
      renovatedPremium: 8,
      cornerPremium: 2,
      memoryCareUpcharge: 2,
      vacancyDiscount: 4,
      occupancyPremium: 3,
    };
    setSettings(defaultSettings);
  };

  const getImpactColor = (value: number) => {
    if (value >= 6) return "text-[var(--trilogy-success)]";
    if (value >= 3) return "text-[var(--trilogy-warning)]";
    return "text-[var(--dashboard-muted)]";
  };

  const getImpactBadge = (value: number) => {
    if (value >= 6) return <Badge className="bg-[var(--trilogy-success)]/10 text-[var(--trilogy-success)]">High Impact</Badge>;
    if (value >= 3) return <Badge className="bg-[var(--trilogy-warning)]/10 text-[var(--trilogy-warning)]">Medium Impact</Badge>;
    return <Badge className="bg-gray-500/10 text-gray-500">Low Impact</Badge>;
  };

  return (
    <div className="dashboard-card mb-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-[var(--trilogy-navy)]/10 rounded-lg flex items-center justify-center">
            <Target className="w-5 h-5 text-[var(--trilogy-navy)]" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[var(--dashboard-text)]" data-testid="text-attribute-pricing-title">
              Attribute Pricing Controls
            </h3>
            <p className="text-sm text-[var(--dashboard-muted)]">
              Customize pricing adjustments based on unit attributes
            </p>
          </div>
        </div>
        <div className="flex space-x-2">
          <Button
            onClick={handleReset}
            variant="outline"
            size="sm"
            className="border-[var(--dashboard-border)] text-[var(--dashboard-text)]"
            data-testid="button-reset-pricing"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset
          </Button>
          <Button
            onClick={handleApplySettings}
            disabled={updatePricingMutation.isPending}
            size="sm"
            className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/80 text-white"
            data-testid="button-apply-pricing"
          >
            <Settings className="w-4 h-4 mr-2" />
            {updatePricingMutation.isPending ? "Applying..." : "Apply Settings"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Premium Attributes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Premium Attributes</CardTitle>
            <CardDescription>Adjust pricing for desirable unit features</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Premium View</Label>
                <div className="flex items-center space-x-2">
                  <span className={`text-sm font-medium ${getImpactColor(settings.viewPremium)}`}>
                    +{settings.viewPremium}%
                  </span>
                  {getImpactBadge(settings.viewPremium)}
                </div>
              </div>
              <Slider
                value={[settings.viewPremium]}
                onValueChange={(value) => handleSliderChange('viewPremium', value)}
                max={15}
                min={0}
                step={0.5}
                className="w-full"
                data-testid="slider-view-premium"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Recently Renovated</Label>
                <div className="flex items-center space-x-2">
                  <span className={`text-sm font-medium ${getImpactColor(settings.renovatedPremium)}`}>
                    +{settings.renovatedPremium}%
                  </span>
                  {getImpactBadge(settings.renovatedPremium)}
                </div>
              </div>
              <Slider
                value={[settings.renovatedPremium]}
                onValueChange={(value) => handleSliderChange('renovatedPremium', value)}
                max={15}
                min={0}
                step={0.5}
                className="w-full"
                data-testid="slider-renovated-premium"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Corner Unit</Label>
                <div className="flex items-center space-x-2">
                  <span className={`text-sm font-medium ${getImpactColor(settings.cornerPremium)}`}>
                    +{settings.cornerPremium}%
                  </span>
                  {getImpactBadge(settings.cornerPremium)}
                </div>
              </div>
              <Slider
                value={[settings.cornerPremium]}
                onValueChange={(value) => handleSliderChange('cornerPremium', value)}
                max={10}
                min={0}
                step={0.5}
                className="w-full"
                data-testid="slider-corner-premium"
              />
            </div>
          </CardContent>
        </Card>

        {/* Occupancy & Care Adjustments */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Occupancy & Care Adjustments</CardTitle>
            <CardDescription>Modify pricing based on occupancy status and care level</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Memory Care Upcharge</Label>
                <div className="flex items-center space-x-2">
                  <span className={`text-sm font-medium ${getImpactColor(settings.memoryCareUpcharge)}`}>
                    +{settings.memoryCareUpcharge}%
                  </span>
                  {getImpactBadge(settings.memoryCareUpcharge)}
                </div>
              </div>
              <Slider
                value={[settings.memoryCareUpcharge]}
                onValueChange={(value) => handleSliderChange('memoryCareUpcharge', value)}
                max={10}
                min={0}
                step={0.5}
                className="w-full"
                data-testid="slider-memory-care-upcharge"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Vacancy Discount (30+ days)</Label>
                <div className="flex items-center space-x-2">
                  <span className={`text-sm font-medium text-[var(--trilogy-error)]`}>
                    -{settings.vacancyDiscount}%
                  </span>
                  <Badge className="bg-[var(--trilogy-error)]/10 text-[var(--trilogy-error)]">Discount</Badge>
                </div>
              </div>
              <Slider
                value={[settings.vacancyDiscount]}
                onValueChange={(value) => handleSliderChange('vacancyDiscount', value)}
                max={12}
                min={0}
                step={0.5}
                className="w-full"
                data-testid="slider-vacancy-discount"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Occupancy Premium</Label>
                <div className="flex items-center space-x-2">
                  <span className={`text-sm font-medium ${getImpactColor(settings.occupancyPremium)}`}>
                    +{settings.occupancyPremium}%
                  </span>
                  {getImpactBadge(settings.occupancyPremium)}
                </div>
              </div>
              <Slider
                value={[settings.occupancyPremium]}
                onValueChange={(value) => handleSliderChange('occupancyPremium', value)}
                max={8}
                min={0}
                step={0.5}
                className="w-full"
                data-testid="slider-occupancy-premium"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 p-4 bg-[var(--dashboard-bg)] rounded-lg">
        <h4 className="text-sm font-medium text-[var(--dashboard-text)] mb-2">Impact Summary</h4>
        <p className="text-xs text-[var(--dashboard-muted)]">
          These settings will be applied to {recommendations?.items?.length || 0} units in the next pricing calculation.
          High impact adjustments (6%+) significantly affect pricing recommendations.
        </p>
      </div>
    </div>
  );
}