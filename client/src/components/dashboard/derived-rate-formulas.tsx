/**
 * DerivedRateFormulas — the panel where pricing policy for non-base rates is set.
 *
 * The base rate (single occupant, standard stay) is measured from the rent
 * roll. Everything else — second occupant, semi-private, respite, rehab/TCU,
 * bed hold, couple — is DERIVED from it by the formulas edited here, so a
 * change to the base rate flows through consistently instead of six separately
 * drifting averages.
 *
 * The preview column is the point of the screen: a percentage is abstract, a
 * dollar figure is not. It recalculates as you type, against a base rate the
 * user chooses, so a fat-fingered 820% is obvious before it is saved.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Calculator, Info, Loader2, RotateCcw, Save } from "lucide-react";
import {
  DERIVED_RATE_TYPE_META,
  applyDerivedFormula,
  describeFormula,
  validateFormula,
  type DerivedRateType,
} from "@shared/derivedRates";

interface StoredFormula {
  rateType: DerivedRateType;
  serviceLine: string | null;
  percentOfBase: number;
  dollarOffset: number;
  enabled: boolean;
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Editable draft: numbers are held as strings so a half-typed "-" or "" is
 *  not coerced to 0 under the user's cursor. */
interface Draft {
  percentOfBase: string;
  dollarOffset: string;
  enabled: boolean;
}

export default function DerivedRateFormulas() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ formulas: StoredFormula[] }>({
    queryKey: ["/api/derived-rate-formulas"],
    queryFn: async () => {
      const res = await fetch("/api/derived-rate-formulas");
      if (!res.ok) throw new Error("Failed to load derived rate formulas");
      return res.json();
    },
  });

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // A base rate to preview against. HC is priced per day, so $400 is a
  // realistic single-occupant skilled rate rather than an arbitrary round
  // number. Purely a display aid — never saved, never used in a calculation.
  const [previewBase, setPreviewBase] = useState("400");

  // Seed the editor once the server responds. Keyed off the server payload so
  // a refetch after save re-syncs, but typing is never clobbered mid-edit.
  useEffect(() => {
    if (!data?.formulas) return;
    const next: Record<string, Draft> = {};
    for (const f of data.formulas) {
      next[f.rateType] = {
        percentOfBase: String(f.percentOfBase),
        dollarOffset: String(f.dollarOffset),
        enabled: f.enabled,
      };
    }
    setDrafts(next);
  }, [data]);

  const savedByType = useMemo(() => {
    const m = new Map<string, StoredFormula>();
    for (const f of data?.formulas ?? []) m.set(f.rateType, f);
    return m;
  }, [data]);

  const dirty = useMemo(() => {
    for (const [type, d] of Object.entries(drafts)) {
      const s = savedByType.get(type);
      if (!s) continue;
      if (Number(d.percentOfBase) !== s.percentOfBase) return true;
      if (Number(d.dollarOffset) !== s.dollarOffset) return true;
      if (d.enabled !== s.enabled) return true;
    }
    return false;
  }, [drafts, savedByType]);

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [type, d] of Object.entries(drafts)) {
      const err = validateFormula({
        percentOfBase: Number(d.percentOfBase),
        dollarOffset: Number(d.dollarOffset),
      });
      if (err) out[type] = err;
    }
    return out;
  }, [drafts]);

  const hasErrors = Object.keys(errors).length > 0;

  const save = useMutation({
    mutationFn: async () => {
      const formulas = DERIVED_RATE_TYPE_META.map((m) => ({
        rateType: m.type,
        percentOfBase: Number(drafts[m.type]?.percentOfBase ?? m.defaultPercentOfBase),
        dollarOffset: Number(drafts[m.type]?.dollarOffset ?? m.defaultDollarOffset),
        enabled: drafts[m.type]?.enabled ?? true,
      }));
      const res = await fetch("/api/derived-rate-formulas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formulas }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: (payload: { formulas: StoredFormula[] }) => {
      queryClient.setQueryData(["/api/derived-rate-formulas"], payload);
      queryClient.invalidateQueries({ queryKey: ["/api/derived-rate-formulas"] });
      toast({ title: "Formulas saved", description: "Your derived-rate policy has been updated." });
    },
    onError: (e: Error) =>
      toast({ title: "Could not save formulas", description: e.message, variant: "destructive" }),
  });

  const reset = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/derived-rate-formulas/reset", { method: "POST" });
      if (!res.ok) throw new Error("Failed to reset");
      return res.json();
    },
    onSuccess: (payload: { formulas: StoredFormula[] }) => {
      queryClient.setQueryData(["/api/derived-rate-formulas"], payload);
      queryClient.invalidateQueries({ queryKey: ["/api/derived-rate-formulas"] });
      toast({ title: "Reset to defaults", description: "Saved formulas were removed." });
    },
    onError: (e: Error) =>
      toast({ title: "Could not reset", description: e.message, variant: "destructive" }),
  });

  const base = Number(previewBase);
  const baseValid = Number.isFinite(base) && base > 0;

  const setField = (type: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [type]: { ...prev[type], ...patch } }));

  return (
    <Card data-testid="card-derived-rate-formulas">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Derived Rate Formulas
        </CardTitle>
        <CardDescription>
          Reference Data and the rule designer price the <strong>base rate</strong> — one resident,
          one room, standard stay. Every other rate is calculated from it using the formulas below,
          so a change to the base rate carries through consistently.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="derived-preview-base" className="text-xs">
              Preview against a base rate of
            </Label>
            <div className="flex items-center gap-1">
              <span className="text-gray-500">$</span>
              <Input
                id="derived-preview-base"
                data-testid="input-derived-preview-base"
                value={previewBase}
                onChange={(e) => setPreviewBase(e.target.value)}
                className="w-28"
                inputMode="decimal"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500 pb-2">
            Preview only — this figure is never saved or used in a calculation.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading formulas…
          </div>
        ) : (
          <div className="border rounded-md divide-y">
            <div className="hidden md:grid grid-cols-12 gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-800/40 text-xs font-medium text-gray-600 dark:text-gray-300">
              <div className="col-span-4">Rate type</div>
              <div className="col-span-2">% of base</div>
              <div className="col-span-2">Dollar offset</div>
              <div className="col-span-3">Preview</div>
              <div className="col-span-1 text-right">On</div>
            </div>

            {DERIVED_RATE_TYPE_META.map((meta) => {
              const d = drafts[meta.type] ?? {
                percentOfBase: String(meta.defaultPercentOfBase),
                dollarOffset: String(meta.defaultDollarOffset),
                enabled: true,
              };
              const saved = savedByType.get(meta.type);
              const err = errors[meta.type];
              const derived = applyDerivedFormula(baseValid ? base : null, {
                percentOfBase: Number(d.percentOfBase),
                dollarOffset: Number(d.dollarOffset),
                enabled: d.enabled,
              });

              return (
                <div
                  key={meta.type}
                  className="grid grid-cols-1 md:grid-cols-12 gap-3 px-3 py-3 items-center"
                  data-testid={`row-derived-${meta.type}`}
                >
                  <div className="md:col-span-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{meta.label}</span>
                      {saved?.isDefault && (
                        <Badge variant="outline" className="text-[10px]">
                          default
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">{meta.description}</p>
                  </div>

                  <div className="md:col-span-2">
                    <Label className="md:hidden text-xs">% of base</Label>
                    <Input
                      data-testid={`input-percent-${meta.type}`}
                      value={d.percentOfBase}
                      onChange={(e) => setField(meta.type, { percentOfBase: e.target.value })}
                      disabled={!d.enabled}
                      inputMode="decimal"
                      className={err ? "border-red-400" : ""}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <Label className="md:hidden text-xs">Dollar offset</Label>
                    <Input
                      data-testid={`input-offset-${meta.type}`}
                      value={d.dollarOffset}
                      onChange={(e) => setField(meta.type, { dollarOffset: e.target.value })}
                      disabled={!d.enabled}
                      inputMode="decimal"
                      className={err ? "border-red-400" : ""}
                    />
                  </div>

                  <div className="md:col-span-3 text-sm">
                    {err ? (
                      <span className="text-red-600 text-xs">{err}</span>
                    ) : derived == null ? (
                      <span className="text-gray-400 text-xs">
                        {d.enabled ? "Enter a base rate" : "Disabled"}
                      </span>
                    ) : (
                      <div>
                        <span className="font-semibold" data-testid={`text-preview-${meta.type}`}>
                          ${derived.toLocaleString()}
                        </span>
                        <span className="text-xs text-gray-500 ml-2">
                          {describeFormula({
                            percentOfBase: Number(d.percentOfBase),
                            dollarOffset: Number(d.dollarOffset),
                          })}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-1 flex md:justify-end">
                    <Switch
                      data-testid={`switch-enabled-${meta.type}`}
                      checked={d.enabled}
                      onCheckedChange={(v) => setField(meta.type, { enabled: v })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Derived rates are outputs. They are never read back into Reference Data or the rule
            designer as if they were observed data — doing so would feed the base rate its own
            result and compound every change.
          </AlertDescription>
        </Alert>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            <strong>Stored policy, not yet applied.</strong> These formulas are saved and ready,
            but no export or rate calculation reads them yet — the MatrixCare exports still emit
            each bed's own recorded rate. Wiring them into the exports is a separate change.
          </AlertDescription>
        </Alert>

        <div className="flex items-center gap-2">
          <Button
            data-testid="button-save-derived-formulas"
            onClick={() => save.mutate()}
            disabled={!dirty || hasErrors || save.isPending}
          >
            {save.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save formulas
          </Button>
          <Button
            data-testid="button-reset-derived-formulas"
            variant="outline"
            onClick={() => reset.mutate()}
            disabled={reset.isPending}
          >
            {reset.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            Reset to defaults
          </Button>
          {dirty && !hasErrors && (
            <span className="text-xs text-amber-600">Unsaved changes</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
