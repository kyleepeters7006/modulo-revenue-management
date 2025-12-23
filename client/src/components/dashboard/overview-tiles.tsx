import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DollarSign, Home, Users, TrendingUp, Info, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatNumber, formatCurrency, formatPercentage } from "@/lib/formatters";
import { TileDetailDialog } from "./tile-detail-dialog";

interface ServiceLineData {
  serviceLine: string;
  occupied: number;
  total: number;
  occupancyRate: number;
  avgRate?: number;
  avgCompetitorRate?: number;
  avgModuloRate?: number;
  monthlyRemainder?: number;
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
      value: overviewData.currentAnnualRevenue >= 1000000000 
        ? `$${(overviewData.currentAnnualRevenue / 1000000000).toFixed(2)}B`
        : `$${formatNumber(Math.round(overviewData.currentAnnualRevenue / 1000000))}M`,
      subtitle: "Based on current occupancy",
      icon: DollarSign,
      color: "amber",
      testId: "metric-current-revenue",
      tileType: 'current-revenue' as const
    },
    {
      title: "Potential Annual Revenue",
      value: overviewData.potentialAnnualRevenue >= 1000000000 
        ? `$${(overviewData.potentialAnnualRevenue / 1000000000).toFixed(2)}B`
        : `$${formatNumber(Math.round(overviewData.potentialAnnualRevenue / 1000000))}M`, 
      subtitle: "At full occupancy",
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
    <div className="space-y-8">
      {/* Main Overview Tiles */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Card 
              key={tile.title} 
              className="dashboard-card cursor-pointer hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-700 transition-all duration-200 group"
              onClick={() => handleTileClick(tile.tileType, tile.title)}
              onMouseEnter={() => prefetchTileDetails(tile.tileType)}
              data-testid={`tile-clickable-${tile.tileType}`}
            >
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-light text-[var(--dashboard-muted)] tracking-wide uppercase">
                        {tile.title}
                      </p>
                      <ExternalLink className="w-3 h-3 text-[var(--dashboard-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <p 
                      className="text-3xl font-light text-[var(--dashboard-text)]"
                      data-testid={tile.testId}
                    >
                      {tile.value}
                    </p>
                    <p className="text-xs text-[var(--dashboard-muted)]">
                      {tile.subtitle}
                    </p>
                  </div>
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${getColorClasses(tile.color)}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Occupancy by Service Line Breakdown */}
      <Card className="dashboard-card">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-[var(--dashboard-text)]">
            Occupancy by Service Line
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {overviewData.occupancyByServiceLine?.map((serviceLine) => (
              <div 
                key={serviceLine.serviceLine} 
                className="bg-[var(--dashboard-bg)] p-4 rounded-lg border border-[var(--dashboard-border)]"
              >
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-bold" style={{ color: '#1a1a1a' }}>
                    {serviceLine.serviceLine}
                  </h4>
                  <span className="text-sm font-bold text-[var(--trilogy-teal)]">
                    {formatPercentage(serviceLine.occupancyRate / 100, 0)}
                  </span>
                </div>
                <div className="text-sm font-medium mb-2" style={{ color: '#4a4a4a' }}>
                  {formatNumber(serviceLine.occupied)} / {formatNumber(serviceLine.total)} units
                </div>
                <div className="w-full bg-[var(--dashboard-border)] rounded-full h-2 mb-3">
                  <div 
                    className="bg-[var(--trilogy-teal)] h-2 rounded-full transition-all duration-300"
                    style={{ width: `${serviceLine.occupancyRate}%` }}
                  ></div>
                </div>
                
                {/* Rate Information */}
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="font-semibold" style={{ color: '#4a4a4a' }}>Avg Rate:</span>
                    <span className="font-bold" style={{ color: '#1a1a1a' }}>{formatCurrency(Math.round(serviceLine.avgRate || 0))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold" style={{ color: '#4a4a4a' }}>Competitor Rate:</span>
                    <span className="font-bold" style={{ color: '#1a1a1a' }}>{formatCurrency(Math.round(serviceLine.avgCompetitorRate || 0))}</span>
                  </div>
                  {renderRemainderWithDialog(serviceLine, serviceLine.serviceLine)}
                </div>
              </div>
            )) || []}
          </div>
        </CardContent>
      </Card>
      
      {/* Occupancy by Room Type Breakdown */}
      <Card className="dashboard-card">
        <CardHeader>
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
                      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-md p-2">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="text-left font-medium text-gray-700 pb-1">Service</th>
                              <th className="text-center font-medium text-gray-700 pb-1">Units</th>
                              <th className="text-right font-medium text-gray-700 pb-1">Occupancy</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {roomType.serviceLineBreakdown?.map((serviceLine) => (
                              <tr key={serviceLine.serviceLine} className="hover:bg-gray-100 dark:hover:bg-gray-800">
                                <td className="py-1.5 font-bold text-gray-900">
                                  {serviceLine.serviceLine}
                                </td>
                                <td className="py-1.5 text-center font-medium text-gray-900">
                                  {formatNumber(serviceLine.total)}
                                </td>
                                <td className="py-1.5 text-right">
                                  <span className="font-bold text-teal-600">
                                    {formatPercentage(serviceLine.occupancyRate / 100, 0)}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        
                        {/* Summary of occupied units */}
                        <div className="mt-2 pt-2 border-t border-gray-200 flex justify-between text-xs">
                          <span className="text-gray-600">Total Occupied:</span>
                          <span className="font-medium text-gray-900">
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