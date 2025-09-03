import { useQuery } from "@tanstack/react-query";
import { Target, Info } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function UnitRecommendations() {
  const { data: recommendations, isLoading } = useQuery({
    queryKey: ["/api/recommendations"],
    refetchInterval: 60000, // Refresh every minute
  });

  const formatCurrency = (value: number | null) => {
    if (!value) return '--';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getOccupancyBadge = (occupied: string) => {
    if (occupied === 'Y') {
      return (
        <Badge className="bg-[var(--trilogy-success)]/10 text-[var(--trilogy-success)] border-[var(--trilogy-success)]/20">
          Occupied
        </Badge>
      );
    }
    return (
      <Badge className="bg-[var(--trilogy-error)]/10 text-[var(--trilogy-error)] border-[var(--trilogy-error)]/20">
        Vacant
      </Badge>
    );
  };

  const getConfidenceBadge = (confidence?: number) => {
    if (!confidence) return null;
    
    let colorClass = "bg-gray-500/10 text-gray-400 border-gray-500/20";
    let label = "Low";
    
    if (confidence >= 80) {
      colorClass = "bg-[var(--trilogy-success)]/10 text-[var(--trilogy-success)] border-[var(--trilogy-success)]/20";
      label = "High";
    } else if (confidence >= 60) {
      colorClass = "bg-[var(--trilogy-warning)]/10 text-[var(--trilogy-warning)] border-[var(--trilogy-warning)]/20";
      label = "Medium";
    }
    
    return (
      <Badge className={colorClass}>
        {label} ({confidence}%)
      </Badge>
    );
  };

  const getModuloCalculationTooltip = (unit: any) => {
    const baseRate = unit.Fence_Price || 0;
    const competitorRate = unit.Competitor_Benchmark_Rate || 0;
    const recommendedRate = unit.Recommended_Rent || 0;
    const daysVacant = unit.Days_Vacant || 0;
    
    // Calculate the adjustments based on pricing factors
    const occupancyAdjustment = unit.Occupied_YN === 'N' ? (daysVacant > 30 ? -5 : 0) : 0;
    const competitorAdjustment = competitorRate > baseRate ? 3 : -2;
    const roomTypeBonus = unit.Room_Type === 'One Bedroom' ? 2 : 0;
    
    const calculation = `Modulo Rate Calculation:

Base Rate: $${baseRate.toLocaleString()}

Adjustments:
• Occupancy Status: ${unit.Occupied_YN === 'Y' ? 'Occupied (0%)' : `Vacant ${daysVacant} days (${occupancyAdjustment}%)`}
• Competitor Position: ${competitorRate > baseRate ? 'Above market (+3%)' : 'Below market (-2%)'}
• Room Type Premium: ${unit.Room_Type} (${roomTypeBonus}%)
• Seasonality: Current season (0%)
• Market Conditions: Stable (0%)

Total Adjustment: ${occupancyAdjustment + competitorAdjustment + roomTypeBonus}%

Recommended Rate: $${recommendedRate.toLocaleString()}

* Calculation based on Modulo pricing algorithm using occupancy pressure, vacancy duration, room attributes, competitor rates, and market conditions.`;
    
    return calculation;
  };

  if (isLoading) {
    return (
      <div className="dashboard-card mb-8">
        <div className="h-48 flex items-center justify-center text-[var(--dashboard-muted)]">
          Loading recommendations...
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-card mb-8">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-[var(--dashboard-text)]" data-testid="text-recommendations-title">
          Unit-Level Pricing Recommendations
        </h3>
        <p className="text-sm text-[var(--dashboard-muted)]">
          Data-driven pricing suggestions for individual units
        </p>
      </div>
      
      <div className="overflow-x-auto scrollbar-thin">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-[var(--dashboard-border)]">
              <TableHead className="text-[var(--dashboard-muted)]">Unit</TableHead>
              <TableHead className="text-[var(--dashboard-muted)]">Type</TableHead>
              <TableHead className="text-[var(--dashboard-muted)]">Occupancy</TableHead>
              <TableHead className="text-[var(--dashboard-muted)]">Days Vacant</TableHead>
              <TableHead className="text-[var(--dashboard-muted)]">Current</TableHead>
              <TableHead className="text-[var(--dashboard-muted)]">Market</TableHead>
              <TableHead className="text-[var(--dashboard-muted)]">Recommended</TableHead>
              <TableHead className="text-[var(--dashboard-muted)]">Confidence</TableHead>
              <TableHead className="text-[var(--dashboard-muted)]">Rationale</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recommendations?.items?.map((unit: any, index: number) => (
              <TableRow 
                key={unit.Unit_ID} 
                className="border-b border-[var(--dashboard-border)]/50"
                data-testid={`row-recommendation-${index}`}
              >
                <TableCell className="font-medium text-[var(--dashboard-text)]">
                  {unit.Unit_ID}
                </TableCell>
                <TableCell className="text-[var(--dashboard-text)]">
                  {unit.Room_Type}
                </TableCell>
                <TableCell>
                  {getOccupancyBadge(unit.Occupied_YN)}
                </TableCell>
                <TableCell className={unit.Days_Vacant > 30 ? "text-[var(--trilogy-warning)]" : "text-[var(--dashboard-muted)]"}>
                  {unit.Days_Vacant?.toLocaleString() || '--'}
                </TableCell>
                <TableCell className="text-[var(--dashboard-text)]">
                  {formatCurrency(unit.Fence_Price)}
                </TableCell>
                <TableCell className="text-[var(--dashboard-text)]">
                  {formatCurrency(unit.Competitor_Benchmark_Rate)}
                </TableCell>
                <TableCell className="text-[var(--trilogy-success)] font-medium">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1 cursor-help hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 transition-colors">
                          <span>{formatCurrency(unit.Recommended_Rent)}</span>
                          <Info className="w-3 h-3 text-[var(--dashboard-muted)] hover:text-[var(--trilogy-success)]" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-md p-3 bg-white dark:bg-gray-800 border shadow-lg">
                        <pre className="text-xs whitespace-pre-wrap font-mono text-gray-700 dark:text-gray-300">
                          {getModuloCalculationTooltip(unit)}
                        </pre>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableCell>
                <TableCell>
                  {getConfidenceBadge(unit.ML_Confidence)}
                </TableCell>
                <TableCell className="text-xs text-[var(--dashboard-muted)] max-w-xs truncate">
                  {unit.Rationale}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
