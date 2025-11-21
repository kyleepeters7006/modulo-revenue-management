import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/formatters";
import { ExternalLink, Calculator } from "lucide-react";
import { Link } from "wouter";

interface CompetitorAdjustmentDialogProps {
  competitorName?: string;
  competitorWeight?: number;
  competitorBaseRate?: number;
  competitorCareLevel2Adjustment?: number;
  competitorMedManagementAdjustment?: number;
  competitorAdjustmentExplanation?: string;
  adjustedRate?: number;
  children: React.ReactNode;
}

export function CompetitorAdjustmentDialog({
  competitorName,
  competitorWeight,
  competitorBaseRate,
  competitorCareLevel2Adjustment = 0,
  competitorMedManagementAdjustment = 0,
  competitorAdjustmentExplanation,
  adjustedRate,
  children
}: CompetitorAdjustmentDialogProps) {
  if (!competitorName || !competitorBaseRate) {
    return <>{children}</>;
  }
  
  const totalAdjustment = competitorCareLevel2Adjustment + competitorMedManagementAdjustment;
  
  return (
    <Dialog>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-[var(--trilogy-teal)]" />
            Competitor Rate Adjustment
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="font-medium text-lg">{competitorName}</p>
              {competitorWeight && (
                <Badge variant="secondary" className="text-xs">
                  Weight: {competitorWeight}%
                </Badge>
              )}
            </div>
            <Link href="/competitors" className="inline-flex items-center gap-1 text-sm text-[var(--trilogy-teal)] hover:text-[var(--trilogy-teal-dark)]">
              View Competitors
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          
          <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-900/50">
            <h4 className="font-medium mb-3">Rate Calculation</h4>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">Base Competitor Rate</span>
                <span className="font-medium">{formatCurrency(competitorBaseRate)}</span>
              </div>
              
              {competitorCareLevel2Adjustment > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Care Level 2 Adjustment</span>
                  <span className="font-medium text-green-600">
                    +{formatCurrency(competitorCareLevel2Adjustment)}
                  </span>
                </div>
              )}
              
              {competitorMedManagementAdjustment > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Medication Management</span>
                  <span className="font-medium text-green-600">
                    +{formatCurrency(competitorMedManagementAdjustment)}
                  </span>
                </div>
              )}
              
              <div className="border-t pt-2 mt-2">
                <div className="flex justify-between items-center">
                  <span className="font-medium">Adjusted Competitor Rate</span>
                  <span className="font-bold text-lg text-[var(--trilogy-teal)]">
                    {formatCurrency(adjustedRate || (competitorBaseRate + totalAdjustment))}
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          {competitorAdjustmentExplanation && (
            <div className="border rounded-lg p-4 bg-blue-50 dark:bg-blue-900/20">
              <h4 className="font-medium mb-2 text-sm">Adjustment Explanation</h4>
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">
                {competitorAdjustmentExplanation}
              </p>
            </div>
          )}
          
          <div className="text-sm text-gray-500 dark:text-gray-400 italic">
            Note: Adjustments ensure fair comparison by accounting for differences in care level pricing and included services. 
            Trilogy includes medication management at no additional charge.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}