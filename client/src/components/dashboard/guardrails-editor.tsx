import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface GuardrailsForm {
  minPriceChangePct: number;
  maxPriceChangePct: number;
  minAbsolutePrice: number | null;
  maxAbsolutePrice: number | null;
}

const defaultGuardrails: GuardrailsForm = {
  minPriceChangePct: -5,
  maxPriceChangePct: 15,
  minAbsolutePrice: null,
  maxAbsolutePrice: null,
};

function formatCurrency(value: number | null): string {
  return value == null ? '' : Math.round(value).toLocaleString('en-US');
}

function parseCurrency(raw: string): number | null {
  const stripped = raw.replace(/[^0-9]/g, '');
  return stripped === '' ? null : parseInt(stripped, 10);
}

interface CurrencyInputProps {
  id: string;
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  className?: string;
  'data-testid'?: string;
}

function CurrencyInput({ id, value, onChange, placeholder, className, 'data-testid': testId }: CurrencyInputProps) {
  const [displayValue, setDisplayValue] = useState(formatCurrency(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDisplayValue(formatCurrency(value));
    }
  }, [value, focused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setDisplayValue(raw);
    onChange(parseCurrency(raw));
  };

  const handleFocus = () => {
    setFocused(true);
    setDisplayValue(value == null ? '' : Math.round(value).toString());
  };

  const handleBlur = () => {
    setFocused(false);
    setDisplayValue(formatCurrency(value));
  };

  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      value={displayValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={className}
      data-testid={testId}
    />
  );
}

interface GuardrailsEditorProps {
  locationId?: string;
  serviceLine?: string;
}

export default function GuardrailsEditor({ locationId, serviceLine }: GuardrailsEditorProps) {
  const [formData, setFormData] = useState<GuardrailsForm>(defaultGuardrails);
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
      setFormData({
        minPriceChangePct: guardrails.minPriceChangePct ?? defaultGuardrails.minPriceChangePct,
        maxPriceChangePct: guardrails.maxPriceChangePct ?? defaultGuardrails.maxPriceChangePct,
        minAbsolutePrice: guardrails.minAbsolutePrice ?? null,
        maxAbsolutePrice: guardrails.maxAbsolutePrice ?? null,
      });
    } else {
      setFormData(defaultGuardrails);
    }
  }, [guardrails]);

  const saveGuardrailsMutation = useMutation({
    mutationFn: async (config: GuardrailsForm) => {
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

  const handlePctChange = (field: 'minPriceChangePct' | 'maxPriceChangePct', value: string) => {
    const numValue = value === '' || value === '-' ? 0 : parseFloat(value);
    setFormData(prev => ({ ...prev, [field]: numValue }));
    setSaveStatus("Configuration ready to save...");
  };

  const handleCurrencyChange = (field: 'minAbsolutePrice' | 'maxAbsolutePrice', value: number | null) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setSaveStatus("Configuration ready to save...");
  };

  const handleSave = () => {
    if (formData.minPriceChangePct > formData.maxPriceChangePct) {
      setSaveStatus("Minimum price change % cannot exceed maximum price change %");
      toast({
        title: "Invalid Guardrails",
        description: "Minimum price change % cannot exceed maximum price change %.",
        variant: "destructive",
      });
      return;
    }
    if (
      formData.minAbsolutePrice != null &&
      formData.maxAbsolutePrice != null &&
      formData.minAbsolutePrice > formData.maxAbsolutePrice
    ) {
      setSaveStatus("Minimum absolute price cannot exceed maximum absolute price");
      toast({
        title: "Invalid Guardrails",
        description: "Minimum absolute price cannot exceed maximum absolute price.",
        variant: "destructive",
      });
      return;
    }
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
            Hard limits on proposed rates — guardrails always override pricing rules
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Price Change Limits */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="min_price_change">Minimum Price Change (%)</Label>
            <p className="text-xs text-[var(--dashboard-muted)]">
              Largest allowed decrease vs. street rate (e.g., -5 = down to 5% below)
            </p>
            <Input
              id="min_price_change"
              type="number"
              step="0.5"
              value={formData.minPriceChangePct}
              onChange={(e) => handlePctChange('minPriceChangePct', e.target.value)}
              className="dashboard-input"
              data-testid="input-min-price-change"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max_price_change">Maximum Price Change (%)</Label>
            <p className="text-xs text-[var(--dashboard-muted)]">
              Largest allowed increase vs. street rate (e.g., 15 = up to 15% above)
            </p>
            <Input
              id="max_price_change"
              type="number"
              step="0.5"
              value={formData.maxPriceChangePct}
              onChange={(e) => handlePctChange('maxPriceChangePct', e.target.value)}
              className="dashboard-input"
              data-testid="input-max-price-change"
            />
          </div>
        </div>

        {/* Absolute Price Limits */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="min_absolute_price">Minimum Absolute Price ($)</Label>
            <p className="text-xs text-[var(--dashboard-muted)]">
              Hard floor — leave blank for no floor
            </p>
            <CurrencyInput
              id="min_absolute_price"
              value={formData.minAbsolutePrice}
              onChange={(v) => handleCurrencyChange('minAbsolutePrice', v)}
              placeholder="No floor"
              className="dashboard-input"
              data-testid="input-min-absolute-price"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max_absolute_price">Maximum Absolute Price ($)</Label>
            <p className="text-xs text-[var(--dashboard-muted)]">
              Hard ceiling — leave blank for no ceiling
            </p>
            <CurrencyInput
              id="max_absolute_price"
              value={formData.maxAbsolutePrice}
              onChange={(v) => handleCurrencyChange('maxAbsolutePrice', v)}
              placeholder="No ceiling"
              className="dashboard-input"
              data-testid="input-max-absolute-price"
            />
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
