import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { DollarSign, Home, Users, TrendingUp, Info } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  totalUnits: number;
  occupiedUnits: number;
}

export default function OverviewTiles() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogContent, setDialogContent] = useState<{ type: string; calculation: string } | null>(null);

  const { data: overviewData, isLoading } = useQuery<OverviewData>({
    queryKey: ["/api/overview"],
  });

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
      value: overviewData.totalUnits.toLocaleString(),
      subtitle: `${overviewData.occupiedUnits.toLocaleString()} occupied`,
      icon: Home,
      color: "blue",
      testId: "metric-total-units"
    },
    {
      title: "Overall Occupancy",
      value: `${((overviewData.occupiedUnits / overviewData.totalUnits) * 100).toFixed(1)}%`,
      subtitle: `${overviewData.occupiedUnits.toLocaleString()}/${overviewData.totalUnits.toLocaleString()} units`,
      icon: Users,
      color: "emerald", 
      testId: "metric-overall-occupancy"
    },
    {
      title: "Current Annual Revenue", 
      value: `$${(overviewData.currentAnnualRevenue / 1000000).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}M`,
      subtitle: "Based on current occupancy",
      icon: DollarSign,
      color: "amber",
      testId: "metric-current-revenue"
    },
    {
      title: "Potential Annual Revenue",
      value: `$${(overviewData.potentialAnnualRevenue / 1000000).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}M`, 
      subtitle: "At full occupancy",
      icon: TrendingUp,
      color: "purple",
      testId: "metric-potential-revenue"
    },
  ];

  const getColorClasses = (color: string) => {
    const colors = {
      emerald: "bg-[var(--trilogy-success)]/10 text-[var(--trilogy-success)]",
      blue: "bg-[var(--trilogy-blue)]/10 text-[var(--trilogy-blue)]", 
      amber: "bg-[var(--trilogy-warning)]/10 text-[var(--trilogy-warning)]",
      purple: "bg-purple-500/10 text-purple-500",
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
    
    const calculation = `Current Monthly Revenue:\n$${Math.round(avgRate).toLocaleString()} × ${occupied} units = $${Math.round(currentMonthlyRevenue).toLocaleString()}\n\nPotential at 95% Occupancy:\n$${Math.round(moduloRate).toLocaleString()} × ${targetOccupancy} units = $${Math.round(potentialMonthlyRevenue).toLocaleString()}\n\nMonthly Remainder:\n$${Math.round(potentialMonthlyRevenue).toLocaleString()} - $${Math.round(currentMonthlyRevenue).toLocaleString()} = $${Math.round(remainder).toLocaleString()}`;
    
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
          ${Math.round(remainder).toLocaleString()}
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
            <Card key={tile.title} className="dashboard-card">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <p className="text-sm font-light text-[var(--dashboard-muted)] tracking-wide uppercase">
                      {tile.title}
                    </p>
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
                  <h4 className="font-medium text-[var(--dashboard-text)]">
                    {serviceLine.serviceLine}
                  </h4>
                  <span className="text-sm font-bold text-[var(--trilogy-teal)]">
                    {serviceLine.occupancyRate.toFixed(1)}%
                  </span>
                </div>
                <div className="text-sm text-[var(--dashboard-muted)] mb-2">
                  {serviceLine.occupied.toLocaleString()} / {serviceLine.total.toLocaleString()} units
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
                    <span className="text-[var(--dashboard-muted)]">Avg Rate:</span>
                    <span className="font-medium">${Math.round(serviceLine.avgRate || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--dashboard-muted)]">Competitor Rate:</span>
                    <span className="font-medium">${Math.round(serviceLine.avgCompetitorRate || 0).toLocaleString()}</span>
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
            {overviewData.occupancyByRoomType.map((roomType) => (
              <div 
                key={roomType.roomType} 
                className="bg-[var(--dashboard-bg)] p-4 rounded-lg border border-[var(--dashboard-border)]"
              >
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-medium text-[var(--dashboard-text)]">
                    {roomType.roomType}
                  </h4>
                  <span className="text-sm font-bold text-[var(--trilogy-blue)]">
                    {roomType.occupancyRate.toFixed(1)}%
                  </span>
                </div>
                <div className="text-sm text-[var(--dashboard-muted)] mb-2">
                  {roomType.occupied.toLocaleString()} / {roomType.total.toLocaleString()} units
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
                    <span className="font-medium">${Math.round(roomType.avgRate || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--dashboard-muted)]">Competitor Rate:</span>
                    <span className="font-medium">${Math.round(roomType.avgCompetitorRate || 0).toLocaleString()}</span>
                  </div>
                  {renderRemainderWithDialog(roomType, roomType.roomType)}
                </div>
              </div>
            ))}
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
    </div>
  );
}