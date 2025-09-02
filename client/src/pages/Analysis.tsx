import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, DollarSign, Users, Target, AlertCircle } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from "recharts";

interface AnalysisData {
  revporData: Array<{
    month: string;
    actual: number;
    budgeted: number;
    competitor: number;
  }>;
  rateData: Array<{
    month: string;
    adr: number;
    budget: number;
    adjustment: number;
    variance: number;
  }>;
  occupancyData: Array<{
    serviceLine: string;
    actual: number;
    budgeted: number;
    trend: number;
  }>;
  remainderMetrics: {
    underpricedUnits: {
      count: number;
      monthlyImpact: number;
      details: Array<{
        unit: string;
        currentRate: number;
        optimalRate: number;
        gap: number;
      }>;
    };
    occupancyGap: {
      percentage: number;
      monthlyImpact: number;
      unitsNeeded: number;
    };
    collectionGap: {
      percentage: number;
      monthlyImpact: number;
    };
    totalOpportunity: number;
  };
  kpis: {
    currentRevPOR: number;
    revPORChange: number;
    currentADR: number;
    adrChange: number;
    currentOccupancy: number;
    occupancyChange: number;
    capturedRemainder: number;
    remainderChange: number;
  };
}

export default function Analysis() {
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("3M");

  // Fetch locations
  const { data: locations = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/portfolio/locations"],
  });

  // Fetch analysis data
  const { data: analysisData, isLoading } = useQuery<AnalysisData>({
    queryKey: ["/api/analysis", selectedLocation, selectedPeriod],
    queryFn: async () => {
      const params = new URLSearchParams({
        location: selectedLocation,
        period: selectedPeriod,
      });
      const response = await fetch(`/api/analysis?${params}`);
      if (!response.ok) throw new Error("Failed to fetch analysis data");
      return response.json();
    },
  });

  if (isLoading || !analysisData) {
    return (
      <div className="p-4 lg:p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const formatCurrency = (value: number) => `$${value.toLocaleString()}`;
  const formatPercentage = (value: number) => `${value.toFixed(1)}%`;

  return (
    <div className="p-4 lg:p-6 space-y-6">
      {/* Header with Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--trilogy-dark-blue)]">Modulo Analysis</h1>
          <p className="text-sm text-[var(--trilogy-grey)]">Capture the remainder — identify and quantify revenue opportunities</p>
        </div>
        <div className="flex gap-2">
          <Select value={selectedLocation} onValueChange={setSelectedLocation}>
            <SelectTrigger className="w-[180px]" data-testid="select-analysis-location">
              <SelectValue placeholder="Select location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {locations.map((loc) => (
                <SelectItem key={loc.id} value={loc.id}>
                  {loc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-[120px]" data-testid="select-analysis-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1M">1 Month</SelectItem>
              <SelectItem value="3M">3 Months</SelectItem>
              <SelectItem value="6M">6 Months</SelectItem>
              <SelectItem value="12M">12 Months</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Top Row - KPIs at a Glance */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--trilogy-grey)]">Current RevPOR</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold" data-testid="text-current-revpor">
                {formatCurrency(analysisData.kpis.currentRevPOR)}
              </span>
              <div className={`flex items-center text-sm ${analysisData.kpis.revPORChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {analysisData.kpis.revPORChange >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                <span className="ml-1">{formatPercentage(Math.abs(analysisData.kpis.revPORChange))}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--trilogy-grey)]">Average Daily Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold" data-testid="text-current-adr">
                {formatCurrency(analysisData.kpis.currentADR)}
              </span>
              <div className={`flex items-center text-sm ${analysisData.kpis.adrChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {analysisData.kpis.adrChange >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                <span className="ml-1">{formatPercentage(Math.abs(analysisData.kpis.adrChange))}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--trilogy-grey)]">Occupancy Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold" data-testid="text-current-occupancy">
                {formatPercentage(analysisData.kpis.currentOccupancy)}
              </span>
              <div className={`flex items-center text-sm ${analysisData.kpis.occupancyChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {analysisData.kpis.occupancyChange >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                <span className="ml-1">{formatPercentage(Math.abs(analysisData.kpis.occupancyChange))} pts</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[var(--trilogy-teal)] bg-[var(--trilogy-teal)]/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--trilogy-teal)]">Captured Remainder</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold text-[var(--trilogy-teal)]" data-testid="text-captured-remainder">
                {formatCurrency(analysisData.kpis.capturedRemainder)}
              </span>
              <div className={`flex items-center text-sm ${analysisData.kpis.remainderChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {analysisData.kpis.remainderChange >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                <span className="ml-1">{formatPercentage(Math.abs(analysisData.kpis.remainderChange))}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Middle Section - Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* RevPOR Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">RevPOR Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={analysisData.revporData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: any) => formatCurrency(value)} />
                <Legend />
                <Line type="monotone" dataKey="actual" stroke="var(--trilogy-dark-blue)" strokeWidth={2} name="Actual" />
                <Line type="monotone" dataKey="budgeted" stroke="var(--trilogy-teal)" strokeWidth={2} strokeDasharray="5 5" name="Budget" />
                <Line type="monotone" dataKey="competitor" stroke="var(--trilogy-grey)" strokeWidth={1} name="Competitor" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Rate Analysis Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Rate Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={analysisData.rateData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: any) => formatCurrency(value)} />
                <Legend />
                <Area type="monotone" dataKey="adr" stackId="1" stroke="var(--trilogy-turquoise)" fill="var(--trilogy-turquoise)" fillOpacity={0.6} name="ADR" />
                <Area type="monotone" dataKey="variance" stackId="2" stroke="var(--trilogy-warning)" fill="var(--trilogy-warning)" fillOpacity={0.4} name="Variance" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Occupancy by Service Line */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Occupancy by Service Line</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={analysisData.occupancyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="serviceLine" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: any) => formatPercentage(value)} />
                <Legend />
                <Bar dataKey="actual" fill="var(--trilogy-dark-blue)" name="Actual %" />
                <Bar dataKey="budgeted" fill="var(--trilogy-teal)" fillOpacity={0.5} name="Budget %" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Section - Remainder/Opportunity Widget (Modulo's Signature) */}
      <Card className="border-2 border-[var(--trilogy-teal)]">
        <CardHeader className="bg-[var(--trilogy-teal)]/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-[var(--trilogy-teal)]" />
              <CardTitle className="text-xl text-[var(--trilogy-dark-blue)]">Remainder / Opportunity Capture</CardTitle>
            </div>
            <div className="text-2xl font-bold text-[var(--trilogy-teal)]">
              {formatCurrency(analysisData.remainderMetrics.totalOpportunity)}/month
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Underpriced Units */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-[var(--trilogy-warning)]" />
                <h3 className="font-semibold text-[var(--trilogy-dark-blue)]">Underpriced Units</h3>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-sm text-gray-600">Units below optimal rate:</span>
                  <span className="font-bold text-lg">{analysisData.remainderMetrics.underpricedUnits.count}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-sm text-gray-600">Monthly impact:</span>
                  <span className="font-bold text-lg text-[var(--trilogy-warning)]">
                    +{formatCurrency(analysisData.remainderMetrics.underpricedUnits.monthlyImpact)}
                  </span>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <p className="text-xs text-gray-500">
                    Top opportunities: Units with {formatCurrency(50)}+ monthly gap
                  </p>
                </div>
              </div>
            </div>

            {/* Occupancy Gap */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[var(--trilogy-turquoise)]" />
                <h3 className="font-semibold text-[var(--trilogy-dark-blue)]">Occupancy Gap</h3>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-sm text-gray-600">Below target by:</span>
                  <span className="font-bold text-lg">{formatPercentage(analysisData.remainderMetrics.occupancyGap.percentage)}</span>
                </div>
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-sm text-gray-600">Units needed:</span>
                  <span className="font-bold text-lg">{analysisData.remainderMetrics.occupancyGap.unitsNeeded}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-sm text-gray-600">Monthly impact:</span>
                  <span className="font-bold text-lg text-[var(--trilogy-turquoise)]">
                    +{formatCurrency(analysisData.remainderMetrics.occupancyGap.monthlyImpact)}
                  </span>
                </div>
              </div>
            </div>

            {/* Collection Gap */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-[var(--trilogy-error)]" />
                <h3 className="font-semibold text-[var(--trilogy-dark-blue)]">Community Fee Collection</h3>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-sm text-gray-600">Collection rate gap:</span>
                  <span className="font-bold text-lg">{formatPercentage(analysisData.remainderMetrics.collectionGap.percentage)}</span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-sm text-gray-600">Monthly impact:</span>
                  <span className="font-bold text-lg text-[var(--trilogy-error)]">
                    +{formatCurrency(analysisData.remainderMetrics.collectionGap.monthlyImpact)}
                  </span>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <p className="text-xs text-gray-500">
                    Target: 95%+ collection rate
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Action Summary */}
          <div className="mt-6 p-4 bg-[var(--trilogy-teal)]/5 rounded-lg border border-[var(--trilogy-teal)]/20">
            <div className="flex items-start gap-3">
              <Target className="h-5 w-5 text-[var(--trilogy-teal)] mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-[var(--trilogy-dark-blue)] mb-1">
                  Closing these gaps = +{formatCurrency(analysisData.remainderMetrics.totalOpportunity)}/month
                </p>
                <p className="text-sm text-gray-600">
                  Focus on the highest-impact opportunities first: price optimization for undervalued units, 
                  targeted marketing for occupancy improvement, and enhanced collection processes.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}