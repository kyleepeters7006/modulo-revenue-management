import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { TrendingUp, TrendingDown, Home, Users, DollarSign, ArrowRight, ChevronRight } from "lucide-react";
import { 
  LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from "recharts";
import { formatNumber, formatCurrency, formatPercentage } from "@/lib/formatters";

interface TileDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tileType: 'units' | 'occupancy' | 'current-revenue' | 'potential-revenue';
  tileTitle: string;
}

interface GrowthStats {
  t1: number;
  t3: number;
  t6: number;
  t12: number;
  ytd: number;
}

interface ServiceLineData {
  serviceLine: string;
  value: number;
  trend: number[];
  growthStats: GrowthStats;
}

interface RateMetrics {
  currentValue: number;
  monthlyTrend: Array<{ month: string; value: number; byServiceLine: Record<string, number> }>;
  growthStats: GrowthStats;
  byServiceLine: ServiceLineData[];
  sameStore: {
    currentValue: number;
    growthStats: GrowthStats;
    byServiceLine?: ServiceLineData[];
  };
}

interface TileDetailsResponse {
  tileType: string;
  currentValue: number;
  monthlyTrend: Array<{
    month: string;
    value: number;
    byServiceLine: Record<string, number>;
  }>;
  growthStats: GrowthStats;
  byServiceLine: ServiceLineData[];
  byLocation: Array<{ location: string; value: number }>;
  byRoomType: Array<{ roomType: string; value: number }>;
  sameStore: {
    currentValue: number;
    growthStats: GrowthStats;
    byServiceLine?: ServiceLineData[];
  };
  serviceLineGrowthBreakdown?: Array<{ serviceLine: string; value: number; t1: number; t12: number }>;
  rateMetrics?: RateMetrics;
}

// Trilogy brand-aligned colors
const TRILOGY_TEAL = 'hsl(180, 65%, 45%)';
const TRILOGY_TEAL_LIGHT = 'hsl(180, 60%, 60%)';
const TRILOGY_TURQUOISE = 'hsl(175, 70%, 50%)';
const TRILOGY_DARK_BLUE = 'hsl(210, 45%, 25%)';

const COLORS = [TRILOGY_TEAL, TRILOGY_TURQUOISE, '#f97316', TRILOGY_DARK_BLUE, '#10b981', '#8b5cf6', '#ec4899', '#84cc16'];

const SERVICE_LINE_COLORS: Record<string, string> = {
  'AL': TRILOGY_TEAL,
  'AL/MC': TRILOGY_TURQUOISE,
  'HC': '#f97316',  // Orange for HC to distinguish from teal
  'HC/MC': TRILOGY_DARK_BLUE,
  'SL': '#10b981',  // Emerald for SL
  'VIL': '#8b5cf6', // Purple for VIL
};

export function TileDetailDialog({ open, onOpenChange, tileType, tileTitle }: TileDetailDialogProps) {
  const [drillLevel, setDrillLevel] = useState<'overview' | 'location' | 'serviceLine' | 'roomType'>('overview');
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [selectedServiceLine, setSelectedServiceLine] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'revenue' | 'rate'>('revenue');

  const { data, isLoading, error } = useQuery<TileDetailsResponse>({
    queryKey: ['/api/tile-details', tileType],
    enabled: open,
    staleTime: 5 * 60 * 1000, // Cache data for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep unused data in cache for 10 minutes
  });
  
  const isRevenueTile = tileType === 'current-revenue' || tileType === 'potential-revenue';
  const hasRateMetrics = isRevenueTile && data?.rateMetrics;

  const formatValue = (value: number, forceRate = false) => {
    if (tileType === 'occupancy') {
      return formatPercentage(value / 100, 1);
    } else if ((tileType === 'current-revenue' || tileType === 'potential-revenue') && !forceRate && viewMode === 'revenue') {
      if (value >= 1000000000) {
        return `$${(value / 1000000000).toFixed(2)}B`;
      } else if (value >= 1000000) {
        return `$${(value / 1000000).toFixed(1)}M`;
      }
      return formatCurrency(value);
    } else if (forceRate || (isRevenueTile && viewMode === 'rate')) {
      return `$${value.toLocaleString()}/mo`;
    }
    return formatNumber(value);
  };
  
  const formatRateValue = (value: number) => `$${value.toLocaleString()}/mo`;

  const formatGrowth = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  };

  const GrowthBadge = ({ value }: { value: number }) => (
    <Badge 
      variant="outline" 
      className={`${value >= 0 ? 'text-[var(--trilogy-success)] border-[var(--trilogy-success)]/20 bg-[var(--trilogy-success)]/10' : 'text-[var(--trilogy-error)] border-[var(--trilogy-error)]/20 bg-[var(--trilogy-error)]/10'} text-xs font-medium`}
    >
      {value >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
      {formatGrowth(value)}
    </Badge>
  );

  const GrowthStatsPanel = ({ stats, title, serviceLineData }: { stats: GrowthStats; title: string; serviceLineData?: ServiceLineData[] }) => (
    <Card className="bg-[var(--dashboard-surface)] border-[var(--dashboard-border)]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-[var(--dashboard-text)]">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dashboard-border)]">
                <th className="text-left py-2 px-2 text-[var(--dashboard-muted)] font-medium w-20"></th>
                <th className="text-center py-2 px-1 text-[var(--dashboard-muted)] font-medium">T1</th>
                <th className="text-center py-2 px-1 text-[var(--dashboard-muted)] font-medium">T3</th>
                <th className="text-center py-2 px-1 text-[var(--dashboard-muted)] font-medium">T6</th>
                <th className="text-center py-2 px-1 text-[var(--dashboard-muted)] font-medium">T12</th>
                <th className="text-center py-2 px-1 text-[var(--dashboard-muted)] font-medium">YTD</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--dashboard-border)] bg-[var(--dashboard-background)]">
                <td className="py-2 px-2 font-semibold text-[var(--dashboard-text)]">Portfolio</td>
                <td className={`text-center py-2 px-1 font-bold ${stats.t1 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>{formatGrowth(stats.t1)}</td>
                <td className={`text-center py-2 px-1 font-bold ${stats.t3 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>{formatGrowth(stats.t3)}</td>
                <td className={`text-center py-2 px-1 font-bold ${stats.t6 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>{formatGrowth(stats.t6)}</td>
                <td className={`text-center py-2 px-1 font-bold ${stats.t12 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>{formatGrowth(stats.t12)}</td>
                <td className={`text-center py-2 px-1 font-bold ${stats.ytd >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>{formatGrowth(stats.ytd)}</td>
              </tr>
              {serviceLineData?.map((sl) => (
                <tr key={sl.serviceLine} className="border-b border-[var(--dashboard-border)] last:border-b-0">
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1.5">
                      <div 
                        className="w-2 h-2 rounded-full flex-shrink-0" 
                        style={{ backgroundColor: SERVICE_LINE_COLORS[sl.serviceLine] || COLORS[0] }}
                      />
                      <span className="text-[var(--dashboard-text)]">{sl.serviceLine}</span>
                    </div>
                  </td>
                  <td className={`text-center py-2 px-1 ${sl.growthStats.t1 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>{formatGrowth(sl.growthStats.t1)}</td>
                  <td className={`text-center py-2 px-1 ${sl.growthStats.t3 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>{formatGrowth(sl.growthStats.t3)}</td>
                  <td className={`text-center py-2 px-1 ${sl.growthStats.t6 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>{formatGrowth(sl.growthStats.t6)}</td>
                  <td className={`text-center py-2 px-1 ${sl.growthStats.t12 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>{formatGrowth(sl.growthStats.t12)}</td>
                  <td className={`text-center py-2 px-1 ${sl.growthStats.ytd >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>{formatGrowth(sl.growthStats.ytd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );

  const handleDrillDown = (type: 'location' | 'serviceLine' | 'roomType', value: string) => {
    if (type === 'location') {
      setSelectedLocation(value);
      setDrillLevel('location');
    } else if (type === 'serviceLine') {
      setSelectedServiceLine(value);
      setDrillLevel('serviceLine');
    }
  };

  const resetDrill = () => {
    setDrillLevel('overview');
    setSelectedLocation(null);
    setSelectedServiceLine(null);
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-xl">
              {tileType === 'units' && <Home className="w-5 h-5 text-blue-500" />}
              {tileType === 'occupancy' && <Users className="w-5 h-5 text-emerald-500" />}
              {(tileType === 'current-revenue' || tileType === 'potential-revenue') && <DollarSign className="w-5 h-5 text-amber-500" />}
              {viewMode === 'rate' && isRevenueTile ? 'Average Rate' : tileTitle} Details
            </DialogTitle>
            
            {hasRateMetrics && (
              <div className="flex items-center gap-3 bg-[var(--dashboard-surface)] border border-[var(--dashboard-border)] rounded-lg px-3 py-1.5">
                <Label htmlFor="view-toggle" className={`text-xs cursor-pointer ${viewMode === 'revenue' ? 'text-[var(--dashboard-text)] font-medium' : 'text-[var(--dashboard-muted)]'}`}>
                  Revenue
                </Label>
                <Switch 
                  id="view-toggle"
                  checked={viewMode === 'rate'}
                  onCheckedChange={(checked) => setViewMode(checked ? 'rate' : 'revenue')}
                  data-testid="rate-revenue-toggle"
                />
                <Label htmlFor="view-toggle" className={`text-xs cursor-pointer ${viewMode === 'rate' ? 'text-[var(--dashboard-text)] font-medium' : 'text-[var(--dashboard-muted)]'}`}>
                  Rate
                </Label>
              </div>
            )}
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-red-500">
            Failed to load details. Please try again.
          </div>
        ) : data ? (
          <div className="space-y-6">
            {/* Breadcrumb for drill-down */}
            {drillLevel !== 'overview' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <button onClick={resetDrill} className="hover:text-blue-500" data-testid="breadcrumb-overview">
                  Overview
                </button>
                <ChevronRight className="w-4 h-4" />
                {selectedLocation && <span className="text-foreground">{selectedLocation}</span>}
                {selectedServiceLine && <span className="text-foreground">{selectedServiceLine}</span>}
              </div>
            )}

            {/* Header with current value and growth */}
            {(() => {
              const displayData = viewMode === 'rate' && data.rateMetrics ? data.rateMetrics : data;
              const displaySameStore = viewMode === 'rate' && data.rateMetrics ? data.rateMetrics.sameStore : data.sameStore;
              const displayByServiceLine = viewMode === 'rate' && data.rateMetrics ? data.rateMetrics.byServiceLine : data.byServiceLine;
              
              return (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <Card className="lg:col-span-2">
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-muted-foreground">
                              {viewMode === 'rate' && isRevenueTile ? 'Average Rate' : 'Current Value'}
                            </p>
                            <p className="text-4xl font-bold" data-testid="tile-detail-current-value">
                              {viewMode === 'rate' && isRevenueTile ? formatRateValue(displayData.currentValue) : formatValue(displayData.currentValue)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-muted-foreground mb-2">12-Month Growth</p>
                            <GrowthBadge value={displayData.growthStats.t12} />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                    
                    {/* Same Store Card */}
                    <Card className="bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800">
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm text-purple-600 dark:text-purple-400">Same Store</p>
                            <p className="text-2xl font-bold" data-testid="tile-detail-same-store-value">
                              {viewMode === 'rate' && isRevenueTile ? formatRateValue(displaySameStore.currentValue) : formatValue(displaySameStore.currentValue)}
                            </p>
                          </div>
                          <GrowthBadge value={displaySameStore.growthStats.t12} />
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Growth Statistics Panel */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <GrowthStatsPanel 
                      stats={displayData.growthStats} 
                      title={viewMode === 'rate' ? 'Portfolio Rate Growth' : 'Portfolio Growth'} 
                      serviceLineData={displayByServiceLine}
                    />
                    <GrowthStatsPanel 
                      stats={displaySameStore.growthStats} 
                      title={viewMode === 'rate' ? 'Same Store Rate Growth' : 'Same Store Growth'} 
                      serviceLineData={displaySameStore.byServiceLine}
                    />
                  </div>
                </>
              );
            })()}

            {/* Tabs for different views */}
            <Tabs defaultValue="trend" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="trend" data-testid="tab-trend">Monthly Trend</TabsTrigger>
                <TabsTrigger value="serviceLine" data-testid="tab-service-line">By Service Line</TabsTrigger>
                <TabsTrigger value="location" data-testid="tab-location">By Location</TabsTrigger>
                <TabsTrigger value="roomType" data-testid="tab-room-type">By Room Type</TabsTrigger>
              </TabsList>

              {/* Monthly Trend Tab */}
              <TabsContent value="trend" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">12-Month Trend</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data.monthlyTrend} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
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
                            tickFormatter={(value) => {
                              const [year, month] = value.split('-');
                              return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(month)-1]} '${year.slice(2)}`;
                            }}
                          />
                          <YAxis 
                            stroke="var(--dashboard-muted)"
                            fontSize={12}
                            tickLine={false}
                            axisLine={{ stroke: 'var(--dashboard-border)', strokeWidth: 1 }}
                            tickFormatter={(value) => {
                              if (tileType === 'occupancy') return `${value}%`;
                              if (value >= 1000000000) return `$${(value/1000000000).toFixed(1)}B`;
                              if (value >= 1000000) return `$${(value/1000000).toFixed(0)}M`;
                              if (value >= 1000) return `${(value/1000).toFixed(0)}K`;
                              return value;
                            }}
                          />
                          <Tooltip 
                            formatter={(value: number) => [formatValue(value), tileTitle]}
                            labelFormatter={(label) => {
                              const [year, month] = label.split('-');
                              return `${['January','February','March','April','May','June','July','August','September','October','November','December'][parseInt(month)-1]} ${year}`;
                            }}
                            contentStyle={{
                              backgroundColor: 'var(--dashboard-surface)',
                              border: '1px solid var(--dashboard-border)',
                              borderRadius: '8px',
                              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                            }}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="value" 
                            stroke={TRILOGY_TEAL}
                            fill={TRILOGY_TEAL}
                            fillOpacity={0.2}
                            strokeWidth={2}
                            activeDot={{ 
                              r: 6, 
                              fill: TRILOGY_TEAL, 
                              stroke: '#ffffff', 
                              strokeWidth: 2 
                            }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {/* Service Line Breakdown in Trend */}
                <Card className="mt-4">
                  <CardHeader>
                    <CardTitle className="text-sm">By Service Line Over Time</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data.monthlyTrend} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                          <CartesianGrid 
                            strokeDasharray="3 3" 
                            stroke="var(--dashboard-border)" 
                            strokeOpacity={0.3}
                          />
                          <XAxis 
                            dataKey="month" 
                            stroke="var(--dashboard-muted)"
                            fontSize={10}
                            tickLine={false}
                            axisLine={{ stroke: 'var(--dashboard-border)', strokeWidth: 1 }}
                            tickFormatter={(value) => {
                              const [year, month] = value.split('-');
                              return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(month)-1]}`;
                            }}
                          />
                          <YAxis 
                            stroke="var(--dashboard-muted)"
                            fontSize={10}
                            tickLine={false}
                            axisLine={{ stroke: 'var(--dashboard-border)', strokeWidth: 1 }}
                            tickFormatter={(value) => value.toLocaleString()}
                          />
                          <Tooltip 
                            formatter={(value: number) => value.toLocaleString()}
                            contentStyle={{
                              backgroundColor: 'var(--dashboard-surface)',
                              border: '1px solid var(--dashboard-border)',
                              borderRadius: '8px',
                              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                            }}
                          />
                          <Legend 
                            wrapperStyle={{ paddingTop: '10px' }}
                          />
                          {data.byServiceLine.map((sl, idx) => (
                            <Line 
                              key={sl.serviceLine}
                              type="monotone"
                              dataKey={`byServiceLine.${sl.serviceLine}`}
                              name={sl.serviceLine}
                              stroke={SERVICE_LINE_COLORS[sl.serviceLine] || COLORS[idx % COLORS.length]}
                              strokeWidth={2}
                              dot={false}
                              activeDot={{ 
                                r: 5, 
                                fill: SERVICE_LINE_COLORS[sl.serviceLine] || COLORS[idx % COLORS.length], 
                                stroke: '#ffffff', 
                                strokeWidth: 2 
                              }}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* By Service Line Tab */}
              <TabsContent value="serviceLine" className="mt-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Pie Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Distribution</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={data.byServiceLine}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={100}
                              paddingAngle={2}
                              dataKey="value"
                              nameKey="serviceLine"
                              onClick={(entry) => handleDrillDown('serviceLine', entry.serviceLine)}
                              style={{ cursor: 'pointer' }}
                            >
                              {data.byServiceLine.map((entry, index) => (
                                <Cell 
                                  key={`cell-${index}`} 
                                  fill={SERVICE_LINE_COLORS[entry.serviceLine] || COLORS[index % COLORS.length]} 
                                />
                              ))}
                            </Pie>
                            <Tooltip 
                              formatter={(value: number) => {
                                const total = data.byServiceLine.reduce((sum, item) => sum + item.value, 0);
                                const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                                return `${formatValue(value)} (${pct}%)`;
                              }} 
                              contentStyle={{
                                backgroundColor: 'var(--dashboard-surface)',
                                border: '1px solid var(--dashboard-border)',
                                borderRadius: '8px',
                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                              }}
                            />
                            <Legend wrapperStyle={{ paddingTop: '10px' }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Service Line Table */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Growth by Service Line</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {data.byServiceLine.map((sl) => (
                          <div 
                            key={sl.serviceLine}
                            className="flex items-center justify-between p-3 bg-[var(--dashboard-surface)] border border-[var(--dashboard-border)] rounded-lg hover:border-[var(--trilogy-teal)]/30 cursor-pointer transition-colors"
                            onClick={() => handleDrillDown('serviceLine', sl.serviceLine)}
                            data-testid={`service-line-row-${sl.serviceLine}`}
                          >
                            <div className="flex items-center gap-3">
                              <div 
                                className="w-3 h-3 rounded-full" 
                                style={{ backgroundColor: SERVICE_LINE_COLORS[sl.serviceLine] || COLORS[0] }}
                              />
                              <div>
                                <p className="font-medium text-[var(--dashboard-text)]">{sl.serviceLine}</p>
                                <p className="text-sm text-[var(--dashboard-muted)]">{formatValue(sl.value)}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <GrowthBadge value={sl.growthStats.t12} />
                              <ArrowRight className="w-4 h-4 text-[var(--dashboard-muted)]" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* By Location Tab */}
              <TabsContent value="location" className="mt-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Pie Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Top 20 Locations</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={data.byLocation.slice(0, 20)}
                              cx="50%"
                              cy="50%"
                              outerRadius={100}
                              dataKey="value"
                              nameKey="location"
                              onClick={(entry) => handleDrillDown('location', entry.location)}
                              style={{ cursor: 'pointer' }}
                            >
                              {data.byLocation.slice(0, 20).map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip 
                              formatter={(value: number) => {
                                const total = data.byLocation.reduce((sum, item) => sum + item.value, 0);
                                const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                                return `${formatValue(value)} (${pct}%)`;
                              }} 
                              contentStyle={{
                                backgroundColor: 'var(--dashboard-surface)',
                                border: '1px solid var(--dashboard-border)',
                                borderRadius: '8px',
                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Location List */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">All Locations</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 max-h-72 overflow-y-auto">
                        {data.byLocation.map((loc, idx) => (
                          <div 
                            key={loc.location}
                            className="flex items-center justify-between p-2 hover:bg-[var(--trilogy-teal)]/5 border border-transparent hover:border-[var(--trilogy-teal)]/20 rounded cursor-pointer transition-colors"
                            onClick={() => handleDrillDown('location', loc.location)}
                            data-testid={`location-row-${idx}`}
                          >
                            <span className="text-sm text-[var(--dashboard-text)] truncate max-w-[200px]">{loc.location}</span>
                            <span className="text-sm font-medium text-[var(--dashboard-text)]">{formatValue(loc.value)}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* By Room Type Tab */}
              <TabsContent value="roomType" className="mt-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Pie Chart */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Distribution by Room Type</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={data.byRoomType}
                              cx="50%"
                              cy="50%"
                              innerRadius={50}
                              outerRadius={90}
                              paddingAngle={3}
                              dataKey="value"
                              nameKey="roomType"
                            >
                              {data.byRoomType.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip 
                              formatter={(value: number) => {
                                const total = data.byRoomType.reduce((sum, item) => sum + item.value, 0);
                                const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                                return `${formatValue(value)} (${pct}%)`;
                              }} 
                              contentStyle={{
                                backgroundColor: 'var(--dashboard-surface)',
                                border: '1px solid var(--dashboard-border)',
                                borderRadius: '8px',
                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                              }}
                            />
                            <Legend wrapperStyle={{ paddingTop: '10px' }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Room Type Details */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Room Type Breakdown</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {data.byRoomType.map((rt, idx) => {
                          const total = data.byRoomType.reduce((sum, r) => sum + r.value, 0);
                          const percentage = total > 0 ? (rt.value / total * 100) : 0;
                          return (
                            <div key={rt.roomType} className="space-y-1">
                              <div className="flex justify-between text-sm">
                                <span>{rt.roomType}</span>
                                <span className="font-medium">{formatValue(rt.value)} ({percentage.toFixed(1)}%)</span>
                              </div>
                              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div 
                                  className="h-full rounded-full transition-all"
                                  style={{ 
                                    width: `${percentage}%`,
                                    backgroundColor: COLORS[idx % COLORS.length]
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
