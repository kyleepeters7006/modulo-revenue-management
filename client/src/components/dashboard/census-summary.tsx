import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info, Database, Users, Building2 } from "lucide-react";
import { formatNumber, formatPercentage } from "@/lib/formatters";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ServiceLineData {
  serviceLine: string;
  totalBeds: number;
  aBeds: number;
  bBeds: number;
  occupiedBeds: number;
  occupancyRate: number;
  censusBeds: number;  // Filtered beds for census calculation
  censusOccupied: number;
  censusOccupancyRate: number;
}

interface CensusSummaryData {
  databaseTotals: {
    totalBeds: number;
    aBeds: number;
    bBeds: number;
    occupiedBeds: number;
    occupancyRate: number;
  };
  censusTotals: {
    totalBeds: number;  // Only A-beds for AL/SL/VIL, all beds for HC
    occupiedBeds: number;
    occupancyRate: number;
  };
  serviceLineBreakdown: ServiceLineData[];
  totalCampuses: number;
  campusesWithData: number;
  portfolioCoverage: number;
  mostRecentMonth?: string;
}

interface CensusSummaryProps {
  data?: CensusSummaryData;
  isLoading?: boolean;
}

export default function CensusSummary({ data, isLoading }: CensusSummaryProps) {
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {[1, 2].map((i) => (
          <Card key={i} className="dashboard-card">
            <CardContent className="p-6">
              <div className="animate-pulse">
                <div className="h-6 bg-[var(--dashboard-border)] rounded w-3/4 mb-4"></div>
                <div className="space-y-3">
                  <div className="h-4 bg-[var(--dashboard-border)] rounded w-1/2"></div>
                  <div className="h-4 bg-[var(--dashboard-border)] rounded w-2/3"></div>
                  <div className="h-4 bg-[var(--dashboard-border)] rounded w-1/3"></div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const serviceLineColors: Record<string, string> = {
    'AL': 'text-emerald-600 bg-emerald-50 border-emerald-200',
    'HC': 'text-blue-600 bg-blue-50 border-blue-200',
    'SL': 'text-purple-600 bg-purple-50 border-purple-200',
    'VIL': 'text-amber-600 bg-amber-50 border-amber-200',
    'IL': 'text-rose-600 bg-rose-50 border-rose-200',
    'MC': 'text-indigo-600 bg-indigo-50 border-indigo-200'
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Census Methodology Explanation */}
        <Card className="dashboard-card bg-blue-50/50 border-blue-200">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-600 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900 mb-2">Census Counting Methodology</h3>
                <p className="text-sm text-blue-800 mb-3">
                  The census summary shows two views of our portfolio occupancy:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="flex gap-2">
                    <Database className="w-4 h-4 text-blue-600 mt-0.5" />
                    <div>
                      <span className="font-medium text-blue-900">Database View:</span>
                      <span className="text-blue-700"> All beds in the system including both A and B beds (full inventory)</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Users className="w-4 h-4 text-blue-600 mt-0.5" />
                    <div>
                      <span className="font-medium text-blue-900">Census View:</span>
                      <span className="text-blue-700"> Rate Card eligible units (A-beds only for AL/SL/VIL, all beds for HC)</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-blue-600" />
                  <p className="text-sm text-blue-800">
                    <span className="font-medium">Portfolio Coverage:</span> This represents {formatNumber(data.campusesWithData)} of {formatNumber(data.totalCampuses)} total Trilogy campuses ({formatPercentage(data.portfolioCoverage / 100)})
                    {data.mostRecentMonth && <span className="ml-2 text-blue-600">• Data from {data.mostRecentMonth}</span>}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Census Views */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Database View */}
          <Card className="dashboard-card">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5 text-[var(--trilogy-dark-blue)]" />
                <span className="text-xl font-semibold text-[var(--dashboard-text)]">Database View</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-4 h-4 text-[var(--dashboard-muted)] cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>Complete inventory including all A-beds and B-beds across all service lines</p>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Total Summary */}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-[var(--dashboard-muted)] uppercase tracking-wide mb-1">Total Beds</p>
                    <p className="text-2xl font-semibold text-[var(--dashboard-text)]" data-testid="database-total-beds">
                      {formatNumber(data.databaseTotals.totalBeds)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--dashboard-muted)] uppercase tracking-wide mb-1">Occupancy</p>
                    <p className="text-2xl font-semibold text-[var(--trilogy-teal)]" data-testid="database-occupancy">
                      {formatPercentage(data.databaseTotals.occupancyRate / 100)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--dashboard-muted)]">Occupied / Total</span>
                    <span className="font-medium">
                      {formatNumber(data.databaseTotals.occupiedBeds)} / {formatNumber(data.databaseTotals.totalBeds)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-[var(--dashboard-muted)]">A-Beds</span>
                    <span className="font-medium">{formatNumber(data.databaseTotals.aBeds)}</span>
                  </div>
                  <div className="flex justify-between text-sm mt-1">
                    <span className="text-[var(--dashboard-muted)]">B-Beds</span>
                    <span className="font-medium">{formatNumber(data.databaseTotals.bBeds)}</span>
                  </div>
                </div>
              </div>

              {/* Service Line Breakdown */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--dashboard-muted)]">By Service Line</p>
                {data.serviceLineBreakdown.map((line) => (
                  <div key={line.serviceLine} className={`rounded-lg border p-3 ${serviceLineColors[line.serviceLine] || 'bg-gray-50 border-gray-200'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{line.serviceLine}</span>
                      <span className="text-sm font-semibold">{formatPercentage(line.occupancyRate / 100)}</span>
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="opacity-80">Total Beds:</span>
                        <span className="font-medium">{formatNumber(line.totalBeds)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="opacity-80">A / B Beds:</span>
                        <span className="font-medium">{formatNumber(line.aBeds)} / {formatNumber(line.bBeds)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="opacity-80">Occupied:</span>
                        <span className="font-medium">{formatNumber(line.occupiedBeds)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Census View */}
          <Card className="dashboard-card">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-[var(--trilogy-teal)]" />
                <span className="text-xl font-semibold text-[var(--dashboard-text)]">Census View</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-4 h-4 text-[var(--dashboard-muted)] cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>Rate Card eligible units: A-beds only for AL/SL/VIL, all beds for HC</p>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Total Summary */}
              <div className="bg-teal-50 dark:bg-teal-900/20 rounded-lg p-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-[var(--dashboard-muted)] uppercase tracking-wide mb-1">Census Beds</p>
                    <p className="text-2xl font-semibold text-[var(--dashboard-text)]" data-testid="census-total-beds">
                      {formatNumber(data.censusTotals.totalBeds)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--dashboard-muted)] uppercase tracking-wide mb-1">Occupancy</p>
                    <p className="text-2xl font-semibold text-[var(--trilogy-teal)]" data-testid="census-occupancy">
                      {formatPercentage(data.censusTotals.occupancyRate / 100)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-teal-200 dark:border-teal-800">
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--dashboard-muted)]">Occupied / Total</span>
                    <span className="font-medium">
                      {formatNumber(data.censusTotals.occupiedBeds)} / {formatNumber(data.censusTotals.totalBeds)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm mt-2">
                    <span className="text-[var(--dashboard-muted)]">Gap from Database</span>
                    <span className="font-medium text-amber-600">
                      {formatNumber(data.databaseTotals.totalBeds - data.censusTotals.totalBeds)} beds excluded
                    </span>
                  </div>
                </div>
              </div>

              {/* Service Line Breakdown */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--dashboard-muted)]">By Service Line</p>
                {data.serviceLineBreakdown.map((line) => (
                  <div key={line.serviceLine} className={`rounded-lg border p-3 ${serviceLineColors[line.serviceLine] || 'bg-gray-50 border-gray-200'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{line.serviceLine}</span>
                      <span className="text-sm font-semibold">{formatPercentage(line.censusOccupancyRate / 100)}</span>
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="opacity-80">Census Beds:</span>
                        <span className="font-medium">{formatNumber(line.censusBeds)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="opacity-80">Occupied:</span>
                        <span className="font-medium">{formatNumber(line.censusOccupied)}</span>
                      </div>
                      {line.serviceLine !== 'HC' && (
                        <div className="flex justify-between text-amber-600">
                          <span>B-Beds Excluded:</span>
                          <span className="font-medium">{formatNumber(line.bBeds)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </TooltipProvider>
  );
}