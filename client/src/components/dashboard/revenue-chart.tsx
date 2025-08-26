import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import { Button } from "@/components/ui/button";

export default function RevenueChart() {
  const { data: seriesData, isLoading } = useQuery({
    queryKey: ["/api/series"],
  });

  const chartData = (seriesData?.labels && seriesData?.revenue && seriesData?.sp500) 
    ? seriesData.labels.map((label: string, index: number) => {
        const revenue = seriesData.revenue[index];
        const sp500 = seriesData.sp500[index];
        const startingRevenue = seriesData.revenue[0] || 1;
        const startingSP500 = seriesData.sp500[0] || 1;
        
        return {
          month: label,
          revenue: revenue,
          sp500: sp500,
          revenueGrowth: index > 0 ? ((revenue - startingRevenue) / startingRevenue * 100) : 0,
          sp500Growth: index > 0 ? ((sp500 - startingSP500) / startingSP500 * 100) : 0,
          monthlyRevenueChange: index > 0 ? ((revenue - seriesData.revenue[index - 1]) / seriesData.revenue[index - 1] * 100) : 0,
          monthlySP500Change: index > 0 ? ((sp500 - seriesData.sp500[index - 1]) / seriesData.sp500[index - 1] * 100) : 0,
        };
      }) 
    : [];

  // Custom tooltip component for professional trading-style display
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const revenueData = payload.find((p: any) => p.dataKey === 'revenue');
      const sp500Data = payload.find((p: any) => p.dataKey === 'sp500');
      
      return (
        <div className="bg-[var(--dashboard-surface)] border border-[var(--dashboard-border)] rounded-lg p-4 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-[var(--dashboard-text)]">{label}</span>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
              <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
            </div>
          </div>
          
          <div className="space-y-3">
            {/* Revenue Section */}
            <div className="border-l-2 border-indigo-500 pl-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--dashboard-muted)]">Revenue</span>
                <span className="text-sm font-semibold text-indigo-400">
                  ${revenueData?.value?.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-[var(--dashboard-muted)]">Total Growth</span>
                <span className={`text-xs font-medium ${data.revenueGrowth >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {data.revenueGrowth >= 0 ? '+' : ''}{data.revenueGrowth.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-[var(--dashboard-muted)]">Monthly Change</span>
                <span className={`text-xs font-medium ${data.monthlyRevenueChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {data.monthlyRevenueChange >= 0 ? '+' : ''}{data.monthlyRevenueChange.toFixed(2)}%
                </span>
              </div>
            </div>

            {/* S&P 500 Section */}
            <div className="border-l-2 border-emerald-500 pl-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--dashboard-muted)]">S&P 500 (Indexed)</span>
                <span className="text-sm font-semibold text-emerald-400">
                  ${sp500Data?.value?.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-[var(--dashboard-muted)]">Total Growth</span>
                <span className={`text-xs font-medium ${data.sp500Growth >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {data.sp500Growth >= 0 ? '+' : ''}{data.sp500Growth.toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-[var(--dashboard-muted)]">Monthly Change</span>
                <span className={`text-xs font-medium ${data.monthlySP500Change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {data.monthlySP500Change >= 0 ? '+' : ''}{data.monthlySP500Change.toFixed(2)}%
                </span>
              </div>
            </div>

            {/* Performance Comparison */}
            <div className="pt-2 border-t border-[var(--dashboard-border)]">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--dashboard-muted)]">Outperformance</span>
                <span className={`text-xs font-medium ${(data.revenueGrowth - data.sp500Growth) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {(data.revenueGrowth - data.sp500Growth) >= 0 ? '+' : ''}{(data.revenueGrowth - data.sp500Growth).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

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
          <LineChart 
            data={chartData}
            margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
          >
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="var(--dashboard-border)" 
              strokeOpacity={0.3}
            />
            <XAxis 
              dataKey="month" 
              stroke="var(--dashboard-muted)"
              fontSize={12}
              tickLine={false}
              axisLine={{ stroke: 'var(--dashboard-border)', strokeWidth: 1 }}
            />
            <YAxis 
              stroke="var(--dashboard-muted)"
              fontSize={12}
              tickFormatter={(value) => `$${value.toLocaleString()}`}
              tickLine={false}
              axisLine={{ stroke: 'var(--dashboard-border)', strokeWidth: 1 }}
            />
            <Tooltip 
              content={<CustomTooltip />}
              cursor={{
                stroke: 'var(--dashboard-border)',
                strokeWidth: 1,
                strokeDasharray: '4 4'
              }}
              wrapperStyle={{ outline: 'none' }}
              allowEscapeViewBox={{ x: false, y: false }}
            />
            <Legend 
              wrapperStyle={{ 
                paddingTop: '20px',
                color: 'var(--dashboard-text)'
              }}
            />
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
              activeDot={{ 
                r: 6, 
                fill: '#6366f1', 
                stroke: '#ffffff', 
                strokeWidth: 2,
                filter: 'drop-shadow(0 2px 4px rgba(99, 102, 241, 0.3))'
              }}
              name="Revenue"
            />
            <Line
              type="monotone"
              dataKey="sp500"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              activeDot={{ 
                r: 6, 
                fill: '#10b981', 
                stroke: '#ffffff', 
                strokeWidth: 2,
                filter: 'drop-shadow(0 2px 4px rgba(16, 185, 129, 0.3))'
              }}
              name="S&P 500 (Indexed)"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
