import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import { Button } from "@/components/ui/button";

export default function RevenueChart() {
  const [timeRange, setTimeRange] = useState<'1M' | '3M' | '12M' | '24M'>('12M');
  
  const { data: seriesData, isLoading } = useQuery({
    queryKey: ["/api/series", timeRange],
  });

  // Generate demo data if API returns empty data
  const generateDemoData = (months: number) => {
    const data = [];
    const now = new Date();
    let baseRevenue = 850000;
    let baseSP500 = 4500;
    
    for (let i = months - 1; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      
      // Add some realistic growth patterns
      const revenueGrowth = 1 + (Math.random() * 0.06 - 0.02); // -2% to +4% monthly
      const sp500Growth = 1 + (Math.random() * 0.08 - 0.04); // -4% to +4% monthly
      
      baseRevenue *= revenueGrowth;
      baseSP500 *= sp500Growth;
      
      data.push({
        month: monthLabel,
        revenue: Math.round(baseRevenue),
        sp500: Math.round(baseSP500)
      });
    }
    return data;
  };

  const rawData = ((seriesData as any)?.labels && (seriesData as any)?.revenue && (seriesData as any)?.sp500) 
    ? (seriesData as any).labels.map((label: string, index: number) => ({
        month: label,
        revenue: (seriesData as any).revenue[index],
        sp500: (seriesData as any).sp500[index]
      }))
    : generateDemoData(timeRange === '1M' ? 1 : timeRange === '3M' ? 3 : timeRange === '12M' ? 12 : 24);

  const chartData = rawData.map((item: any, index: number) => {
    const startingRevenue = rawData[0]?.revenue || 1;
    const startingSP500 = rawData[0]?.sp500 || 1;
    
    return {
      ...item,
      // Calculate percentage growth from period start
      revenueGrowth: ((item.revenue - startingRevenue) / startingRevenue * 100),
      sp500Growth: ((item.sp500 - startingSP500) / startingSP500 * 100),
      monthlyRevenueChange: index > 0 ? ((item.revenue - rawData[index - 1].revenue) / rawData[index - 1].revenue * 100) : 0,
      monthlySP500Change: index > 0 ? ((item.sp500 - rawData[index - 1].sp500) / rawData[index - 1].sp500 * 100) : 0,
    };
  });

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
              <div className="w-2 h-2 bg-[var(--trilogy-teal)] rounded-full"></div>
              <div className="w-2 h-2 bg-[var(--trilogy-turquoise)] rounded-full"></div>
            </div>
          </div>
          
          <div className="space-y-3">
            {/* Revenue Section */}
            <div className="border-l-2 border-[var(--trilogy-teal)] pl-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--dashboard-muted)]">Revenue Growth</span>
                <span className={`text-sm font-semibold ${data.revenueGrowth >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
                  {data.revenueGrowth >= 0 ? '+' : ''}{data.revenueGrowth.toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-[var(--dashboard-muted)]">Revenue Value</span>
                <span className="text-xs font-medium text-[var(--trilogy-teal-light)]">
                  ${revenueData?.payload?.revenue?.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-[var(--dashboard-muted)]">Monthly Change</span>
                <span className={`text-xs font-medium ${data.monthlyRevenueChange >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
                  {data.monthlyRevenueChange >= 0 ? '+' : ''}{data.monthlyRevenueChange.toFixed(2)}%
                </span>
              </div>
            </div>

            {/* S&P 500 Section */}
            <div className="border-l-2 border-[var(--trilogy-turquoise)] pl-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--dashboard-muted)]">S&P 500 Growth</span>
                <span className={`text-sm font-semibold ${data.sp500Growth >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
                  {data.sp500Growth >= 0 ? '+' : ''}{data.sp500Growth.toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-[var(--dashboard-muted)]">S&P 500 Value</span>
                <span className="text-xs font-medium text-[var(--trilogy-turquoise)]">
                  ${sp500Data?.payload?.sp500?.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-[var(--dashboard-muted)]">Monthly Change</span>
                <span className={`text-xs font-medium ${data.monthlySP500Change >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
                  {data.monthlySP500Change >= 0 ? '+' : ''}{data.monthlySP500Change.toFixed(2)}%
                </span>
              </div>
            </div>

            {/* Performance Comparison */}
            <div className="pt-2 border-t border-[var(--dashboard-border)]">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--dashboard-muted)]">Outperformance</span>
                <span className={`text-xs font-medium ${(data.revenueGrowth - data.sp500Growth) >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
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
    <div className="dashboard-card mb-6 lg:mb-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 lg:mb-6 gap-3 sm:gap-0">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-[var(--trilogy-dark-blue)]" data-testid="text-chart-title">
            Revenue Growth
          </h2>
          <p className="text-sm text-[var(--trilogy-grey)]">
            Trailing {timeRange === '1M' ? '1 month' : timeRange === '3M' ? '3 months' : timeRange === '12M' ? '12 months' : '24 months'} performance vs S&P 500
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            size="sm"
            onClick={() => setTimeRange('1M')}
            className={timeRange === '1M' 
              ? "bg-[var(--trilogy-teal)]/10 text-[var(--trilogy-teal)] border border-[var(--trilogy-teal)]/20 hover:bg-[var(--trilogy-teal)]/20"
              : "text-[var(--trilogy-grey)] hover:text-[var(--trilogy-dark-blue)] hover:bg-[var(--trilogy-light-blue)]/10"
            }
            data-testid="button-chart-1m"
          >
            1M
          </Button>
          <Button
            size="sm"
            onClick={() => setTimeRange('3M')}
            className={timeRange === '3M' 
              ? "bg-[var(--trilogy-teal)]/10 text-[var(--trilogy-teal)] border border-[var(--trilogy-teal)]/20 hover:bg-[var(--trilogy-teal)]/20"
              : "text-[var(--trilogy-grey)] hover:text-[var(--trilogy-dark-blue)] hover:bg-[var(--trilogy-light-blue)]/10"
            }
            data-testid="button-chart-3m"
          >
            3M
          </Button>
          <Button
            size="sm"
            onClick={() => setTimeRange('12M')}
            className={timeRange === '12M' 
              ? "bg-[var(--trilogy-teal)]/10 text-[var(--trilogy-teal)] border border-[var(--trilogy-teal)]/20 hover:bg-[var(--trilogy-teal)]/20"
              : "text-[var(--trilogy-grey)] hover:text-[var(--trilogy-dark-blue)] hover:bg-[var(--trilogy-light-blue)]/10"
            }
            data-testid="button-chart-12m"
          >
            12M
          </Button>
          <Button
            size="sm"
            onClick={() => setTimeRange('24M')}
            className={timeRange === '24M'
              ? "bg-[var(--trilogy-teal)]/10 text-[var(--trilogy-teal)] border border-[var(--trilogy-teal)]/20 hover:bg-[var(--trilogy-teal)]/20"
              : "text-[var(--trilogy-grey)] hover:text-[var(--trilogy-dark-blue)] hover:bg-[var(--trilogy-light-blue)]/10"
            }
            data-testid="button-chart-24m"
          >
            24M
          </Button>
        </div>
      </div>
      
      <div className="h-64 sm:h-72 lg:h-80 relative w-full overflow-hidden">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart 
            data={chartData}
            margin={{ top: 20, right: 10, left: 10, bottom: 20 }}
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
              tickFormatter={(value) => `${value.toFixed(1)}%`}
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
              dataKey="revenueGrowth"
              stroke="hsl(180, 65%, 45%)"
              strokeWidth={2}
              dot={false}
              activeDot={{ 
                r: 6, 
                fill: 'hsl(180, 65%, 45%)', 
                stroke: '#ffffff', 
                strokeWidth: 2,
                filter: 'drop-shadow(0 2px 4px hsl(180, 65%, 45%, 0.3))'
              }}
              name="Revenue Growth %"
            />
            <Line
              type="monotone"
              dataKey="sp500Growth"
              stroke="hsl(175, 70%, 50%)"
              strokeWidth={2}
              dot={false}
              activeDot={{ 
                r: 6, 
                fill: 'hsl(175, 70%, 50%)', 
                stroke: '#ffffff', 
                strokeWidth: 2,
                filter: 'drop-shadow(0 2px 4px hsl(175, 70%, 50%, 0.3))'
              }}
              name="S&P 500 Growth %"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
