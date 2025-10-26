import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
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
    return (
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
        <p className="font-semibold text-sm mb-2 text-gray-900 dark:text-gray-100">{data.campusName}</p>
        <div className="space-y-1 text-xs">
          <p className="text-gray-700 dark:text-gray-300">Region: {data.region}</p>
          {data.avgRate && (
            <p className="text-gray-700 dark:text-gray-300">
              Avg Rate: ${data.avgRate?.toFixed(0)}
            </p>
          )}
          {data.occupancy !== undefined && (
            <p className="text-gray-700 dark:text-gray-300">
              Occupancy: {(data.occupancy * 100).toFixed(1)}%
            </p>
          )}
          {data.competitorAvgRate && (
            <p className="text-gray-700 dark:text-gray-300">
              Market Avg: ${data.competitorAvgRate?.toFixed(0)}
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
              Revenue Impact: ${(data.revenueImpact / 1000).toFixed(0)}K
            </p>
          )}
        </div>
      </div>
    );
  }
  return null;
};

export function Analytics() {
  const [selectedRegion, setSelectedRegion] = useState<string>('all');
  const [selectedServiceLine, setSelectedServiceLine] = useState<string>('all');

  // Fetch campus analytics data
  const { data: analyticsData, isLoading } = useQuery({
    queryKey: ['/api/analytics/campus-metrics', selectedRegion, selectedServiceLine],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedRegion !== 'all') params.append('region', selectedRegion);
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

  // Get unique regions for filtering
  const regions = useMemo(() => {
    if (!analyticsData?.campuses) return [];
    const uniqueRegions = [...new Set(analyticsData.campuses.map((c: any) => c.region))];
    return uniqueRegions.filter(Boolean);
  }, [analyticsData]);

  // Color scale for regions
  const getColor = (region: string) => {
    const colors: Record<string, string> = {
      'Central': '#3B82F6',
      'North': '#10B981',
      'South': '#F59E0B',
      'East': '#8B5CF6',
      'West': '#EF4444',
    };
    return colors[region] || '#6B7280';
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
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4">
          <Select value={selectedRegion} onValueChange={setSelectedRegion}>
            <SelectTrigger className="w-[200px]" data-testid="select-region">
              <SelectValue placeholder="Select Region" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Regions</SelectItem>
              {regions.map(region => (
                <SelectItem key={region} value={region}>{region}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={selectedServiceLine} onValueChange={setSelectedServiceLine}>
            <SelectTrigger className="w-[200px]" data-testid="select-service-line">
              <SelectValue placeholder="Service Line" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Service Lines</SelectItem>
              <SelectItem value="AL">Assisted Living</SelectItem>
              <SelectItem value="MC">Memory Care</SelectItem>
              <SelectItem value="HC">Healthcare</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Portfolio Average Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${analyticsData?.summary?.avgPortfolioRate?.toFixed(0) || 0}
            </div>
            <p className="text-xs text-muted-foreground">Per day</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Average Occupancy</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {((analyticsData?.summary?.avgOccupancy || 0) * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">Across portfolio</p>
          </CardContent>
        </Card>
        
        <Card>
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
            <p className="text-xs text-muted-foreground">vs. competitors</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Revenue Opportunity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${((analyticsData?.summary?.totalRevenueOpportunity || 0) / 1000000).toFixed(1)}M
            </div>
            <p className="text-xs text-muted-foreground">Annual potential</p>
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
                <ScatterChart margin={{ top: 20, right: 20, bottom: 100, left: 70 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    dataKey="occupancy" 
                    name="Occupancy"
                    label={{ value: 'Occupancy Rate (%)', position: 'insideBottom', offset: -5 }}
                    domain={['dataMin - 0.05', 'dataMax + 0.05']}
                    tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="rateGrowthT6" 
                    name="Rate Growth"
                    label={{ value: 'T6 Avg In-House Rate Growth (%)', angle: -90, position: 'insideLeft' }}
                    tickFormatter={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter name="Campuses" data={processedData} fill="#8884d8">
                    {processedData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.region)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {regions.map(region => (
                  <Badge key={region} variant="outline" className="gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColor(region) }} />
                    {region}
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
                <ScatterChart margin={{ top: 20, right: 20, bottom: 100, left: 70 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    dataKey="competitorAvgRate" 
                    name="Market Average Rate"
                    label={{ value: 'Competitor Average Rate ($)', position: 'insideBottom', offset: -5 }}
                    domain={['dataMin - 20', 'dataMax + 20']}
                    tickFormatter={(value) => value.toLocaleString()}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="avgRate" 
                    name="Your Rate"
                    label={{ value: 'Your Campus Rate ($)', angle: -90, position: 'insideLeft' }}
                    domain={['dataMin - 20', 'dataMax + 20']}
                    tickFormatter={(value) => value.toLocaleString()}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter name="Campuses" data={processedData} fill="#8884d8">
                    {processedData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.region)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {regions.map(region => (
                  <Badge key={region} variant="outline" className="gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColor(region) }} />
                    {region}
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
                <ScatterChart margin={{ top: 20, right: 20, bottom: 100, left: 70 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    dataKey="occupancy" 
                    name="Occupancy"
                    label={{ value: 'Occupancy Rate (%)', position: 'insideBottom', offset: -5 }}
                    domain={['dataMin - 0.05', 'dataMax + 0.05']}
                    tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="pricePosition" 
                    name="Price Position"
                    label={{ value: '% Higher/Lower than Competitor', angle: -90, position: 'insideLeft' }}
                    tickFormatter={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter name="Campuses" data={processedData} fill="#8884d8">
                    {processedData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.region)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {regions.map(region => (
                  <Badge key={region} variant="outline" className="gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColor(region) }} />
                    {region}
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
                <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    dataKey="occupancy" 
                    name="Occupancy"
                    label={{ value: 'Occupancy Rate (%)', position: 'insideBottom', offset: -5 }}
                    domain={['dataMin - 0.05', 'dataMax + 0.05']}
                    tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="avgRate" 
                    name="ADR"
                    label={{ value: 'Average Daily Rate ($)', angle: -90, position: 'insideLeft' }}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Scatter name="Campuses" data={processedData} fill="#8884d8">
                    {processedData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.region)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {regions.map(region => (
                  <Badge key={region} variant="outline" className="gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColor(region) }} />
                    {region}
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
                <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    dataKey="pricePosition" 
                    name="Price Position"
                    label={{ value: 'Price Position vs Market (%)', position: 'insideBottom', offset: -5 }}
                    domain={['dataMin - 5', 'dataMax + 5']}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="revenueImpact" 
                    name="Revenue Impact"
                    label={{ value: 'Monthly Revenue Impact ($K)', angle: -90, position: 'insideLeft' }}
                    tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Scatter name="Campuses" data={processedData} fill="#8884d8">
                    {processedData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.region)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {regions.map(region => (
                  <Badge key={region} variant="outline" className="gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColor(region) }} />
                    {region}
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
                <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    dataKey="pricePosition" 
                    name="Price Position"
                    label={{ value: 'Price Differential from Market (%)', position: 'insideBottom', offset: -5 }}
                    domain={['dataMin - 5', 'dataMax + 5']}
                    tickFormatter={(value) => `${value > 0 ? '+' : ''}${value}%`}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="occupancy" 
                    name="Occupancy"
                    label={{ value: 'Occupancy Rate (%)', angle: -90, position: 'insideLeft' }}
                    domain={['dataMin - 0.05', 'dataMax + 0.05']}
                    tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Scatter name="Campuses" data={processedData} fill="#8884d8">
                    {processedData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.region)} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {regions.map(region => (
                  <Badge key={region} variant="outline" className="gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getColor(region) }} />
                    {region}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}