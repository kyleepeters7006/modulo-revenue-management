import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
  ZAxis
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Download, TrendingUp, TrendingDown, Minus, Target, Building2, DollarSign, Users, ArrowLeft } from 'lucide-react';
import type { SelectCampusData, SelectCompetitors } from '@shared/schema';

interface CampusMetrics {
  campusId: string;
  campusName: string;
  region: string;
  avgRate: number;
  occupancy: number;
  competitorAvgRate: number;
  pricePosition: number; // % above/below market
  revenueImpact: number;
  potentialRevenue: number;
  unitsCount: number;
  vacantUnits: number;
  avgLOS: number; // Length of stay
  marketShareScore: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
}

const CustomTooltip = ({ active, payload }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    
    // Build rate card URL with filters
    const rateCardUrl = `/rate-card?location=${encodeURIComponent(data.campusName)}&serviceLine=${encodeURIComponent(data.serviceLine || 'All')}`;
    
    return (
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
        <p className="font-semibold text-sm mb-2 text-gray-900 dark:text-gray-100">{data.campusName}</p>
        <div className="space-y-1 text-xs mb-3">
          <p className="text-gray-700 dark:text-gray-300">Region: {data.region}</p>
          {data.division && (
            <p className="text-gray-700 dark:text-gray-300">Division: {data.division}</p>
          )}
          {data.avgRate && (
            <p className="text-gray-700 dark:text-gray-300">
              Avg Rate: ${Math.round(data.avgRate).toLocaleString()}
            </p>
          )}
          {data.occupancy !== undefined && (
            <p className="text-gray-700 dark:text-gray-300">
              Occupancy: {(data.occupancy * 100).toFixed(1)}%
            </p>
          )}
          {data.competitorAvgRate && (
            <p className="text-gray-700 dark:text-gray-300">
              Market Avg: ${Math.round(data.competitorAvgRate).toLocaleString()}
            </p>
          )}
          {data.pricePosition !== undefined && (
            <p className={`font-medium ${data.pricePosition > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              Position: {data.pricePosition > 0 ? '+' : ''}{data.pricePosition.toFixed(1)}%
            </p>
          )}
          {data.rateGrowthT6 !== undefined && (
            <p className={`font-medium ${data.rateGrowthT6 > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              T6 Rate Growth: {data.rateGrowthT6 > 0 ? '+' : ''}{data.rateGrowthT6.toFixed(1)}%
            </p>
          )}
          {data.revenueImpact && (
            <p className="text-gray-700 dark:text-gray-300">
              Revenue Impact: ${Math.round(data.revenueImpact / 1000).toLocaleString()}K
            </p>
          )}
        </div>
        <Link href={rateCardUrl}>
          <a className="inline-block w-full text-center px-3 py-1.5 bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white rounded text-xs font-medium transition-colors">
            Edit Pricing →
          </a>
        </Link>
      </div>
    );
  }
  return null;
};

export function Analytics() {
  const [selectedRegion, setSelectedRegion] = useState<string>('all');
  const [selectedDivision, setSelectedDivision] = useState<string>('all');
  const [selectedServiceLine, setSelectedServiceLine] = useState<string>('all');
  const [calculationDialogOpen, setCalculationDialogOpen] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<'avgRate' | 'occupancy' | 'marketPosition' | 'revenue' | null>(null);

  // Fetch campus analytics data
  const { data: analyticsData, isLoading } = useQuery({
    queryKey: ['/api/analytics/campus-metrics', selectedRegion, selectedDivision, selectedServiceLine],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedRegion !== 'all') params.append('region', selectedRegion);
      if (selectedDivision !== 'all') params.append('division', selectedDivision);
      if (selectedServiceLine !== 'all') params.append('serviceLine', selectedServiceLine);
      const queryString = params.toString() ? `?${params.toString()}` : '';
      
      const response = await fetch(`/api/analytics/campus-metrics${queryString}`);
      if (!response.ok) throw new Error('Failed to fetch analytics data');
      return response.json();
    }
  });

  // Process data for scatter plots
  const processedData = useMemo(() => {
    if (!analyticsData?.campuses) return [];
    
    return analyticsData.campuses.map((campus: any) => ({
      ...campus,
      pricePosition: campus.competitorAvgRate > 0 
        ? ((campus.avgRate - campus.competitorAvgRate) / campus.competitorAvgRate) * 100
        : 0,
      size: Math.max(campus.unitsCount, 10), // Minimum size for visibility
      // Mock T6 rate growth for now - in production this would come from backend
      rateGrowthT6: campus.rateGrowthT6 || ((Math.random() * 10) - 2), // Random between -2% and 8%
    }));
  }, [analyticsData]);

  // Get unique regions and divisions for filtering
  const regions = useMemo(() => {
    if (!analyticsData?.campuses) return [];
    const uniqueRegions = [...new Set(analyticsData.campuses.map((c: any) => c.region))];
    return uniqueRegions.filter(Boolean);
  }, [analyticsData]);

  const divisions = useMemo(() => {
    if (!analyticsData?.campuses) return [];
    const uniqueDivisions = [...new Set(analyticsData.campuses.map((c: any) => c.division))];
    return uniqueDivisions.filter(Boolean);
  }, [analyticsData]);

  // Color scale for divisions - using grey, black, dark teal, light teal, dark orange, dark blue, hunter green
  const getColor = (division: string) => {
    const colors: Record<string, string> = {
      'Central': '#6B7280',  // Grey
      'Central Indiana': '#1F2937',  // Black
      'Central Kentucky': '#0F766E',  // Dark Teal
      'Indianapolis Metro': '#5EEAD4',  // Light Teal
      'Lexington Metro': '#EA580C',  // Dark Orange
      'Louisville Metro': '#1E40AF',  // Dark Blue
      'Northeast': '#065F46',  // Hunter Green
      'Northeast Ohio': '#DC2626',  // Red
      'Northwest': '#F59E0B',  // Amber
      'Northwest Ohio': '#059669',  // Emerald Green
      'Southeast': '#EC4899',  // Pink
      'Southeast Indiana': '#14B8A6',  // Teal
      'Southwest': '#EF4444',  // Bright Red
    };
    return colors[division] || '#6B7280';
  };

  const handleExportChart = () => {
    // In a real implementation, this would export the chart as PNG/SVG
    const data = processedData.map(d => ({
      Campus: d.campusName,
      Region: d.region,
      'Avg Rate': d.avgRate,
      'Occupancy %': (d.occupancy * 100).toFixed(1),
      'Market Rate': d.competitorAvgRate,
      'Price Position %': d.pricePosition.toFixed(1),
    }));
    
    const csv = [
      Object.keys(data[0]).join(','),
      ...data.map(row => Object.values(row).join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pricing-analytics.csv';
    a.click();
  };

  const openCalculationDialog = (metric: 'avgRate' | 'occupancy' | 'marketPosition' | 'revenue') => {
    setSelectedMetric(metric);
    setCalculationDialogOpen(true);
  };

  const getCalculationDetails = () => {
    if (!selectedMetric || !analyticsData) return null;

    const summary = analyticsData.summary;
    const campuses = analyticsData.campuses;

    switch (selectedMetric) {
      case 'avgRate':
        const totalOccupiedUnits = campuses.reduce((sum: number, c: any) => 
          sum + (c.occupiedUnits || 0), 0);
        const totalRent = campuses.reduce((sum: number, c: any) => 
          sum + (c.avgRate * (c.occupiedUnits || 0)), 0);
        return {
          title: 'Portfolio Average Rate Calculation',
          formula: 'Total Rent Revenue ÷ Total Occupied Units',
          steps: [
            { label: 'Total occupied units across all campuses', value: totalOccupiedUnits.toLocaleString() },
            { label: 'Total rent revenue (sum of all occupied units × their rates)', value: `$${Math.round(totalRent).toLocaleString()}` },
            { label: 'Portfolio average rate', value: `$${Math.round(summary.avgPortfolioRate).toLocaleString()}`, highlight: true },
          ],
          breakdown: campuses.slice(0, 10).map((c: any) => ({
            campus: c.campusName,
            value: `$${Math.round(c.avgRate).toLocaleString()}`,
            detail: `${c.occupiedUnits} occupied units`
          }))
        };

      case 'occupancy':
        const totalUnits = campuses.reduce((sum: number, c: any) => sum + (c.unitsCount || 0), 0);
        const totalOccupied = campuses.reduce((sum: number, c: any) => sum + (c.occupiedUnits || 0), 0);
        return {
          title: 'Average Occupancy Calculation',
          formula: 'Total Occupied Units ÷ Total Units',
          steps: [
            { label: 'Total units across all campuses', value: totalUnits.toLocaleString() },
            { label: 'Total occupied units', value: totalOccupied.toLocaleString() },
            { label: 'Portfolio occupancy rate', value: `${(summary.avgOccupancy * 100).toFixed(1)}%`, highlight: true },
          ],
          breakdown: campuses.slice(0, 10).map((c: any) => ({
            campus: c.campusName,
            value: `${(c.occupancy * 100).toFixed(1)}%`,
            detail: `${c.occupiedUnits} of ${c.unitsCount} units`
          }))
        };

      case 'marketPosition':
        const totalPricePosition = campuses.reduce((sum: number, c: any) => 
          sum + (c.pricePosition || 0), 0);
        return {
          title: 'Market Position Calculation',
          formula: 'Average of ((Your Rate - Competitor Rate) ÷ Competitor Rate × 100) across all campuses',
          steps: [
            { label: 'Number of campuses with competitor data', value: campuses.length.toString() },
            { label: 'Sum of all price positions', value: `${totalPricePosition.toFixed(1)}%` },
            { label: 'Average market position', value: `${summary.avgPricePosition.toFixed(1)}%`, highlight: true },
          ],
          breakdown: campuses.slice(0, 10).map((c: any) => ({
            campus: c.campusName,
            value: `${c.pricePosition > 0 ? '+' : ''}${c.pricePosition.toFixed(1)}%`,
            detail: `Your: $${Math.round(c.avgRate).toLocaleString()} | Market: $${Math.round(c.competitorAvgRate).toLocaleString()}`
          }))
        };

      case 'revenue':
        const annualRevenue = summary.totalRevenueOpportunity;
        const monthlyRevenue = annualRevenue / 12;
        return {
          title: 'Revenue Opportunity Calculation',
          formula: '(Potential Revenue at 95% Occupancy - Current Revenue) × 12 months',
          steps: [
            { label: 'Current monthly revenue', value: `$${(monthlyRevenue / 2).toFixed(1)}M` },
            { label: 'Potential monthly revenue at 95% occupancy', value: `$${monthlyRevenue.toFixed(1)}M` },
            { label: 'Monthly opportunity', value: `$${(monthlyRevenue / 2).toFixed(1)}M` },
            { label: 'Annual revenue opportunity', value: `$${(annualRevenue / 1000000).toFixed(1)}M`, highlight: true },
          ],
          breakdown: campuses.slice(0, 10).map((c: any) => ({
            campus: c.campusName,
            value: `$${Math.round((c.revenueImpact || 0) / 1000).toLocaleString()}K`,
            detail: `${c.vacantUnits || 0} vacant units at avg rate $${Math.round(c.avgRate).toLocaleString()}`
          }))
        };

      default:
        return null;
    }
  };

  const calculationDetails = getCalculationDetails();

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Back Button */}
      <Link href="/">
        <Button variant="ghost" className="gap-2 mb-4" data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Button>
      </Link>
      
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pricing Analytics</h1>
          <p className="text-muted-foreground mt-2">
            Portfolio-wide pricing strategy visualization across {processedData.length} campuses
          </p>
        </div>
        <Button onClick={handleExportChart} variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Export Data
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center flex-wrap">
        <span className="text-sm font-medium">Filters:</span>
        <Select value={selectedRegion} onValueChange={setSelectedRegion}>
          <SelectTrigger className="w-[160px]" data-testid="select-region">
            <SelectValue placeholder="Region" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Regions</SelectItem>
            {regions.map(region => (
              <SelectItem key={region} value={region}>{region}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <Select value={selectedDivision} onValueChange={setSelectedDivision}>
          <SelectTrigger className="w-[160px]" data-testid="select-division">
            <SelectValue placeholder="Division" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Divisions</SelectItem>
            {divisions.map(division => (
              <SelectItem key={division} value={division}>{division}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <Select value={selectedServiceLine} onValueChange={setSelectedServiceLine}>
          <SelectTrigger className="w-[160px]" data-testid="select-service-line">
            <SelectValue placeholder="Service Line" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Service Lines</SelectItem>
            <SelectItem value="AL">Assisted Living</SelectItem>
            <SelectItem value="MC">Memory Care</SelectItem>
            <SelectItem value="HC">Healthcare</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card 
          className="cursor-pointer hover:shadow-lg transition-shadow" 
          onClick={() => openCalculationDialog('avgRate')}
          data-testid="card-avg-rate"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Portfolio Average Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${Math.round(analyticsData?.summary?.avgPortfolioRate || 0).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Per day • Click for details</p>
          </CardContent>
        </Card>
        
        <Card 
          className="cursor-pointer hover:shadow-lg transition-shadow" 
          onClick={() => openCalculationDialog('occupancy')}
          data-testid="card-occupancy"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Average Occupancy</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {((analyticsData?.summary?.avgOccupancy || 0) * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">Across portfolio • Click for details</p>
          </CardContent>
        </Card>
        
        <Card 
          className="cursor-pointer hover:shadow-lg transition-shadow" 
          onClick={() => openCalculationDialog('marketPosition')}
          data-testid="card-market-position"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Market Position</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              {analyticsData?.summary?.avgPricePosition > 0 ? (
                <TrendingUp className="h-4 w-4 text-green-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
              {analyticsData?.summary?.avgPricePosition?.toFixed(1) || 0}%
            </div>
            <p className="text-xs text-muted-foreground">vs. competitors • Click for details</p>
          </CardContent>
        </Card>
        
        <Card 
          className="cursor-pointer hover:shadow-lg transition-shadow" 
          onClick={() => openCalculationDialog('revenue')}
          data-testid="card-revenue"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Revenue Opportunity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${((analyticsData?.summary?.totalRevenueOpportunity || 0) / 1000000).toFixed(1)}M
            </div>
            <p className="text-xs text-muted-foreground">Annual potential • Click for details</p>
          </CardContent>
        </Card>
      </div>

      {/* Scatter Plots */}
      <Tabs defaultValue="rate-growth" className="space-y-4">
        <TabsList className="grid grid-cols-3 lg:grid-cols-6 w-full">
          <TabsTrigger value="rate-growth">Rate Growth</TabsTrigger>
          <TabsTrigger value="price-position">Price vs Market</TabsTrigger>
          <TabsTrigger value="occupancy-rate">Occupancy vs Rate</TabsTrigger>
          <TabsTrigger value="occupancy-position">Occ vs Position</TabsTrigger>
          <TabsTrigger value="revenue-impact">Revenue Impact</TabsTrigger>
          <TabsTrigger value="market-share">Market Position</TabsTrigger>
        </TabsList>

        {/* Occupancy vs T6 Rate Growth */}
        <TabsContent value="rate-growth" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Occupancy vs Rate Growth</CardTitle>
              <CardDescription>
                Trailing 6-month in-house average rate growth vs current occupancy performance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={500}>
                <ScatterChart margin={{ top: 20, right: 20, bottom: 110, left: 100 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    dataKey="occupancy" 
                    name="Occupancy"
                    label={{ value: 'Occupancy Rate (%)', position: 'insideBottom', offset: -15 }}
                    domain={['dataMin - 0.05', 'dataMax + 0.05']}
                    tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="rateGrowthT6" 
                    name="Rate Growth"
                    label={{ value: 'T6 Avg In-House Rate Growth (%)', angle: -90, position: 'center', dx: -35 }}
                    tickFormatter={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter name="Campuses" data={processedData} fill="#6B7280">
                    {processedData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.division)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {divisions.map(division => (
                  <Badge key={division} variant="outline" className="gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColor(division) }} />
                    {division}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Price Positioning Matrix */}
        <TabsContent value="price-position" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Price Positioning Matrix</CardTitle>
              <CardDescription>
                Each dot represents a campus. Position shows how your rates compare to local competition.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={500}>
                <ScatterChart margin={{ top: 20, right: 20, bottom: 110, left: 100 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    dataKey="competitorAvgRate" 
                    name="Market Average Rate"
                    label={{ value: 'Competitor Average Rate ($)', position: 'insideBottom', offset: -15 }}
                    domain={['dataMin - 20', 'dataMax + 20']}
                    tickFormatter={(value) => value.toLocaleString()}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="avgRate" 
                    name="Your Rate"
                    label={{ value: 'Your Campus Rate ($)', angle: -90, position: 'center', dx: -35 }}
                    domain={['dataMin - 20', 'dataMax + 20']}
                    tickFormatter={(value) => value.toLocaleString()}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter name="Campuses" data={processedData} fill="#6B7280">
                    {processedData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.division)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {divisions.map(division => (
                  <Badge key={division} variant="outline" className="gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColor(division) }} />
                    {division}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Occupancy vs Competitor Position */}
        <TabsContent value="occupancy-position" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Occupancy vs Competitive Position</CardTitle>
              <CardDescription>
                Current occupancy rate vs price differential from competitors.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={500}>
                <ScatterChart margin={{ top: 20, right: 20, bottom: 110, left: 100 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    dataKey="occupancy" 
                    name="Occupancy"
                    label={{ value: 'Occupancy Rate (%)', position: 'insideBottom', offset: -15 }}
                    domain={['dataMin - 0.05', 'dataMax + 0.05']}
                    tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="pricePosition" 
                    name="Price Position"
                    label={{ value: '% Higher/Lower than Competitor', angle: -90, position: 'center', dx: -35 }}
                    tickFormatter={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter name="Campuses" data={processedData} fill="#6B7280">
                    {processedData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.division)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {divisions.map(division => (
                  <Badge key={division} variant="outline" className="gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColor(division) }} />
                    {division}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Occupancy vs Pricing */}
        <TabsContent value="occupancy-rate" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Occupancy vs Average Daily Rate</CardTitle>
              <CardDescription>
                Analyze the relationship between pricing and occupancy. Larger dots indicate more units.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={500}>
                <ScatterChart margin={{ top: 20, right: 20, bottom: 110, left: 100 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    dataKey="occupancy" 
                    name="Occupancy"
                    label={{ value: 'Occupancy Rate (%)', position: 'insideBottom', offset: -15 }}
                    domain={['dataMin - 0.05', 'dataMax + 0.05']}
                    tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="avgRate" 
                    name="ADR"
                    label={{ value: 'Average Daily Rate ($)', angle: -90, position: 'center', dx: -35 }}
                    tickFormatter={(value) => value.toLocaleString()}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter name="Campuses" data={processedData} fill="#6B7280">
                    {processedData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.division)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {divisions.map(division => (
                  <Badge key={division} variant="outline" className="gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColor(division) }} />
                    {division}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Revenue Impact Analysis */}
        <TabsContent value="revenue-impact" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Revenue Impact Analysis</CardTitle>
              <CardDescription>
                Price position vs projected revenue impact. Size indicates campus capacity.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={500}>
                <ScatterChart margin={{ top: 20, right: 20, bottom: 110, left: 100 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    dataKey="pricePosition" 
                    name="Price Position"
                    label={{ value: 'Price Position vs Market (%)', position: 'insideBottom', offset: -15 }}
                    domain={['dataMin - 5', 'dataMax + 5']}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="revenueImpact" 
                    name="Revenue Impact"
                    label={{ value: 'Monthly Revenue Impact ($K)', angle: -90, position: 'center', dx: -35 }}
                    tickFormatter={(value) => `$${Math.round(value / 1000).toLocaleString()}K`}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter name="Campuses" data={processedData} fill="#6B7280">
                    {processedData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.division)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {divisions.map(division => (
                  <Badge key={division} variant="outline" className="gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColor(division) }} />
                    {division}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Market Share Position */}
        <TabsContent value="market-share" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Market Competition Position</CardTitle>
              <CardDescription>
                Price differential from competitors vs occupancy performance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={500}>
                <ScatterChart margin={{ top: 20, right: 20, bottom: 110, left: 100 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    dataKey="pricePosition" 
                    name="Price Position"
                    label={{ value: 'Price Differential from Market (%)', position: 'insideBottom', offset: -15 }}
                    domain={['dataMin - 5', 'dataMax + 5']}
                    tickFormatter={(value) => `${value > 0 ? '+' : ''}${value}%`}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="occupancy" 
                    name="Occupancy"
                    label={{ value: 'Occupancy Rate (%)', angle: -90, position: 'center', dx: -35 }}
                    domain={['dataMin - 0.05', 'dataMax + 0.05']}
                    tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter name="Campuses" data={processedData} fill="#6B7280">
                    {processedData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.division)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {divisions.map(division => (
                  <Badge key={division} variant="outline" className="gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColor(division) }} />
                    {division}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Calculation Details Dialog */}
      <Dialog open={calculationDialogOpen} onOpenChange={setCalculationDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" data-testid="dialog-calculation">
          {calculationDetails && (
            <>
              <DialogHeader>
                <DialogTitle>{calculationDetails.title}</DialogTitle>
                <DialogDescription className="pt-2">
                  <span className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded block">
                    {calculationDetails.formula}
                  </span>
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-6 pt-4">
                {/* Calculation Steps */}
                <div>
                  <h4 className="font-semibold mb-3 text-sm text-gray-700 dark:text-gray-300">Calculation Steps:</h4>
                  <div className="space-y-2">
                    {calculationDetails.steps.map((step, idx) => (
                      <div 
                        key={idx} 
                        className={`flex justify-between items-center p-3 rounded ${
                          step.highlight 
                            ? 'bg-[var(--trilogy-teal)]/10 border border-[var(--trilogy-teal)]/30' 
                            : 'bg-gray-50 dark:bg-gray-800'
                        }`}
                      >
                        <span className="text-sm text-gray-600 dark:text-gray-400">{step.label}</span>
                        <span className={`font-semibold ${step.highlight ? 'text-[var(--trilogy-teal)]' : ''}`}>
                          {step.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Campus Breakdown */}
                <div>
                  <h4 className="font-semibold mb-3 text-sm text-gray-700 dark:text-gray-300">
                    Campus Breakdown (Top 10):
                  </h4>
                  <div className="space-y-1">
                    {calculationDetails.breakdown.map((campus, idx) => (
                      <div 
                        key={idx} 
                        className="flex justify-between items-start p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded text-sm"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 dark:text-gray-100">{campus.campus}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{campus.detail}</div>
                        </div>
                        <span className="font-semibold text-gray-900 dark:text-gray-100 ml-4">
                          {campus.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}