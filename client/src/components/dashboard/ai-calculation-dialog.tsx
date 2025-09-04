import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface AICalculationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unitId: string;
  roomType: string;
  streetRate: number;
}

export default function AICalculationDialog({
  open,
  onOpenChange,
  unitId,
  roomType,
  streetRate,
}: AICalculationDialogProps) {
  const [loading, setLoading] = useState(true);
  const [calculation, setCalculation] = useState<any>(null);

  useEffect(() => {
    if (open && unitId) {
      setLoading(true);
      fetch(`/api/ai-calculation/${unitId}`)
        .then(res => res.json())
        .then(data => {
          setCalculation(data.calculation);
          setLoading(false);
        })
        .catch(() => {
          setLoading(false);
        });
    }
  }, [open, unitId]);

  if (!calculation && !loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI Calculation Not Available</DialogTitle>
            <DialogDescription>
              No AI calculation details found for this unit. Generate AI suggestions first.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            AI Rate Calculation - {roomType}
          </DialogTitle>
          <DialogDescription>
            Detailed breakdown of how the AI suggested rate was calculated
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : calculation && (
          <div className="space-y-6">
            {/* Rate Summary */}
            <Card className="p-6 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Current Street Rate</p>
                  <p className="text-2xl font-bold">${streetRate.toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center gap-2">
                    {calculation.finalRate > streetRate ? (
                      <TrendingUp className="h-5 w-5 text-green-600" />
                    ) : calculation.finalRate < streetRate ? (
                      <TrendingDown className="h-5 w-5 text-red-600" />
                    ) : (
                      <Minus className="h-5 w-5 text-gray-600" />
                    )}
                    <span className="text-sm font-medium">
                      {((calculation.finalRate - streetRate) / streetRate * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground mb-1">AI Suggested Rate</p>
                  <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                    ${calculation.finalRate.toLocaleString()}
                  </p>
                </div>
              </div>
            </Card>

            {/* Adjustment Breakdown */}
            <div className="space-y-4">
              <h3 className="font-semibold text-lg">Adjustment Factors (AI Algorithm)</h3>
              <div className="space-y-3">
                {calculation.adjustments && calculation.adjustments.map((adj: string, idx: number) => {
                  const [factor, value] = adj.split(':');
                  const isPositive = value.includes('+');
                  const isNegative = value.includes('-') && !isPositive;
                  
                  return (
                    <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      <span className="font-medium">{factor}</span>
                      <Badge 
                        variant={isPositive ? "default" : isNegative ? "destructive" : "secondary"}
                        className="min-w-[80px] justify-center"
                      >
                        {value.trim()}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Weights Configuration */}
            {calculation.weights && (
              <div className="space-y-4">
                <h3 className="font-semibold text-lg">Weight Configuration</h3>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(calculation.weights).map(([key, value]: [string, any]) => (
                    <div key={key} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded">
                      <span className="text-sm">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <div className="flex items-center gap-2">
                        <Progress value={value as number} className="w-20" />
                        <span className="text-sm font-medium w-10 text-right">{value}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Note */}
            <div className="p-4 bg-purple-50 dark:bg-purple-950/20 rounded-lg border border-purple-200 dark:border-purple-800">
              <p className="text-sm text-purple-700 dark:text-purple-300">
                <strong>AI Algorithm Note:</strong> The AI uses the same weight configuration as Modulo but applies slightly different adjustment curves and factors to provide alternative pricing perspectives. The AI tends to be more aggressive with competitor positioning and vacancy adjustments.
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}