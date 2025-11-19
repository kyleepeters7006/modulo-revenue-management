import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const defaultGuardrails = {
  min_price_change_pct: -15,
  max_price_change_pct: 25,
  min_absolute_price: 2500,
  max_absolute_price: 15000,
  competitor_variance_limit: 0.1,
  occupancy_threshold: 0.95,
  vacancy_days_threshold: 30,
  seasonal_adjustments: {
    summer: 1.05,
    winter: 0.98
  }
};

interface GuardrailsEditorProps {
  locationId?: string;
  serviceLine?: string;
}

export default function GuardrailsEditor({ locationId, serviceLine }: GuardrailsEditorProps) {
  const [formData, setFormData] = useState(defaultGuardrails);
  const [saveStatus, setSaveStatus] = useState("Configuration ready to save...");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const queryParams = new URLSearchParams();
  if (locationId) queryParams.set('locationId', locationId);
  if (serviceLine) queryParams.set('serviceLine', serviceLine);
  const queryString = queryParams.toString();

  const { data: guardrails } = useQuery({
    queryKey: ["/api/guardrails", locationId, serviceLine],
    queryFn: async () => {
      const url = `/api/guardrails${queryString ? `?${queryString}` : ''}`;
      const res = await fetch(url);
      return res.json();
    },
  });

  useEffect(() => {
    if (guardrails && Object.keys(guardrails).length > 0) {
      setFormData({ ...defaultGuardrails, ...guardrails });
    } else {
      setFormData(defaultGuardrails);
    }
  }, [guardrails]);

  const saveGuardrailsMutation = useMutation({
    mutationFn: async (config: any) => {
      return apiRequest('/api/guardrails', 'POST', { 
        ...config, 
        locationId: locationId || null, 
        serviceLine: serviceLine || null 
      });
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

  const handleInputChange = (field: string, value: string) => {
    const numValue = value === '' ? 0 : parseFloat(value);
    setFormData(prev => ({ ...prev, [field]: numValue }));
    setSaveStatus("Configuration ready to save...");
  };

  const handleSeasonalChange = (season: string, value: string) => {
    const numValue = value === '' ? 0 : parseFloat(value);
    setFormData(prev => ({
      ...prev,
      seasonal_adjustments: {
        ...prev.seasonal_adjustments,
        [season]: numValue
      }
    }));
    setSaveStatus("Configuration ready to save...");
  };

  const handleSave = () => {
    setSaveStatus("Saving...");
    saveGuardrailsMutation.mutate(formData);
  };

  const handleReset = () => {
    setFormData(defaultGuardrails);
    setSaveStatus("Configuration reset to defaults");
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
      
      <div className="space-y-6">
        {/* Price Change Limits */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="min_price_change">Minimum Price Change (%)</Label>
            <Input
              id="min_price_change"
              type="number"
              value={formData.min_price_change_pct}
              onChange={(e) => handleInputChange('min_price_change_pct', e.target.value)}
              className="dashboard-input"
              data-testid="input-min-price-change"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max_price_change">Maximum Price Change (%)</Label>
            <Input
              id="max_price_change"
              type="number"
              value={formData.max_price_change_pct}
              onChange={(e) => handleInputChange('max_price_change_pct', e.target.value)}
              className="dashboard-input"
              data-testid="input-max-price-change"
            />
          </div>
        </div>

        {/* Absolute Price Limits */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="min_absolute_price">Minimum Absolute Price ($)</Label>
            <Input
              id="min_absolute_price"
              type="number"
              value={formData.min_absolute_price}
              onChange={(e) => handleInputChange('min_absolute_price', e.target.value)}
              className="dashboard-input"
              data-testid="input-min-absolute-price"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max_absolute_price">Maximum Absolute Price ($)</Label>
            <Input
              id="max_absolute_price"
              type="number"
              value={formData.max_absolute_price}
              onChange={(e) => handleInputChange('max_absolute_price', e.target.value)}
              className="dashboard-input"
              data-testid="input-max-absolute-price"
            />
          </div>
        </div>

        {/* Competitor Variance Limit */}
        <div className="space-y-2">
          <Label htmlFor="competitor_variance_limit">Competitor Variance Limit (0-1)</Label>
          <p className="text-xs text-[var(--dashboard-muted)] mb-2">
            Maximum allowed deviation from competitor rates (e.g., 0.1 = ±10%)
          </p>
          <Input
            id="competitor_variance_limit"
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={formData.competitor_variance_limit}
            onChange={(e) => handleInputChange('competitor_variance_limit', e.target.value)}
            className="dashboard-input"
            data-testid="input-competitor-variance-limit"
          />
        </div>

        {/* Operational Thresholds */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="occupancy_threshold">Occupancy Threshold (0-1)</Label>
            <Input
              id="occupancy_threshold"
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={formData.occupancy_threshold}
              onChange={(e) => handleInputChange('occupancy_threshold', e.target.value)}
              className="dashboard-input"
              data-testid="input-occupancy-threshold"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vacancy_days_threshold">Vacancy Days Threshold</Label>
            <Input
              id="vacancy_days_threshold"
              type="number"
              value={formData.vacancy_days_threshold}
              onChange={(e) => handleInputChange('vacancy_days_threshold', e.target.value)}
              className="dashboard-input"
              data-testid="input-vacancy-days-threshold"
            />
          </div>
        </div>

        {/* Seasonal Adjustments */}
        <div>
          <Label className="text-base font-medium mb-3 block">Seasonal Adjustments</Label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="summer_adjustment">Summer Multiplier</Label>
              <Input
                id="summer_adjustment"
                type="number"
                step="0.01"
                value={formData.seasonal_adjustments.summer}
                onChange={(e) => handleSeasonalChange('summer', e.target.value)}
                className="dashboard-input"
                data-testid="input-summer-adjustment"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="winter_adjustment">Winter Multiplier</Label>
              <Input
                id="winter_adjustment"
                type="number"
                step="0.01"
                value={formData.seasonal_adjustments.winter}
                onChange={(e) => handleSeasonalChange('winter', e.target.value)}
                className="dashboard-input"
                data-testid="input-winter-adjustment"
              />
            </div>
          </div>
        </div>
        
        {/* Action Buttons */}
        <div className="flex justify-between items-center pt-4 border-t border-[var(--dashboard-border)]">
          <Button
            onClick={handleReset}
            variant="outline"
            disabled={saveGuardrailsMutation.isPending}
            data-testid="button-reset-guardrails"
          >
            Reset to Defaults
          </Button>
          <Button
            onClick={handleSave}
            className="bg-amber-500 hover:bg-amber-600 text-white"
            disabled={saveGuardrailsMutation.isPending}
            data-testid="button-save-guardrails"
          >
            {saveGuardrailsMutation.isPending ? "Saving..." : "Save Guardrails"}
          </Button>
        </div>
        
        {/* Status Message */}
        <div 
          className="text-sm text-[var(--dashboard-muted)] text-center"
          data-testid="text-guardrails-status"
        >
          {saveStatus}
        </div>
      </div>
    </div>
  );
}
