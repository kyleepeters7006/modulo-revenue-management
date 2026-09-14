import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DollarSign, Home, Users, TrendingUp, Info, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatNumber, formatCurrency, formatPercentage } from "@/lib/formatters";
import { TileDetailDialog } from "./tile-detail-dialog";
import RateGrowthDrilldown from "./rate-growth-drilldown";

interface ServiceLineData {
  serviceLine: string;
  occupied: number;
  total: number;
  occupancyRate: number;
  avgRate?: number;
  avgCompetitorRate?: number;
  avgModuloRate?: number;
  monthlyRemainder?: number;
  occupancyTrend?: number[];
  occupancyTrendDelta?: number | null;
}

interface OverviewData {
  occupancyByRoomType: {
    roomType: string;
    occupied: number;
    total: number;
    occupancyRate: number;
    avgRate?: number;
    avgCompetitorRate?: number;
    avgModuloRate?: number;
    monthlyRemainder?: number;
    occupancyTrend?: number[];
    occupancyTrendDelta?: number | null;
    serviceLineBreakdown?: ServiceLineData[];
  }[];
  occupancyByServiceLine: {
    serviceLine: string;
    occupied: number;
    total: number;
    occupancyRate: number;
    avgRate?: number;
    avgCompetitorRate?: number;
    avgModuloRate?: number;
    monthlyRemainder?: number;
  }[];
  currentAnnualRevenue: number;
  potentialAnnualRevenue: number;
  /**
   * Both payer bases, reported separately and never blended:
   * private pay = residents whose rate we set; total = every resident,
   * including externally-priced Medicaid/Medicare/Managed/Hospice.
   */
  currentAnnualRevenuePrivatePay?: number;
  currentAnnualRevenueTotal?: number;
  potentialAnnualRevenuePrivatePay?: number;
  potentialAnnualRevenueTotal?: number;
  annualValueOfOnePctBaseIncrease?: number;
  annualValueOfOnePctBaseIncreaseByServiceLine?: Array<{
    serviceLine: string;
    value: number;
  }>;
  totalUnits: number;  // Total portfolio units
  unitsWithData: number;  // Units with rent roll data
  totalLocations: number;  // Total campuses in portfolio
  locationsWithData: number;  // Campuses with rent roll data
  occupiedUnits: number;
  mostRecentMonth?: string;  // Month of rent roll data
  // Split rates for HC and Senior Housing
  avgHcRate?: number;
  avgSeniorHousingRate?: number;
  avgHcCompetitorRate?: number;
  avgSeniorHousingCompetitorRate?: number;
}

function OccupancySparkline({ values = [], delta }: { values?: number[]; delta?: number | null }) {
  const resolvedDelta = delta ?? (values.length >= 2 ? values[values.length - 1] - values[0] : null);
  const tone = resolvedDelta == null
    ? { stroke: "#94a3b8", text: "text-slate-500", label: "No T3 trend" }
    : resolvedDelta > 0.5
      ? { stroke: "#16a34a", text: "text-green-700", label: "Improving" }
      : resolvedDelta < -0.5
        ? { stroke: "#dc2626", text: "text-red-700", label: "Declining" }
        : { stroke: "#ca8a04", text: "text-yellow-700", label: "Stable" };
  const width = 54;
  const height = 16;
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const range = max - min || 1;
  const pointPairs = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : index * (width / (values.length - 1));
    const y = 2 + (max - value) / range * (height - 4);
    return { x, y, value };
  });
  const points = pointPairs.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const deltaLabel = resolvedDelta == null
    ? "T3 —"
    : `T3 ${resolvedDelta > 0 ? "+" : ""}${resolvedDelta.toFixed(1)}`;

  return (
    <div
      className="flex shrink-0 items-center"
      title={`${tone.label}: ${deltaLabel} percentage points`}
      aria-label={`${tone.label} occupancy trend, ${deltaLabel} percentage points`}
    >
      {points && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          <polyline points={points} fill="none" stroke={tone.stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {pointPairs.map(({ x, y, value }, index) => (
            <circle key={`${index}-${value}`} cx={x} cy={y} r="1.6" fill={tone.stroke} />
          ))}
        </svg>
      )}
    </div>
  );
}

export default function OverviewTiles() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogContent, setDialogContent] = useState<{ type: string; calculation: string } | null>(null);
  const [expandedRoomTypes, setExpandedRoomTypes] = useState<Set<string>>(new Set());
  const [tileDetailOpen, setTileDetailOpen] = useState(false);
  const [selectedTile, setSelectedTile] = useState<{ type: 'units' | 'occupancy' | 'current-revenue' | 'potential-revenue'; title: string } | null>(null);
  const queryClient = useQueryClient();

  const { data: overviewData, isLoading } = useQuery<OverviewData>({
    queryKey: ["/api/overview"],
  });

  // Prefetch tile details on hover for faster dialog loading
  const prefetchTileDetails = useCallback((tileType: string) => {
    queryClient.prefetchQuery({
      queryKey: ['/api/tile-details', tileType],
      staleTime: 5 * 60 * 1000,
    });
  }, [queryClient]);

  const toggleRoomTypeExpanded = (roomType: string) => {
    setExpandedRoomTypes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(roomType)) {
        newSet.delete(roomType);
      } else {
        newSet.add(roomType);
      }
      return newSet;
    });
  };

  if (isLoading || !overviewData) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="dashboard-card">
            <CardContent className="p-6">
              <div className="animate-pulse">
                <div className="h-4 bg-[var(--dashboard-border)] rounded w-3/4 mb-2"></div>
                <div className="h-8 bg-[var(--dashboard-border)] rounded w-1/2"></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const formatMoney = (v: number) =>
    v >= 1_000_000_000
      ? `$${(v / 1_000_000_000).toFixed(2)}B`
      : `$${formatNumber(Math.round(v / 1_000_000))}M`;

  const formatImpactMoney = (value: number) => {
    if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000).toLocaleString()}K`;
    return formatCurrency(Math.round(value));
  };

  // Fall back to the legacy fields when the API predates the explicit split, so
  // an older cached response still renders the (private-pay) headline number.
  const currentPrivatePay =
    overviewData.currentAnnualRevenuePrivatePay ?? overviewData.currentAnnualRevenue;
  const potentialPrivatePay =
    overviewData.potentialAnnualRevenuePrivatePay ?? overviewData.potentialAnnualRevenue;
  const currentTotal = overviewData.currentAnnualRevenueTotal;
  const potentialTotal = overviewData.potentialAnnualRevenueTotal;

  const tiles = [
    {
      title: "Total Units",
      value: formatNumber(overviewData.unitsWithData),
      subtitle: `${formatNumber(overviewData.locationsWithData)} campuses with data (${overviewData.mostRecentMonth || 'N/A'})`,
      icon: Home,
      color: "blue",
      testId: "metric-total-units",
      tileType: 'units' as const
    },
    {
      title: "Overall Occupancy",
      value: formatPercentage(overviewData.unitsWithData > 0 ? (overviewData.occupiedUnits / overviewData.unitsWithData) : 0, 0),
      subtitle: `${formatNumber(overviewData.occupiedUnits)}/${formatNumber(overviewData.unitsWithData)} units`,
      icon: Users,
      color: "emerald", 
      testId: "metric-overall-occupancy",
      tileType: 'occupancy' as const
    },
    {
      title: "Current Annual Revenue",
      value: formatMoney(currentPrivatePay),
      // The tile leads with private pay because that is the only revenue street
      // pricing can move; total is shown beneath so the figure can still be tied
      // back to the operator's books.
      subtitle: "Private pay · based on current occupancy",
      secondary: currentTotal != null ? `${formatMoney(currentTotal)} all payers` : undefined,
      icon: DollarSign,
      color: "amber",
      testId: "metric-current-revenue",
      tileType: 'current-revenue' as const
    },
    {
      title: "Potential Annual Revenue",
      value: formatMoney(potentialPrivatePay),
      subtitle: "Private pay · at full occupancy",
      secondary: potentialTotal != null ? `${formatMoney(potentialTotal)} all payers` : undefined,
      icon: TrendingUp,
      color: "blue",
      testId: "metric-potential-revenue",
      tileType: 'potential-revenue' as const
    },
  ];

  const handleTileClick = (tileType: typeof tiles[0]['tileType'], title: string) => {
    setSelectedTile({ type: tileType, title });
    setTileDetailOpen(true);
  };

  const getColorClasses = (color: string) => {
    const colors = {
      emerald: "bg-[var(--trilogy-success)]/10 text-[var(--trilogy-success)]",
      blue: "bg-[var(--trilogy-blue)]/10 text-[var(--trilogy-blue)]", 
      amber: "bg-[var(--trilogy-warning)]/10 text-[var(--trilogy-warning)]",
      cyan: "bg-cyan-500/10 text-cyan-500",
    };
    return colors[color as keyof typeof colors] || colors.emerald;
  };

  const renderRemainderWithDialog = (item: any, type: string) => {
    const avgRate = item.avgRate || 0;
    const moduloRate = item.avgModuloRate || 0;
    const remainder = item.monthlyRemainder || 0;
    const occupied = item.occupied || 0;
    const total = item.total || 0;
    const targetOccupancy = Math.round(total * 0.95); // 95% occupancy target
    
    const currentMonthlyRevenue = avgRate * occupied;
    const potentialMonthlyRevenue = moduloRate * targetOccupancy;
    
    const calculation = `Current Monthly Revenue:\n${formatCurrency(Math.round(avgRate))} × ${formatNumber(occupied)} units = ${formatCurrency(Math.round(currentMonthlyRevenue))}\n\nPotential at 95% Occupancy:\n${formatCurrency(Math.round(moduloRate))} × ${formatNumber(targetOccupancy)} units = ${formatCurrency(Math.round(potentialMonthlyRevenue))}\n\nMonthly Remainder:\n${formatCurrency(Math.round(potentialMonthlyRevenue))} - ${formatCurrency(Math.round(currentMonthlyRevenue))} = ${formatCurrency(Math.round(remainder))}`;
    
    const handleClick = () => {
      setDialogContent({ type, calculation });
      setDialogOpen(true);
    };
    
    return (
      <div 
        className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 rounded px-1 py-1 transition-colors active:bg-gray-200 dark:active:bg-gray-700"
        onClick={handleClick}
      >
        <div className="flex items-center gap-1 mb-0.5">
          <span className="text-[var(--dashboard-muted)] text-xs flex-shrink-0">Monthly Remainder:</span>
          <Info className="w-3 h-3 text-[var(--dashboard-muted)] flex-shrink-0" />
        </div>
        <div className="font-medium text-[var(--trilogy-success)] text-sm">
          {formatCurrency(Math.round(remainder))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Main Overview Tiles */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Card 
              key={tile.title} 
              className="dashboard-card !p-0 cursor-pointer hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-700 transition-all duration-200 group"
              onClick={() => handleTileClick(tile.tileType, tile.title)}
              onMouseEnter={() => prefetchTileDetails(tile.tileType)}
              data-testid={`tile-clickable-${tile.tileType}`}
            >
             <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-light text-[var(--dashboard-muted)] tracking-wide uppercase">
                        {tile.title}
                      </p>
                      <ExternalLink className="w-3 h-3 text-[var(--dashboard-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <p 
                       className="text-2xl font-light text-[var(--dashboard-text)]"
                      data-testid={tile.testId}
                    >
                      {tile.value}
                    </p>
                    <p className="text-xs text-[var(--dashboard-muted)]">
                      {tile.subtitle}
                    </p>
                    {'secondary' in tile && tile.secondary && (
                      <p className="text-xs text-[var(--dashboard-muted)] opacity-70">
                        {tile.secondary}
                      </p>
                    )}
                  </div>
                   <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${getColorClasses(tile.color)}`}>
                     <Icon className="w-5 h-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="dashboard-card">
        <CardHeader className="pb-2 pt-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <CardTitle className="text-lg font-semibold text-[var(--dashboard-text)]">
                Annual Value of a 1% In-House Increase
              </CardTitle>
              <p className="mt-1 text-xs text-[var(--dashboard-muted)]">
                Occupied private-pay base rates only. Does not include care.
              </p>
            </div>
            <div className="sm:text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted)]">
                Portfolio total
              </p>
              <p className="text-2xl font-semibold text-[var(--trilogy-teal)]" data-testid="one-percent-value-total">
                {formatImpactMoney(overviewData.annualValueOfOnePctBaseIncrease || 0)}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {['HC', 'HC/MC', 'AL', 'AL/MC', 'SL', 'VIL']
              .map((serviceLine) => ({
                serviceLine,
                value: overviewData.annualValueOfOnePctBaseIncreaseByServiceLine
                  ?.find((entry) => entry.serviceLine === serviceLine)?.value || 0,
              }))
              .map(({ serviceLine, value }) => (
                <div
                  key={serviceLine}
                  className="rounded-md border border-[var(--dashboard-border)] bg-[var(--dashboard-bg)] px-3 py-2"
                >
                  <p className="text-xs font-semibold text-[var(--dashboard-muted)]">{serviceLine}</p>
                  <p className="mt-0.5 text-base font-semibold text-[var(--dashboard-text)]">
                    {formatImpactMoney(value)}
                  </p>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

       <RateGrowthDrilldown />

       {/* Occupancy by Service Line Breakdown */}
      <Card className="dashboard-card">
        <CardHeader className="pb-3 pt-4">
          <CardTitle className="text-xl font-semibold text-[var(--dashboard-text)]">
            Occupancy by Service Line
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            {(() => {
              // Sort service lines in preferred order: HC, HC/MC, AL, AL/MC, SL, VIL
              const SERVICE_LINE_ORDER = ['HC', 'HC/MC', 'AL', 'AL/MC', 'SL', 'VIL'];
              const sortedServiceLines = [...(overviewData.occupancyByServiceLine || [])].sort((a, b) => {
                const indexA = SERVICE_LINE_ORDER.indexOf(a.serviceLine);
                const indexB = SERVICE_LINE_ORDER.indexOf(b.serviceLine);
                const orderA = indexA === -1 ? 999 : indexA;
                const orderB = indexB === -1 ? 999 : indexB;
                return orderA - orderB;
              });
              
              return sortedServiceLines.map((serviceLine) => {
                // HC and HC/MC use daily rates - convert competitor rate from monthly back to daily
                const isHcServiceLine = serviceLine.serviceLine === 'HC' || serviceLine.serviceLine === 'HC/MC';
                const displayCompetitorRate = isHcServiceLine 
                  ? (serviceLine.avgCompetitorRate || 0) / 30.44 
                  : (serviceLine.avgCompetitorRate || 0);
                const rateLabel = isHcServiceLine ? '/day' : '';
                
                return (
                  <div 
                    key={serviceLine.serviceLine} 
                    className="min-w-0 overflow-hidden rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-bg)] p-3"
                  >
                    <div className="mb-1 flex min-w-0 items-center gap-1.5">
                      <h4 className="min-w-0 shrink font-bold" style={{ color: '#1a1a1a' }}>
                        {serviceLine.serviceLine}
                      </h4>
                      <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        <OccupancySparkline
                          values={serviceLine.occupancyTrend}
                          delta={serviceLine.occupancyTrendDelta}
                        />
                        <span className="text-sm font-bold text-[var(--trilogy-teal)]">
                          {formatPercentage(serviceLine.occupancyRate / 100, 0)}
                        </span>
                      </div>
                    </div>
                    <div className="text-sm font-medium mb-1.5" style={{ color: '#4a4a4a' }}>
                      {formatNumber(serviceLine.occupied)} / {formatNumber(serviceLine.total)} units
                    </div>
                    <div className="w-full bg-[var(--dashboard-border)] rounded-full h-2 mb-2">
                      <div 
                        className="bg-[var(--trilogy-teal)] h-2 rounded-full transition-all duration-300"
                        style={{ width: `${serviceLine.occupancyRate}%` }}
                      ></div>
                    </div>
                    
                    {/* Rate Information */}
                    <div className="space-y-0.5 text-xs">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2">
                        <span className="min-w-0 font-semibold leading-tight" style={{ color: '#4a4a4a' }}>Avg Rate:</span>
                        <span className="shrink-0 whitespace-nowrap text-right font-bold" style={{ color: '#1a1a1a' }}>{formatCurrency(Math.round(serviceLine.avgRate || 0))}{rateLabel}</span>
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2">
                        <span className="min-w-0 font-semibold leading-tight" style={{ color: '#4a4a4a' }}>Competitor Rate:</span>
                        <span className="shrink-0 whitespace-nowrap text-right font-bold" style={{ color: '#1a1a1a' }}>{formatCurrency(Math.round(displayCompetitorRate))}{rateLabel}</span>
                      </div>
                      {renderRemainderWithDialog(serviceLine, serviceLine.serviceLine)}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </CardContent>
      </Card>
      
      {/* Occupancy by Room Type Breakdown */}
      <Card className="dashboard-card">
        <CardHeader className="pb-3 pt-4">
          <CardTitle className="text-xl font-semibold text-[var(--dashboard-text)]">
            Occupancy by Room Type
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {overviewData.occupancyByRoomType.map((roomType) => {
              const isExpanded = expandedRoomTypes.has(roomType.roomType);
              const hasServiceLineBreakdown = roomType.serviceLineBreakdown && roomType.serviceLineBreakdown.length > 0;
              
              return (
                <div 
                  key={roomType.roomType} 
                  className="bg-[var(--dashboard-bg)] p-4 rounded-lg border border-[var(--dashboard-border)]"
                >
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-medium text-[var(--dashboard-text)]">
                      {roomType.roomType}
                    </h4>
                    <span className="text-sm font-bold text-[var(--trilogy-blue)]">
                      {formatPercentage(roomType.occupancyRate / 100, 0)}
                    </span>
                  </div>
                  <div className="text-sm text-[var(--dashboard-muted)] mb-2">
                    {formatNumber(roomType.occupied)} / {formatNumber(roomType.total)} units
                  </div>
                  <div className="w-full bg-[var(--dashboard-border)] rounded-full h-2 mb-3">
                    <div 
                      className="bg-[var(--trilogy-blue)] h-2 rounded-full transition-all duration-300"
                      style={{ width: `${roomType.occupancyRate}%` }}
                    ></div>
                  </div>
                  
                  {/* Rate Information */}
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[var(--dashboard-muted)]">Avg Rate:</span>
                      <span className="font-medium">{formatCurrency(Math.round(roomType.avgRate || 0))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--dashboard-muted)]">Competitor Rate:</span>
                      <span className="font-medium">{formatCurrency(Math.round(roomType.avgCompetitorRate || 0))}</span>
                    </div>
                    {renderRemainderWithDialog(roomType, roomType.roomType)}
                  </div>

                  {/* Service Line Breakdown Toggle Button */}
                  {hasServiceLineBreakdown && (
                    <div className="mt-4 pt-3 border-t border-[var(--dashboard-border)]">
                      <button
                        onClick={() => toggleRoomTypeExpanded(roomType.roomType)}
                        className="w-full flex items-center justify-between px-2 py-1.5 text-xs font-medium text-[var(--dashboard-muted)] hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                      >
                        <span>Service Line Breakdown</span>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  )}

                  {/* Service Line Breakdown Content - Simplified Table View */}
                  {hasServiceLineBreakdown && isExpanded && (
                    <div className="mt-3 animate-in slide-in-from-top-1">
                      <div className="bg-white/10 rounded-md p-2">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-white/20">
                              <th className="text-left font-medium text-white/70 pb-1">Service</th>
                              <th className="text-center font-medium text-white/70 pb-1">Units</th>
                              <th className="text-right font-medium text-white/70 pb-1">Occupancy</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/10">
                            {roomType.serviceLineBreakdown?.map((serviceLine) => (
                              <tr key={serviceLine.serviceLine} className="hover:bg-white/10">
                                <td className="py-1.5 font-bold text-white">
                                  {serviceLine.serviceLine}
                                </td>
                                <td className="py-1.5 text-center font-medium text-white">
                                  {formatNumber(serviceLine.total)}
                                </td>
                                <td className="py-1.5 text-right">
                                  <span className="font-bold text-teal-300">
                                    {formatPercentage(serviceLine.occupancyRate / 100, 0)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        {/* Summary of occupied units */}
                        <div className="mt-2 pt-2 border-t border-white/20 flex justify-between text-xs">
                          <span className="text-white/60">Total Occupied:</span>
                          <span className="font-medium text-white">
                            {formatNumber(roomType.serviceLineBreakdown?.reduce((sum, sl) => sum + sl.occupied, 0) || 0)} of {formatNumber(roomType.total)} units
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Monthly Remainder Calculation Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogContent?.type} Remainder Calculation</DialogTitle>
            <DialogDescription>
              Detailed breakdown of monthly revenue opportunity
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <pre className="text-xs font-mono whitespace-pre-line bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
              {dialogContent?.calculation}
            </pre>
          </div>
        </DialogContent>
      </Dialog>

      {/* Tile Detail Dialog - shows monthly trends, growth statistics, and breakdowns */}
      {selectedTile && (
        <TileDetailDialog
          open={tileDetailOpen}
          onOpenChange={setTileDetailOpen}
          tileType={selectedTile.type}
          tileTitle={selectedTile.title}
        />
      )}
    </div>
  );
}