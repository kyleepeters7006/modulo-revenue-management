import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

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
        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
          Occupied
        </Badge>
      );
    }
    return (
      <Badge className="bg-red-500/10 text-red-400 border-red-500/20">
        Vacant
      </Badge>
    );
  };

  const getMLConfidenceBadge = (confidence?: number) => {
    if (!confidence) return null;
    
    let colorClass = "bg-gray-500/10 text-gray-400 border-gray-500/20";
    let label = "Low";
    
    if (confidence >= 80) {
      colorClass = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      label = "High";
    } else if (confidence >= 60) {
      colorClass = "bg-amber-500/10 text-amber-400 border-amber-500/20";
      label = "Medium";
    }
    
    return (
      <Badge className={colorClass}>
        {label} ({confidence}%)
      </Badge>
    );
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
          AI-driven pricing suggestions for individual units
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
              <TableHead className="text-[var(--dashboard-muted)]">ML Confidence</TableHead>
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
                <TableCell className={unit.Days_Vacant > 30 ? "text-amber-400" : "text-[var(--dashboard-muted)]"}>
                  {unit.Days_Vacant}
                </TableCell>
                <TableCell className="text-[var(--dashboard-text)]">
                  {formatCurrency(unit.Fence_Price)}
                </TableCell>
                <TableCell className="text-[var(--dashboard-text)]">
                  {formatCurrency(unit.Competitor_Benchmark_Rate)}
                </TableCell>
                <TableCell className="text-emerald-400 font-medium">
                  {formatCurrency(unit.Recommended_Rent)}
                </TableCell>
                <TableCell>
                  {getMLConfidenceBadge(unit.ML_Confidence)}
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
