import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function ComparisonTable() {
  const { data: comparison, isLoading } = useQuery({
    queryKey: ["/api/compare"],
  });

  const handleExportCSV = async () => {
    try {
      const response = await fetch('/api/publish', { method: 'POST' });
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pricing_recommendations_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const getNetVsMarketColor = (value: number) => {
    if (value > 0) return "text-[var(--trilogy-success)]";
    if (value < 0) return "text-[var(--trilogy-error)]";
    return "text-[var(--dashboard-text)]";
  };

  if (isLoading) {
    return (
      <div className="dashboard-card mb-8">
        <div className="h-48 flex items-center justify-center text-[var(--dashboard-muted)]">
          Loading comparison data...
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-card mb-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-[var(--dashboard-text)]" data-testid="text-comparison-title">
            Competitive Analysis by Room Type
          </h3>
          <p className="text-sm text-[var(--dashboard-muted)]">
            Compare your rates against market averages
          </p>
        </div>
        <Button
          onClick={handleExportCSV}
          className="bg-[var(--trilogy-success)] hover:bg-[var(--trilogy-green)] text-white"
          data-testid="button-export-csv"
        >
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>
      
      <div className="overflow-x-auto scrollbar-thin">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-[var(--dashboard-border)]">
              <TableHead className="text-[var(--dashboard-muted)]">Room Type</TableHead>
              <TableHead className="text-[var(--dashboard-muted)]">Your Current Avg</TableHead>
              <TableHead className="text-[var(--dashboard-muted)]">Market Avg</TableHead>
              <TableHead className="text-[var(--dashboard-muted)]">Competitor Care Avg</TableHead>
              <TableHead className="text-[var(--dashboard-muted)]">Net vs Market</TableHead>
              <TableHead className="text-[var(--dashboard-muted)]">Recommended</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparison?.rows?.map((row: any, index: number) => (
              <TableRow 
                key={index} 
                className="border-b border-[var(--dashboard-border)]/50"
                data-testid={`row-comparison-${index}`}
              >
                <TableCell className="font-medium text-[var(--dashboard-text)]">
                  {row.Room_Type}
                </TableCell>
                <TableCell className="text-[var(--dashboard-text)]">
                  {formatCurrency(row.Your_Current_Avg)}
                </TableCell>
                <TableCell className="text-[var(--dashboard-text)]">
                  {formatCurrency(row.Market_Avg)}
                </TableCell>
                <TableCell className="text-[var(--dashboard-text)]">
                  {row.Competitor_Avg_Care ? formatCurrency(row.Competitor_Avg_Care) : '--'}
                </TableCell>
                <TableCell className={getNetVsMarketColor(row.Net_vs_Market)}>
                  {row.Net_vs_Market >= 0 ? '+' : ''}
                  {formatCurrency(Math.abs(row.Net_vs_Market))}
                </TableCell>
                <TableCell className="text-[var(--trilogy-success)] font-medium">
                  {formatCurrency(row.Modulo_Recommended)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
