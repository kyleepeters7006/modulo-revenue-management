import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { 
  Collapsible, CollapsibleContent, CollapsibleTrigger 
} from "@/components/ui/collapsible";
import { TrendingUp, TrendingDown, Home, Users, DollarSign, ArrowRight, ChevronRight, ChevronDown, Building2, MapPin, X } from "lucide-react";
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

interface DrillDownData {
  tileType: string;
  period: string;
  serviceLine: string;
  sameStore: boolean;
  currentMonth: string;
  comparisonMonth: string;
  regions: Array<{ name: string; current: number; previous: number; growth: number; divisionCount: number; campusCount: number }>;
  divisions: Array<{ name: string; region: string; current: number; previous: number; growth: number; campusCount: number }>;
  campuses: Array<{ name: string; region: string; division: string; current: number; previous: number; growth: number }>;
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

// Preferred sort order for service lines
const SERVICE_LINE_ORDER = ['HC', 'AL', 'SL', 'VIL', 'AL/MC', 'HC/MC'];

const sortServiceLines = <T extends { serviceLine: string }>(data: T[] | undefined): T[] => {
  if (!data) return [];
  return [...data].sort((a, b) => {
    const indexA = SERVICE_LINE_ORDER.indexOf(a.serviceLine);
    const indexB = SERVICE_LINE_ORDER.indexOf(b.serviceLine);
    // If not in order array, put at end
    const orderA = indexA === -1 ? 999 : indexA;
    const orderB = indexB === -1 ? 999 : indexB;
    return orderA - orderB;
  });
};

export function TileDetailDialog({ open, onOpenChange, tileType, tileTitle }: TileDetailDialogProps) {
  const [drillLevel, setDrillLevel] = useState<'overview' | 'location' | 'serviceLine' | 'roomType'>('overview');
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [selectedServiceLine, setSelectedServiceLine] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'revenue' | 'rate'>('revenue');
  
  // Drill-down state for growth stats
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [drillDownPeriod, setDrillDownPeriod] = useState<'t1' | 't3' | 't6' | 't12' | 'ytd'>('t12');
  const [drillDownServiceLine, setDrillDownServiceLine] = useState<string | null>(null);
  const [drillDownSameStore, setDrillDownSameStore] = useState(false);

  const { data, isLoading, error } = useQuery<TileDetailsResponse>({
    queryKey: ['/api/tile-details', tileType],
    enabled: open,
    staleTime: 5 * 60 * 1000, // Cache data for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep unused data in cache for 10 minutes
  });
  
  // Drill-down data query
  const { data: drillDownData, isLoading: drillDownLoading } = useQuery<DrillDownData>({
    queryKey: ['/api/tile-details', tileType, 'drill-down', drillDownPeriod, drillDownServiceLine, drillDownSameStore],
    queryFn: async () => {
      const params = new URLSearchParams({ period: drillDownPeriod });
      if (drillDownServiceLine) params.set('serviceLine', drillDownServiceLine);
      if (drillDownSameStore) params.set('sameStore', 'true');
      const response = await fetch(`/api/tile-details/${tileType}/drill-down?${params}`);
      if (!response.ok) throw new Error('Failed to fetch drill-down data');
      return response.json();
    },
    enabled: drillDownOpen,
    staleTime: 5 * 60 * 1000,
  });
  
  const handleDrillDownClick = (period: 't1' | 't3' | 't6' | 't12' | 'ytd', serviceLine: string | null, isSameStore: boolean) => {
    setDrillDownPeriod(period);
    setDrillDownServiceLine(serviceLine);
    setDrillDownSameStore(isSameStore);
    setDrillDownOpen(true);
  };
  
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

  const formatUnitChange = (currentValue: number, growthPercent: number) => {
    const change = Math.round(currentValue * (growthPercent / 100) / (1 + growthPercent / 100));
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toLocaleString()}`;
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

  const GrowthStatsPanel = ({ stats, title, serviceLineData, showUnits, currentValue, isOccupancy, isRate, isRevenue, isSameStore = false }: { stats: GrowthStats; title: string; serviceLineData?: ServiceLineData[]; showUnits?: boolean; currentValue?: number; isOccupancy?: boolean; isRate?: boolean; isRevenue?: boolean; isSameStore?: boolean }) => {
    const formatCell = (percent: number, value?: number) => {
      if (showUnits && value) {
        return formatUnitChange(value, percent);
      }
      return formatGrowth(percent);
    };

    const formatOccupancyValue = (value: number) => `${value.toFixed(1)}%`;
    
    const formatCurrentValue = (value: number) => {
      if (isOccupancy) return `${value.toFixed(1)}%`;
      if (isRate) return `$${Math.round(value).toLocaleString()}`;
      if (isRevenue) {
        if (value >= 1000000000) return `$${(value / 1000000000).toFixed(2)}B`;
        if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
        return `$${Math.round(value).toLocaleString()}`;
      }
      return value.toLocaleString();
    };

    const showCurrentColumn = isOccupancy || isRate || isRevenue;
    
    const ClickableCell = ({ period, percent, serviceLine = null, className, rowValue }: { period: 't1' | 't3' | 't6' | 't12' | 'ytd'; percent: number; serviceLine?: string | null; className?: string; rowValue?: number }) => (
      <td 
        className={`text-center py-2 px-1 cursor-pointer hover:bg-[var(--trilogy-teal)]/10 hover:underline transition-colors ${className}`}
        onClick={() => handleDrillDownClick(period, serviceLine, isSameStore)}
        data-testid={`drill-down-${period}${serviceLine ? `-${serviceLine}` : ''}${isSameStore ? '-samestore' : ''}`}
      >
        {formatCell(percent, showUnits ? (rowValue ?? currentValue) : undefined)}
      </td>
    );
    
    return (
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
                {showCurrentColumn && <th className="text-center py-2 px-1 text-[var(--dashboard-muted)] font-medium">Current</th>}
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
                {showCurrentColumn && currentValue !== undefined && (
                  <td className="text-center py-2 px-1 font-bold text-[var(--dashboard-text)]">{formatCurrentValue(currentValue)}</td>
                )}
                <ClickableCell period="t1" percent={stats.t1} rowValue={currentValue} className={`font-bold ${stats.t1 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`} />
                <ClickableCell period="t3" percent={stats.t3} rowValue={currentValue} className={`font-bold ${stats.t3 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`} />
                <ClickableCell period="t6" percent={stats.t6} rowValue={currentValue} className={`font-bold ${stats.t6 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`} />
                <ClickableCell period="t12" percent={stats.t12} rowValue={currentValue} className={`font-bold ${stats.t12 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`} />
                <ClickableCell period="ytd" percent={stats.ytd} rowValue={currentValue} className={`font-bold ${stats.ytd >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`} />
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
                  {showCurrentColumn && (
                    <td className="text-center py-2 px-1 font-medium text-[var(--dashboard-text)]">{formatCurrentValue(sl.value)}</td>
                  )}
                  <ClickableCell period="t1" percent={sl.growthStats.t1} serviceLine={sl.serviceLine} rowValue={sl.value} className={sl.growthStats.t1 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'} />
                  <ClickableCell period="t3" percent={sl.growthStats.t3} serviceLine={sl.serviceLine} rowValue={sl.value} className={sl.growthStats.t3 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'} />
                  <ClickableCell period="t6" percent={sl.growthStats.t6} serviceLine={sl.serviceLine} rowValue={sl.value} className={sl.growthStats.t6 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'} />
                  <ClickableCell period="t12" percent={sl.growthStats.t12} serviceLine={sl.serviceLine} rowValue={sl.value} className={sl.growthStats.t12 >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'} />
                  <ClickableCell period="ytd" percent={sl.growthStats.ytd} serviceLine={sl.serviceLine} rowValue={sl.value} className={sl.growthStats.ytd >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
  };

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

        {/* Note about assumed private pay percentage for potential revenue */}
        {tileType === 'potential-revenue' && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300">
            <span className="font-medium">Note:</span> Potential revenue for vacant units assumes private pay rates of 21% for HC and 31% for HC/MC based on current payor mix.
          </div>
        )}

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
                      serviceLineData={sortServiceLines(displayByServiceLine)}
                      showUnits={tileType === 'units'}
                      currentValue={displayData.currentValue}
                      isOccupancy={tileType === 'occupancy'}
                      isRate={isRevenueTile && viewMode === 'rate'}
                      isRevenue={isRevenueTile && viewMode === 'revenue'}
                    />
                    <GrowthStatsPanel 
                      stats={displaySameStore.growthStats} 
                      title={viewMode === 'rate' ? 'Same Store Rate Growth' : 'Same Store Growth'} 
                      serviceLineData={sortServiceLines(displaySameStore.byServiceLine)}
                      showUnits={tileType === 'units'}
                      currentValue={displaySameStore.currentValue}
                      isOccupancy={tileType === 'occupancy'}
                      isRate={isRevenueTile && viewMode === 'rate'}
                      isRevenue={isRevenueTile && viewMode === 'revenue'}
                      isSameStore={true}
                    />
                  </div>
                </>
              );
            })()}

            {/* Tabs for different views - Units defaults to serviceLine tab */}
            <Tabs defaultValue={tileType === 'units' ? 'serviceLine' : 'trend'} className="w-full">
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
                            domain={(() => {
                              const values = data.monthlyTrend.map(d => d.value);
                              const minVal = Math.min(...values);
                              const maxVal = Math.max(...values);
                              const range = maxVal - minVal;
                              const padding = range * 0.1 || 5;
                              const roundedMin = Math.floor((minVal - padding) / 5) * 5;
                              const roundedMax = Math.ceil((maxVal + padding) / 5) * 5;
                              return [Math.max(0, roundedMin), roundedMax];
                            })()}
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
                          {sortServiceLines(data.byServiceLine).map((sl, idx) => (
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
                              data={sortServiceLines(data.byServiceLine)}
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
                              {sortServiceLines(data.byServiceLine).map((entry, index) => (
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
                        {sortServiceLines(data.byServiceLine).map((sl) => (
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
        
        {/* Hierarchical Drill-Down Dialog */}
        {drillDownOpen && (
          <Dialog open={drillDownOpen} onOpenChange={setDrillDownOpen}>
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-[var(--trilogy-teal)]" />
                  {drillDownPeriod.toUpperCase()} Growth Breakdown
                  {drillDownServiceLine && <Badge variant="outline">{drillDownServiceLine}</Badge>}
                  {drillDownSameStore && <Badge variant="secondary">Same Store</Badge>}
                </DialogTitle>
                <DialogDescription>
                  Hierarchical breakdown by Region → Division → Campus
                  {drillDownData && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({drillDownData.comparisonMonth} → {drillDownData.currentMonth})
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>
              
              {drillDownLoading ? (
                <div className="space-y-4 py-4">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-32 w-full" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : drillDownData ? (
                <div className="space-y-4 py-4">
                  {/* Regions */}
                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <MapPin className="w-4 h-4" />
                      By Region ({drillDownData.regions.length})
                    </h3>
                    <div className="space-y-2">
                      {drillDownData.regions.map((region) => (
                        <Collapsible key={region.name}>
                          <CollapsibleTrigger className="w-full" data-testid={`region-${region.name}`}>
                            <div className="flex items-center justify-between p-3 bg-[var(--dashboard-surface)] border border-[var(--dashboard-border)] rounded-lg hover:bg-[var(--dashboard-surface)]/80 transition-colors">
                              <div className="flex items-center gap-3">
                                <ChevronDown className="w-4 h-4 transition-transform" />
                                <span className="font-medium">{region.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  ({region.divisionCount} divisions, {region.campusCount} campuses)
                                </span>
                              </div>
                              <div className="flex items-center gap-4">
                                <span className="text-sm">
                                  {tileType === 'occupancy' 
                                    ? `${region.current.toFixed(1)}%` 
                                    : tileType === 'units' 
                                    ? region.current.toLocaleString() 
                                    : region.current >= 1000000 
                                    ? `$${(region.current / 1000000).toFixed(1)}M`
                                    : `$${Math.round(region.current).toLocaleString()}`}
                                </span>
                                <Badge 
                                  variant="outline" 
                                  className={region.growth >= 0 
                                    ? 'text-[var(--trilogy-success)] border-[var(--trilogy-success)]/20 bg-[var(--trilogy-success)]/10' 
                                    : 'text-[var(--trilogy-error)] border-[var(--trilogy-error)]/20 bg-[var(--trilogy-error)]/10'}
                                >
                                  {region.growth >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                                  {region.growth >= 0 ? '+' : ''}{region.growth.toFixed(1)}%
                                </Badge>
                              </div>
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="ml-6 mt-2 space-y-2">
                              {drillDownData.divisions
                                .filter(d => d.region === region.name)
                                .map((division) => (
                                  <Collapsible key={division.name}>
                                    <CollapsibleTrigger className="w-full" data-testid={`division-${division.name}`}>
                                      <div className="flex items-center justify-between p-2 bg-[var(--dashboard-background)] border border-[var(--dashboard-border)] rounded-lg hover:bg-[var(--dashboard-surface)]/50 transition-colors">
                                        <div className="flex items-center gap-3">
                                          <ChevronDown className="w-3 h-3 transition-transform" />
                                          <span className="text-sm font-medium">{division.name}</span>
                                          <span className="text-xs text-muted-foreground">({division.campusCount} campuses)</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <span className="text-xs">
                                            {tileType === 'occupancy' 
                                              ? `${division.current.toFixed(1)}%` 
                                              : tileType === 'units'
                                              ? division.current.toLocaleString()
                                              : division.current >= 1000000 
                                              ? `$${(division.current / 1000000).toFixed(1)}M`
                                              : `$${Math.round(division.current).toLocaleString()}`}
                                          </span>
                                          <span className={`text-xs font-medium ${division.growth >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
                                            {division.growth >= 0 ? '+' : ''}{division.growth.toFixed(1)}%
                                          </span>
                                        </div>
                                      </div>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                      <div className="ml-5 mt-1 space-y-1">
                                        {drillDownData.campuses
                                          .filter(c => c.division === division.name)
                                          .map((campus) => (
                                            <div 
                                              key={campus.name} 
                                              className="flex items-center justify-between p-2 text-xs border-l-2 border-[var(--dashboard-border)] pl-3"
                                              data-testid={`campus-${campus.name}`}
                                            >
                                              <span>{campus.name}</span>
                                              <div className="flex items-center gap-3">
                                                <span>
                                                  {tileType === 'occupancy' 
                                                    ? `${campus.current.toFixed(1)}%` 
                                                    : tileType === 'units'
                                                    ? campus.current.toLocaleString()
                                                    : campus.current >= 1000000 
                                                    ? `$${(campus.current / 1000000).toFixed(1)}M`
                                                    : `$${Math.round(campus.current).toLocaleString()}`}
                                                </span>
                                                <span className={`font-medium ${campus.growth >= 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
                                                  {campus.growth >= 0 ? '+' : ''}{campus.growth.toFixed(1)}%
                                                </span>
                                              </div>
                                            </div>
                                          ))}
                                      </div>
                                    </CollapsibleContent>
                                  </Collapsible>
                                ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      ))}
                    </div>
                  </div>
                  
                  {/* Top/Bottom Performers Summary */}
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[var(--dashboard-border)]">
                    <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2 text-green-700 dark:text-green-400">
                          <TrendingUp className="w-4 h-4" />
                          Top 5 Campuses
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1">
                        {drillDownData.campuses.slice(0, 5).map((c, i) => (
                          <div key={c.name} className="flex justify-between text-xs">
                            <span className="truncate max-w-[150px]">{i + 1}. {c.name}</span>
                            <span className="text-green-600 font-medium">+{c.growth.toFixed(1)}%</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                    <Card className="bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2 text-red-700 dark:text-red-400">
                          <TrendingDown className="w-4 h-4" />
                          Bottom 5 Campuses
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1">
                        {[...drillDownData.campuses].reverse().slice(0, 5).map((c, i) => (
                          <div key={c.name} className="flex justify-between text-xs">
                            <span className="truncate max-w-[150px]">{i + 1}. {c.name}</span>
                            <span className="text-red-600 font-medium">{c.growth.toFixed(1)}%</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground">
                  No data available
                </div>
              )}
              
              <div className="flex justify-end pt-4 border-t">
                <Button variant="outline" onClick={() => setDrillDownOpen(false)} data-testid="close-drill-down">
                  Close
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
