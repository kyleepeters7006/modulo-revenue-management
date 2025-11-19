import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from "recharts";
import { Button } from "@/components/ui/button";

export default function RevenueChart() {
  const [timeRange, setTimeRange] = useState<'1M' | '3M' | '12M' | '24M'>('12M');
  
  const { data: seriesData, isLoading } = useQuery({
    queryKey: [`/api/series?timeRange=${timeRange}`],
  });

  // Check if we have real API data (labels and arrays exist)
  const hasApiData = (seriesData as any)?.labels && Array.isArray((seriesData as any)?.revenue) && Array.isArray((seriesData as any)?.sp500);
  
  // Only use real API data - no demo data fallback
  const rawData = hasApiData
    ? (seriesData as any).labels.map((label: string, index: number) => ({
        month: label,
        revenue: (seriesData as any).revenue[index],
        sp500: (seriesData as any).sp500[index],
        industry: (seriesData as any).industry?.[index]
      }))
    : [];

  // Check if we have any real Trilogy revenue data (not all nulls)
  // Only check revenue, not sp500/industry, since those can be mock/API data
  const hasRealData = rawData.length > 0 && rawData.some((d: any) => d.revenue != null);
  
  const chartData = rawData.map((item: any, index: number) => {
    // Find first non-null values as baseline for growth calculations
    const firstRevenue = rawData.find((d: any) => d.revenue != null)?.revenue;
    const firstSP500 = rawData.find((d: any) => d.sp500 != null)?.sp500;
    const firstIndustry = rawData.find((d: any) => d.industry != null)?.industry;
    
    return {
      ...item,
      // Calculate percentage growth from period start - handle nulls, no defaults
      revenueGrowth: (item.revenue != null && firstRevenue != null) ? ((item.revenue - firstRevenue) / firstRevenue * 100) : null,
      sp500Growth: (item.sp500 != null && firstSP500 != null) ? ((item.sp500 - firstSP500) / firstSP500 * 100) : null,
      industryGrowth: (item.industry != null && firstIndustry != null) ? ((item.industry - firstIndustry) / firstIndustry * 100) : null,
      monthlyRevenueChange: (index > 0 && item.revenue != null && rawData[index - 1].revenue != null) ? ((item.revenue - rawData[index - 1].revenue) / rawData[index - 1].revenue * 100) : null,
      monthlySP500Change: (index > 0 && item.sp500 != null && rawData[index - 1].sp500 != null) ? ((item.sp500 - rawData[index - 1].sp500) / rawData[index - 1].sp500 * 100) : null,
      monthlyIndustryChange: (index > 0 && item.industry != null && rawData[index - 1].industry != null) ? ((item.industry - rawData[index - 1].industry) / rawData[index - 1].industry * 100) : null,
    };
  });

  // Custom tooltip component for professional trading-style display
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const revenueData = payload.find((p: any) => p.dataKey === 'revenueGrowth');
      const sp500Data = payload.find((p: any) => p.dataKey === 'sp500Growth');
      const industryData = payload.find((p: any) => p.dataKey === 'industryGrowth');
      
      return (
        <div className="bg-[var(--dashboard-surface)] border border-[var(--dashboard-border)] rounded-lg p-4 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-[var(--dashboard-text)]">{label}</span>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-[var(--trilogy-teal)] rounded-full"></div>
              <div className="w-2 h-2 bg-[var(--trilogy-turquoise)] rounded-full"></div>
              <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
            </div>
          </div>
          
          <div className="space-y-3">
            {/* Revenue Section */}
            <div className="border-l-2 border-[var(--trilogy-teal)] pl-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--dashboard-muted)]">Revenue Growth</span>
                <span className={`text-sm font-semibold ${data.revenueGrowth >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
                  {data.revenueGrowth >= 0 ? '+' : ''}{Math.round(data.revenueGrowth)}%
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-[var(--dashboard-muted)]">Revenue Value</span>
                <span className="text-xs font-medium text-[var(--trilogy-teal-light)]">
                  ${revenueData?.payload?.revenue?.toLocaleString('en-US')}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-[var(--dashboard-muted)]">Monthly Change</span>
                <span className={`text-xs font-medium ${data.monthlyRevenueChange >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
                  {data.monthlyRevenueChange >= 0 ? '+' : ''}{Math.round(data.monthlyRevenueChange)}%
                </span>
              </div>
            </div>

            {/* S&P 500 Section */}
            <div className="border-l-2 border-[var(--trilogy-turquoise)] pl-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--dashboard-muted)]">S&P 500 Growth</span>
                <span className={`text-sm font-semibold ${data.sp500Growth >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
                  {data.sp500Growth >= 0 ? '+' : ''}{Math.round(data.sp500Growth)}%
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
                  {data.monthlySP500Change >= 0 ? '+' : ''}{Math.round(data.monthlySP500Change)}%
                </span>
              </div>
            </div>

            {/* Industry Section */}
            <div className="border-l-2 border-orange-500 pl-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--dashboard-muted)]">Industry Growth</span>
                <span className={`text-sm font-semibold ${data.industryGrowth >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
                  {data.industryGrowth >= 0 ? '+' : ''}{Math.round(data.industryGrowth)}%
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-[var(--dashboard-muted)]">Industry Value</span>
                <span className="text-xs font-medium text-orange-400">
                  ${industryData?.payload?.industry?.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-[var(--dashboard-muted)]">Monthly Change</span>
                <span className={`text-xs font-medium ${data.monthlyIndustryChange >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
                  {data.monthlyIndustryChange >= 0 ? '+' : ''}{Math.round(data.monthlyIndustryChange)}%
                </span>
              </div>
            </div>

            {/* Performance Comparison */}
            <div className="pt-2 border-t border-[var(--dashboard-border)]">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--dashboard-muted)]">vs S&P 500</span>
                <span className={`text-xs font-medium ${(data.revenueGrowth - data.sp500Growth) >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
                  {(data.revenueGrowth - data.sp500Growth) >= 0 ? '+' : ''}{Math.round(data.revenueGrowth - data.sp500Growth)}%
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-[var(--dashboard-muted)]">vs Industry</span>
                <span className={`text-xs font-medium ${(data.revenueGrowth - data.industryGrowth) >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
                  {(data.revenueGrowth - data.industryGrowth) >= 0 ? '+' : ''}{Math.round(data.revenueGrowth - data.industryGrowth)}%
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
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[var(--dashboard-muted)]" data-testid="text-chart-loading">Loading revenue data...</p>
          </div>
        ) : !hasRealData ? (
          <div className="flex flex-col items-center justify-center h-full">
            <p className="text-[var(--dashboard-muted)] text-lg font-medium mb-2" data-testid="text-chart-no-data">No Production Data Available</p>
            <p className="text-[var(--dashboard-muted)] text-sm" data-testid="text-chart-no-data-help">
              Revenue data will appear once rent roll records are imported for this time period.
            </p>
          </div>
        ) : (
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
              tickFormatter={(value) => `${Math.round(value)}%`}
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
              content={(props) => {
                if (!props.payload) return null;
                return (
                  <div className="flex justify-center items-center space-x-6 pt-4">
                    {props.payload.map((entry: any, index: number) => (
                      <div key={index} className="flex items-center space-x-2 group relative">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-sm text-[var(--dashboard-text)]">{entry.value}</span>
                        {entry.value === 'Industry %' && (
                          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
                            <div className="bg-[var(--dashboard-surface)] border border-[var(--dashboard-border)] rounded-lg p-3 shadow-xl min-w-48">
                              <div className="text-xs font-medium text-[var(--dashboard-text)] mb-2">Industry Basket Components:</div>
                              <div className="text-xs text-[var(--dashboard-muted)] space-y-1">
                                <div>• Welltower Inc. (WELL)</div>
                                <div>• Ventas Inc. (VTR)</div>
                                <div>• Brookdale Senior Living (BKD)</div>
                                <div>• American Homes 4 Rent (AMH)</div>
                                <div>• Global X Aging Population ETF (AGNG)</div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
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
              name="S&P 500 %"
            />
            <Line
              type="monotone"
              dataKey="industryGrowth"
              stroke="#f97316"
              strokeWidth={2}
              dot={false}
              activeDot={{ 
                r: 6, 
                fill: '#f97316', 
                stroke: '#ffffff', 
                strokeWidth: 2,
                filter: 'drop-shadow(0 2px 4px rgba(249, 115, 22, 0.3))'
              }}
              name="Industry %"
            />
          </LineChart>
        </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
