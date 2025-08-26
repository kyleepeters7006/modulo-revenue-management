import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Button } from "@/components/ui/button";

export default function RevenueChart() {
  const { data: seriesData, isLoading } = useQuery({
    queryKey: ["/api/series"],
  });

  const chartData = seriesData?.labels?.map((label: string, index: number) => ({
    month: label,
    revenue: seriesData.revenue[index],
    sp500: seriesData.sp500[index],
  })) || [];

  if (isLoading) {
    return (
      <div className="dashboard-card mb-8">
        <div className="h-80 flex items-center justify-center text-[var(--dashboard-muted)]">
          Loading chart data...
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-card mb-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-[var(--dashboard-text)]" data-testid="text-chart-title">
            Revenue vs S&P 500
          </h2>
          <p className="text-sm text-[var(--dashboard-muted)]">
            Performance comparison indexed to starting revenue
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            size="sm"
            className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20"
            data-testid="button-chart-12m"
          >
            12M
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)] hover:bg-[var(--dashboard-bg)]"
            data-testid="button-chart-24m"
          >
            24M
          </Button>
        </div>
      </div>
      
      <div className="h-80 relative">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--dashboard-border)" />
            <XAxis 
              dataKey="month" 
              stroke="var(--dashboard-muted)"
              fontSize={12}
            />
            <YAxis 
              stroke="var(--dashboard-muted)"
              fontSize={12}
              tickFormatter={(value) => `$${value.toLocaleString()}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--dashboard-surface)',
                border: '1px solid var(--dashboard-border)',
                borderRadius: '8px',
                color: 'var(--dashboard-text)'
              }}
              formatter={(value: number) => [`$${value.toLocaleString()}`, '']}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="#6366f1"
              strokeWidth={3}
              dot={{ fill: '#6366f1', strokeWidth: 2, r: 4 }}
              name="Revenue"
            />
            <Line
              type="monotone"
              dataKey="sp500"
              stroke="#10b981"
              strokeWidth={3}
              dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }}
              name="S&P 500 (Indexed)"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
