import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
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

interface ProcessedCampusData {
  campusId: string;
  campusName: string;
  region: string;
  division: string;
  avgRate: number;
  occupancy: number;
  competitorAvgRate: number;
  pricePosition: number;
  revenueImpact: number;
  potentialRevenue: number;
  unitsCount: number;
  vacantUnits: number;
  occupiedUnits: number;
  avgLOS: number;
  marketShareScore: number;
  size: number;
  rateGrowthT6: number;
  avgHcDailyRate?: number;
  avgSeniorHousingMonthlyRate?: number;
  serviceLine?: string;
}

interface ExportRow {
  Campus: string;
  Region: string;
  'Avg Rate': number;
  'Occupancy %': string;
  'Market Rate': number;
  'Price Position %': string;
}

interface BreakdownItem {
  campus: string;
  value: string;
  detail: string;
}

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

const CustomTooltip = ({ active, payload, pinnedData }: CustomTooltipProps & { pinnedData?: any }) => {
  // Show pinned tooltip data if available, otherwise show hover data
  const data = pinnedData || (active && payload && payload.length ? payload[0].payload : null);
  
  if (data) {
    // Build rate card URL with filters
    const rateCardUrl = `/rate-card?location=${encodeURIComponent(data.campusName)}&serviceLine=${encodeURIComponent(data.serviceLine || 'All')}`;
    
    return (
      <div style={{ pointerEvents: 'auto', padding: '20px' }}>
        <div className="bg-[var(--dashboard-surface)] p-4 rounded-lg shadow-lg border border-[var(--dashboard-border)]">
          <p className="font-semibold text-sm mb-2 text-[var(--dashboard-text)]">{data.campusName}</p>
          <div className="space-y-1 text-xs mb-3">
            <p className="text-[var(--dashboard-muted)]">Region: {data.region}</p>
            {data.division && (
              <p className="text-[var(--dashboard-muted)]">Division: {data.division}</p>
            )}
            {/* Show rates by service line type instead of blended average */}
            {data.avgHcDailyRate > 0 && (
              <p className="text-[var(--dashboard-text)]">
                HC Daily Rate: ${Math.round(data.avgHcDailyRate).toLocaleString()}/day
              </p>
            )}
            {data.avgSeniorHousingMonthlyRate > 0 && (
              <p className="text-[var(--dashboard-text)]">
                Senior Housing: ${Math.round(data.avgSeniorHousingMonthlyRate).toLocaleString()}/mo
              </p>
            )}
            {/* Only show blended rate if specifically needed */}
            {!data.avgHcDailyRate && !data.avgSeniorHousingMonthlyRate && data.avgRate && (
              <p className="text-[var(--dashboard-text)]">
                Avg Rate: ${Math.round(data.avgRate).toLocaleString()}
              </p>
            )}
            {data.occupancy !== undefined && (
              <p className="text-[var(--dashboard-text)]">
                Occupancy: {(data.occupancy * 100).toFixed(1)}%
              </p>
            )}
            {data.competitorAvgRate && (
              <p className="text-[var(--dashboard-muted)]">
                Market Avg: ${Math.round(data.competitorAvgRate).toLocaleString()}
              </p>
            )}
            {data.pricePosition !== undefined && (
              <p className={`font-medium ${data.pricePosition > 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
                Position: {data.pricePosition > 0 ? '+' : ''}{data.pricePosition.toFixed(1)}%
              </p>
            )}
            {data.rateGrowthT6 !== undefined && (
              <p className={`font-medium ${data.rateGrowthT6 > 0 ? 'text-[var(--trilogy-success)]' : 'text-[var(--trilogy-error)]'}`}>
                T6 Rate Growth: {data.rateGrowthT6 > 0 ? '+' : ''}{data.rateGrowthT6.toFixed(1)}%
              </p>
            )}
            {data.revenueImpact && (
              <p className="text-[var(--dashboard-text)]">
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
      </div>
    );
  }
  return null;
};

export function Analytics() {
  // Immediate filter state (for UI)
  const [selectedRegion, setSelectedRegion] = useState<string>('all');
  const [selectedDivision, setSelectedDivision] = useState<string>('all');
  const [selectedServiceLine, setSelectedServiceLine] = useState<string>('all');
  
  // Debounced filter state (for API calls) - reduces rapid API calls when user is clicking through filters
  const [debouncedFilters, setDebouncedFilters] = useState({
    region: 'all',
    division: 'all',
    serviceLine: 'all'
  });
  
  // Debounce filter changes - wait 300ms before making API call
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters({
        region: selectedRegion,
        division: selectedDivision,
        serviceLine: selectedServiceLine
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedRegion, selectedDivision, selectedServiceLine]);
  
  const [calculationDialogOpen, setCalculationDialogOpen] = useState(false);
  const [selectedMetric, setSelectedMetric] = useState<'avgRate' | 'occupancy' | 'marketPosition' | 'revenue' | null>(null);
  const [pinnedTooltip, setPinnedTooltip] = useState<any | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const tooltipTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isTooltipLocked, setIsTooltipLocked] = useState(false);
  const [highlightedDivisions, setHighlightedDivisions] = useState<Set<string>>(new Set());

  // Fetch campus analytics data with aggressive caching and keepPreviousData for smooth UX
  const { data: analyticsData, isLoading, isFetching } = useQuery({
    queryKey: ['/api/analytics/campus-metrics', debouncedFilters.region, debouncedFilters.division, debouncedFilters.serviceLine],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedFilters.region !== 'all') params.append('region', debouncedFilters.region);
      if (debouncedFilters.division !== 'all') params.append('division', debouncedFilters.division);
      if (debouncedFilters.serviceLine !== 'all') params.append('serviceLine', debouncedFilters.serviceLine);
      const queryString = params.toString() ? `?${params.toString()}` : '';
      
      const response = await fetch(`/api/analytics/campus-metrics${queryString}`);
      if (!response.ok) throw new Error('Failed to fetch analytics data');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in garbage collection for 10 minutes
    placeholderData: keepPreviousData, // Keep showing old data while new data loads
    refetchOnWindowFocus: false, // Don't refetch when tab regains focus
  });
  
  // Fetch vacancy scatter data with caching
  const { data: vacancyData, isLoading: isLoadingVacancy, isFetching: isFetchingVacancy } = useQuery({
    queryKey: ['/api/analytics/vacancy-scatter', debouncedFilters.region, debouncedFilters.division, debouncedFilters.serviceLine],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedFilters.serviceLine !== 'all') params.append('serviceLine', debouncedFilters.serviceLine);
      const queryString = params.toString() ? `?${params.toString()}` : '';
      
      const response = await fetch(`/api/analytics/vacancy-scatter${queryString}`);
      if (!response.ok) throw new Error('Failed to fetch vacancy data');
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in garbage collection for 10 minutes
    placeholderData: keepPreviousData, // Keep showing old data while new data loads
    refetchOnWindowFocus: false, // Don't refetch when tab regains focus
  });
  
  // Fetch rate breakdown data (by service line and room type with historical changes)
  const { data: rateBreakdownData } = useQuery({
    queryKey: ['/api/analytics/rate-breakdown'],
    queryFn: async () => {
      const response = await fetch('/api/analytics/rate-breakdown');
      if (!response.ok) throw new Error('Failed to fetch rate breakdown data');
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Fetch RRA (Room Rate Adjustment) analytics - T3 discounts
  const { data: rraData, isLoading: isLoadingRra } = useQuery({
    queryKey: ['/api/analytics/rra', debouncedFilters.serviceLine],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedFilters.serviceLine !== 'all') params.append('serviceLine', debouncedFilters.serviceLine);
      const queryString = params.toString() ? `?${params.toString()}` : '';
      const response = await fetch(`/api/analytics/rra${queryString}`);
      if (!response.ok) throw new Error('Failed to fetch RRA data');
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  // Process data for scatter plots
  const processedData = useMemo(() => {
    if (!analyticsData?.campuses) return [];
    
    return analyticsData.campuses.map((campus: any) => {
      // Calculate raw price position
      const rawPricePosition = campus.competitorAvgRate > 0 
        ? parseFloat((((campus.avgRate - campus.competitorAvgRate) / campus.competitorAvgRate) * 100).toFixed(2))
        : 0;
      
      // Clamp to [-100, 200] range for display (200% = 3x market price, which is reasonable max)
      const clampedPricePosition = Math.max(-100, Math.min(200, rawPricePosition));
      
      return {
        ...campus,
        pricePosition: clampedPricePosition,
        rawPricePosition, // Keep original for tooltip display if needed
        size: Math.max(campus.unitsCount, 10), // Minimum size for visibility
        // Mock T6 rate growth for now - in production this would come from backend
        rateGrowthT6: campus.rateGrowthT6 || ((Math.random() * 10) - 2), // Random between -2% and 8%
      };
    });
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

  // Teal highlight color (Trilogy brand)
  const HIGHLIGHT_COLOR = '#14B8A6';  // Trilogy Teal
  const MUTED_OPACITY = 0.15;

  // Color scale for divisions - using grey, black, dark teal, light teal, dark orange, dark blue, hunter green
  const divisionColors: Record<string, string> = {
    'Central': '#6B7280',  // Grey
    'Central Indiana': '#1F2937',  // Black
    'Central Kentucky': '#0F766E',  // Dark Teal
    'Indianapolis Metro': '#5EEAD4',  // Light Teal
    'Lexington Metro': '#EA580C',  // Dark Orange
    'Louisville Metro': '#1E40AF',  // Dark Blue
    'Northeast': '#065F46',  // Hunter Green
    'Northeast Ohio': '#DC2626',  // Red
    'Northwest': '#9CA3AF',  // Medium Grey
    'Northwest Ohio': '#059669',  // Emerald Green
    'Southeast': '#EC4899',  // Pink
    'Southeast Indiana': '#14B8A6',  // Teal
    'Southwest': '#EF4444',  // Bright Red
  };

  const getColor = (division: string) => {
    // If no divisions are highlighted, show all in their original colors
    if (highlightedDivisions.size === 0) {
      return divisionColors[division] || '#6B7280';
    }
    // If this division is highlighted, show in teal
    if (highlightedDivisions.has(division)) {
      return HIGHLIGHT_COLOR;
    }
    // Otherwise show muted
    return divisionColors[division] || '#6B7280';
  };

  const getOpacity = (division: string) => {
    // If no divisions are highlighted, show all at full opacity
    if (highlightedDivisions.size === 0) return 1;
    // If this division is highlighted, full opacity
    if (highlightedDivisions.has(division)) return 1;
    // Otherwise muted
    return MUTED_OPACITY;
  };

  const toggleDivisionHighlight = (division: string) => {
    setHighlightedDivisions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(division)) {
        newSet.delete(division);
      } else {
        newSet.add(division);
      }
      return newSet;
    });
  };

  const clearHighlights = () => {
    setHighlightedDivisions(new Set());
  };

  const handleExportChart = () => {
    // In a real implementation, this would export the chart as PNG/SVG
    const data: ExportRow[] = processedData.map((d: ProcessedCampusData) => ({
      Campus: d.campusName,
      Region: d.region,
      'Avg Rate': d.avgRate,
      'Occupancy %': (d.occupancy * 100).toFixed(1),
      'Market Rate': d.competitorAvgRate,
      'Price Position %': d.pricePosition.toFixed(1),
    }));
    
    const csv = [
      Object.keys(data[0]).join(','),
      ...data.map((row: ExportRow) => Object.values(row).join(','))
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
        // Use the rate breakdown data with historical changes
        return {
          title: 'Portfolio Average Rates',
          formula: 'Average in-house rates by service line and room type',
          isRateBreakdown: true, // Flag for custom rendering
          rateBreakdownData: rateBreakdownData,
          steps: [
            { label: 'Total occupied units across all campuses', value: (summary.totalOccupiedUnits || 0).toLocaleString() },
            { label: 'Total monthly rent revenue', value: `$${((summary.totalRentRevenue || 0)).toLocaleString()}` },
          ],
          breakdown: []
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
        const campusesWithData = campuses.filter((c: any) => c.pricePosition !== 0 && c.competitorAvgRate > 0);
        const totalPricePosition = campusesWithData.reduce((sum: number, c: any) => 
          sum + (c.pricePosition || 0), 0);
        return {
          title: 'Market Position Calculation',
          formula: 'Average of ((Your Rate - Adjusted Competitor Rate) ÷ Adjusted Competitor Rate × 100)',
          steps: [
            { label: 'Campuses with adjusted competitor data', value: campusesWithData.length.toString() },
            { label: 'Sum of all price positions', value: `${totalPricePosition > 0 ? '+' : ''}${totalPricePosition.toFixed(1)}%` },
            { label: 'Average market position (weighted)', value: `${summary.avgPricePosition > 0 ? '+' : ''}${summary.avgPricePosition.toFixed(1)}%`, highlight: true },
          ],
          breakdown: campuses.slice(0, 10).map((c: any) => ({
            campus: c.campusName,
            value: `${c.pricePosition > 0 ? '+' : ''}${c.pricePosition.toFixed(1)}%`,
            detail: `Your: $${Math.round(c.avgRate).toLocaleString()} | Market: $${Math.round(c.competitorAvgRate).toLocaleString()}`
          }))
        };

      case 'revenue':
        // totalRevenueOpportunity is the monthly opportunity (not annual)
        const monthlyOpportunity = summary.totalRevenueOpportunity;
        const annualOpportunity = monthlyOpportunity * 12;
        
        // Calculate current and potential revenue
        const currentMonthlyRevenue = campuses.reduce((sum: number, c: any) => 
          sum + (c.avgRate * c.occupiedUnits * 30), 0);
        const potentialMonthlyRevenue = currentMonthlyRevenue + monthlyOpportunity;
        
        return {
          title: 'Revenue Opportunity Calculation',
          formula: '(Potential Revenue at 95% Occupancy - Current Revenue) × 12 months',
          steps: [
            { label: 'Current monthly revenue', value: `$${(currentMonthlyRevenue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
            { label: 'Potential monthly revenue at 95% occupancy', value: `$${(potentialMonthlyRevenue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
            { label: 'Monthly opportunity', value: `$${(monthlyOpportunity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
            { label: 'Annual revenue opportunity', value: `$${(annualOpportunity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, highlight: true },
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

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current);
      }
    };
  }, []);

  // Handler to pin tooltip with 3-second minimum visibility (for both click and hover)
  const lockTooltipWithData = (data: any) => {
    if (data && data.payload) {
      setPinnedTooltip(data.payload);
      setIsTooltipLocked(true);
      
      // Clear any existing timer
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current);
      }
      
      // Set 3-second timer to unlock AND clear tooltip
      tooltipTimerRef.current = setTimeout(() => {
        setIsTooltipLocked(false);
        setPinnedTooltip(null);
        setTooltipPosition(null);
      }, 3000);
    }
  };

  // Handler for scatter plot click and hover
  const handleScatterInteraction = (data: any) => {
    lockTooltipWithData(data);
  };

  return (
    <div 
      className="container mx-auto py-6 space-y-6"
      onClick={(e) => {
        // Don't close if tooltip is locked (within 3-second window)
        if (isTooltipLocked) return;
        
        // Close pinned tooltip when clicking outside chart dots and tooltip
        const target = e.target as HTMLElement;
        if (!target.closest('.recharts-scatter-dot') && !target.closest('.recharts-tooltip-wrapper')) {
          setPinnedTooltip(null);
          if (tooltipTimerRef.current) {
            clearTimeout(tooltipTimerRef.current);
          }
        }
      }}
    >
      {/* Logo and Back Button */}
      <div className="flex items-center gap-4 mb-4">
        <Link href="/" data-testid="link-logo">
          <img 
            src="/attached_assets/image_1756817717051.png" 
            alt="Modulo" 
            className="h-16 w-auto"
          />
        </Link>
        <Link href="/">
          <Button variant="ghost" className="gap-2" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>
        </Link>
      </div>
      
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
            <CardTitle className="text-sm font-medium">Portfolio Average Rates</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {analyticsData?.summary?.avgHcDailyRate > 0 && (
                <div className="text-sm">
                  <span className="font-semibold">HC:</span> ${Math.round(analyticsData.summary.avgHcDailyRate).toLocaleString()}/day
                </div>
              )}
              {analyticsData?.summary?.avgSeniorHousingMonthlyRate > 0 && (
                <div className="text-sm">
                  <span className="font-semibold">SH:</span> ${Math.round(analyticsData.summary.avgSeniorHousingMonthlyRate).toLocaleString()}/mo
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">By service line • Click for details</p>
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
        <TabsList className="grid grid-cols-4 lg:grid-cols-8 w-full">
          <TabsTrigger value="rate-growth">Rate Growth</TabsTrigger>
          <TabsTrigger value="price-position">Price vs Market</TabsTrigger>
          <TabsTrigger value="occupancy-rate">Occupancy vs Rate</TabsTrigger>
          <TabsTrigger value="occupancy-position">Occ vs Position</TabsTrigger>
          <TabsTrigger value="revenue-impact">Revenue Impact</TabsTrigger>
          <TabsTrigger value="market-share">Market Position</TabsTrigger>
          <TabsTrigger value="vacancy-analysis">Vacancy Analysis</TabsTrigger>
          <TabsTrigger value="rra-discounts">RRA Discounts</TabsTrigger>
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
                    label={{ value: 'T6 Avg In-House Rate Growth (%)', angle: -90, position: 'center', dx: -50 }}
                    tickFormatter={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip 
                    content={<CustomTooltip pinnedData={pinnedTooltip} />}
                    wrapperStyle={{ pointerEvents: 'auto', zIndex: 1000 }}
                    allowEscapeViewBox={{ x: true, y: true }}
                    isAnimationActive={false}
                    offset={10}
                    cursor={{ strokeDasharray: '3 3' }}
                    active={!!pinnedTooltip}
                  />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter 
                    name="Campuses" 
                    data={processedData} 
                    fill="#6B7280"
                    onClick={handleScatterInteraction}
                    onMouseEnter={handleScatterInteraction}
                  >
                    {processedData.map((entry: ProcessedCampusData, index: number) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={getColor(entry.division)} 
                        fillOpacity={getOpacity(entry.division)}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center items-center">
                {divisions.map(division => (
                  <Badge 
                    key={division} 
                    variant={highlightedDivisions.has(division) ? "default" : "outline"} 
                    className={`gap-1 cursor-pointer transition-all hover:scale-105 ${
                      highlightedDivisions.has(division) ? 'bg-[#14B8A6] border-[#14B8A6] text-white' : ''
                    }`}
                    onClick={() => toggleDivisionHighlight(division)}
                    data-testid={`legend-division-${division.replace(/\s+/g, '-').toLowerCase()}`}
                  >
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ 
                        backgroundColor: highlightedDivisions.has(division) ? '#ffffff' : divisionColors[division] || '#6B7280'
                      }} 
                    />
                    {division}
                  </Badge>
                ))}
                {highlightedDivisions.size > 0 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={clearHighlights}
                    className="text-xs text-muted-foreground hover:text-foreground"
                    data-testid="button-clear-highlights"
                  >
                    Clear
                  </Button>
                )}
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
                  <Tooltip 
                    content={<CustomTooltip pinnedData={pinnedTooltip} />}
                    wrapperStyle={{ pointerEvents: 'auto', zIndex: 1000 }}
                    allowEscapeViewBox={{ x: true, y: true }}
                    isAnimationActive={false}
                    offset={10}
                    cursor={{ strokeDasharray: '3 3' }}
                    active={!!pinnedTooltip}
                  />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter 
                    name="Campuses" 
                    data={processedData} 
                    fill="#6B7280"
                    onClick={handleScatterInteraction}
                    onMouseEnter={handleScatterInteraction}
                  >
                    {processedData.map((entry: ProcessedCampusData, index: number) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={getColor(entry.division)} 
                        fillOpacity={getOpacity(entry.division)}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center items-center">
                {divisions.map(division => (
                  <Badge 
                    key={division} 
                    variant={highlightedDivisions.has(division) ? "default" : "outline"} 
                    className={`gap-1 cursor-pointer transition-all hover:scale-105 ${
                      highlightedDivisions.has(division) ? 'bg-[#14B8A6] border-[#14B8A6] text-white' : ''
                    }`}
                    onClick={() => toggleDivisionHighlight(division)}
                  >
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ 
                        backgroundColor: highlightedDivisions.has(division) ? '#ffffff' : divisionColors[division] || '#6B7280'
                      }} 
                    />
                    {division}
                  </Badge>
                ))}
                {highlightedDivisions.size > 0 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={clearHighlights}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </Button>
                )}
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
                    domain={[-100, 200]}
                    tickFormatter={(value) => `${value > 0 ? '+' : ''}${value.toFixed(0)}%`}
                    ticks={[-100, -50, 0, 50, 100, 150, 200]}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip 
                    content={<CustomTooltip pinnedData={pinnedTooltip} />}
                    wrapperStyle={{ pointerEvents: 'auto', zIndex: 1000 }}
                    allowEscapeViewBox={{ x: true, y: true }}
                    isAnimationActive={false}
                    offset={10}
                    cursor={{ strokeDasharray: '3 3' }}
                    active={!!pinnedTooltip}
                  />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter 
                    name="Campuses" 
                    data={processedData} 
                    fill="#6B7280"
                    onClick={handleScatterInteraction}
                    onMouseEnter={handleScatterInteraction}
                  >
                    {processedData.map((entry: ProcessedCampusData, index: number) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={getColor(entry.division)} 
                        fillOpacity={getOpacity(entry.division)}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center items-center">
                {divisions.map(division => (
                  <Badge 
                    key={division} 
                    variant={highlightedDivisions.has(division) ? "default" : "outline"} 
                    className={`gap-1 cursor-pointer transition-all hover:scale-105 ${
                      highlightedDivisions.has(division) ? 'bg-[#14B8A6] border-[#14B8A6] text-white' : ''
                    }`}
                    onClick={() => toggleDivisionHighlight(division)}
                  >
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ 
                        backgroundColor: highlightedDivisions.has(division) ? '#ffffff' : divisionColors[division] || '#6B7280'
                      }} 
                    />
                    {division}
                  </Badge>
                ))}
                {highlightedDivisions.size > 0 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={clearHighlights}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </Button>
                )}
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
                  <Tooltip 
                    content={<CustomTooltip pinnedData={pinnedTooltip} />}
                    wrapperStyle={{ pointerEvents: 'auto', zIndex: 1000 }}
                    allowEscapeViewBox={{ x: true, y: true }}
                    isAnimationActive={false}
                    offset={10}
                    cursor={{ strokeDasharray: '3 3' }}
                    active={!!pinnedTooltip}
                  />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter 
                    name="Campuses" 
                    data={processedData} 
                    fill="#6B7280"
                    onClick={handleScatterInteraction}
                    onMouseEnter={handleScatterInteraction}
                  >
                    {processedData.map((entry: ProcessedCampusData, index: number) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={getColor(entry.division)} 
                        fillOpacity={getOpacity(entry.division)}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center items-center">
                {divisions.map(division => (
                  <Badge 
                    key={division} 
                    variant={highlightedDivisions.has(division) ? "default" : "outline"} 
                    className={`gap-1 cursor-pointer transition-all hover:scale-105 ${
                      highlightedDivisions.has(division) ? 'bg-[#14B8A6] border-[#14B8A6] text-white' : ''
                    }`}
                    onClick={() => toggleDivisionHighlight(division)}
                  >
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ 
                        backgroundColor: highlightedDivisions.has(division) ? '#ffffff' : divisionColors[division] || '#6B7280'
                      }} 
                    />
                    {division}
                  </Badge>
                ))}
                {highlightedDivisions.size > 0 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={clearHighlights}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </Button>
                )}
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
                    domain={[-100, 200]}
                    tickFormatter={(value) => `${value > 0 ? '+' : ''}${value}%`}
                    ticks={[-100, -50, 0, 50, 100, 150, 200]}
                  />
                  <YAxis 
                    type="number" 
                    dataKey="revenueImpact" 
                    name="Revenue Impact"
                    label={{ value: 'Monthly Revenue Impact ($K)', angle: -90, position: 'center', dx: -35 }}
                    tickFormatter={(value) => `$${Math.round(value / 1000).toLocaleString()}K`}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip 
                    content={<CustomTooltip pinnedData={pinnedTooltip} />}
                    wrapperStyle={{ pointerEvents: 'auto', zIndex: 1000 }}
                    allowEscapeViewBox={{ x: true, y: true }}
                    isAnimationActive={false}
                    offset={10}
                    cursor={{ strokeDasharray: '3 3' }}
                    active={!!pinnedTooltip}
                  />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter 
                    name="Campuses" 
                    data={processedData} 
                    fill="#6B7280"
                    onClick={handleScatterInteraction}
                    onMouseEnter={handleScatterInteraction}
                  >
                    {processedData.map((entry: ProcessedCampusData, index: number) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={getColor(entry.division)} 
                        fillOpacity={getOpacity(entry.division)}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center items-center">
                {divisions.map(division => (
                  <Badge 
                    key={division} 
                    variant={highlightedDivisions.has(division) ? "default" : "outline"} 
                    className={`gap-1 cursor-pointer transition-all hover:scale-105 ${
                      highlightedDivisions.has(division) ? 'bg-[#14B8A6] border-[#14B8A6] text-white' : ''
                    }`}
                    onClick={() => toggleDivisionHighlight(division)}
                  >
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ 
                        backgroundColor: highlightedDivisions.has(division) ? '#ffffff' : divisionColors[division] || '#6B7280'
                      }} 
                    />
                    {division}
                  </Badge>
                ))}
                {highlightedDivisions.size > 0 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={clearHighlights}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </Button>
                )}
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
                    label={{ value: 'Price Differential from Market (%)', angle: -90, position: 'center', dx: -35 }}
                    domain={[-100, 200]}
                    tickFormatter={(value) => `${value > 0 ? '+' : ''}${value.toFixed(0)}%`}
                    ticks={[-100, -50, 0, 50, 100, 150, 200]}
                  />
                  <ZAxis type="number" range={[100, 400]} dataKey="size" />
                  <Tooltip 
                    content={<CustomTooltip pinnedData={pinnedTooltip} />}
                    wrapperStyle={{ pointerEvents: 'auto', zIndex: 1000 }}
                    allowEscapeViewBox={{ x: true, y: true }}
                    isAnimationActive={false}
                    offset={10}
                    cursor={{ strokeDasharray: '3 3' }}
                    active={!!pinnedTooltip}
                  />
                  <Legend verticalAlign="bottom" height={36} wrapperStyle={{ paddingTop: '20px' }} />
                  <Scatter 
                    name="Campuses" 
                    data={processedData} 
                    fill="#6B7280"
                    onClick={handleScatterInteraction}
                    onMouseEnter={handleScatterInteraction}
                  >
                    {processedData.map((entry: ProcessedCampusData, index: number) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={getColor(entry.division)} 
                        fillOpacity={getOpacity(entry.division)}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-4 justify-center items-center">
                {divisions.map(division => (
                  <Badge 
                    key={division} 
                    variant={highlightedDivisions.has(division) ? "default" : "outline"} 
                    className={`gap-1 cursor-pointer transition-all hover:scale-105 ${
                      highlightedDivisions.has(division) ? 'bg-[#14B8A6] border-[#14B8A6] text-white' : ''
                    }`}
                    onClick={() => toggleDivisionHighlight(division)}
                  >
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ 
                        backgroundColor: highlightedDivisions.has(division) ? '#ffffff' : divisionColors[division] || '#6B7280'
                      }} 
                    />
                    {division}
                  </Badge>
                ))}
                {highlightedDivisions.size > 0 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={clearHighlights}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Vacancy Analysis */}
        <TabsContent value="vacancy-analysis" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Vacancy Analysis</CardTitle>
              <CardDescription>
                Each dot represents a vacant unit or B-bed. Click any dot to view its rate card.
                {vacancyData?.summary && (
                  <div className="mt-2 text-sm">
                    <span className="font-medium">{vacancyData.summary.totalVacantUnits} vacant units</span>
                    {vacancyData.summary.totalBBeds > 0 && (
                      <span className="ml-2">• {vacancyData.summary.totalBBeds} B-beds</span>
                    )}
                    {vacancyData.summary.avgDaysVacant > 0 && (
                      <span className="ml-2">• Avg {Math.round(vacancyData.summary.avgDaysVacant)} days vacant</span>
                    )}
                  </div>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingVacancy ? (
                <div className="h-[500px] flex items-center justify-center">
                  <span className="text-muted-foreground">Loading vacancy data...</span>
                </div>
              ) : vacancyData?.units && vacancyData.units.length > 0 ? (
                <ResponsiveContainer width="100%" height={500}>
                  <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      type="number" 
                      dataKey="campusOccupancy" 
                      name="Campus Occupancy"
                      label={{ value: 'Campus Occupancy (%)', position: 'insideBottom', offset: -10 }}
                      domain={[0, 100]}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <YAxis 
                      type="number" 
                      dataKey="daysVacant" 
                      name="Days Vacant"
                      label={{ value: 'Days Vacant', angle: -90, position: 'center', dx: -20 }}
                      domain={[0, 'dataMax + 10']}
                    />
                    <ZAxis type="number" range={[50, 150]} />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-[var(--dashboard-surface)] p-3 rounded-lg shadow-lg border border-[var(--dashboard-border)]">
                              <p className="font-semibold text-sm mb-1 text-[var(--dashboard-text)]">{data.location}</p>
                              <p className="text-xs text-[var(--dashboard-text)]">Room: {data.roomNumber}</p>
                              <p className="text-xs text-[var(--dashboard-text)]">Type: {data.roomType} ({data.unitType})</p>
                              <p className="text-xs text-[var(--dashboard-text)]">Service Line: {data.serviceLine}</p>
                              <p className="text-xs font-medium mt-1 text-[var(--dashboard-text)]">
                                Days Vacant: {data.daysVacant}
                              </p>
                              <p className="text-xs text-[var(--dashboard-text)]">
                                Campus Occupancy: {data.campusOccupancy.toFixed(1)}%
                              </p>
                              {data.streetRate > 0 && (
                                <p className="text-xs text-[var(--dashboard-text)]">
                                  Street Rate: ${Math.round(data.streetRate).toLocaleString()}
                                </p>
                              )}
                              <div className="mt-2 pt-2 border-t border-[var(--dashboard-border)]">
                                <p className="text-xs text-[var(--trilogy-teal)] font-medium">
                                  Click to view rate card →
                                </p>
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Legend 
                      verticalAlign="bottom" 
                      height={36} 
                      wrapperStyle={{ paddingTop: '20px' }}
                      content={() => (
                        <div className="flex justify-center gap-4 text-sm">
                          <span className="flex items-center gap-1">
                            <div className="w-3 h-3 rounded-full bg-red-500" />
                            Vacant A-Beds
                          </span>
                          <span className="flex items-center gap-1">
                            <div className="w-3 h-3 rounded-full bg-blue-500" />
                            B-Beds (HC)
                          </span>
                        </div>
                      )}
                    />
                    <Scatter 
                      name="Vacant Units" 
                      data={vacancyData.units} 
                      fill="#6B7280"
                      onClick={(data: any) => {
                        if (data && data.payload) {
                          const unit = data.payload;
                          const url = `/rate-card?location=${encodeURIComponent(unit.location)}&serviceLine=${encodeURIComponent(unit.serviceLine)}&unit=${encodeURIComponent(unit.roomNumber)}`;
                          window.location.href = url;
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      {vacancyData.units.map((entry: any, index: number) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.isBBed ? '#3B82F6' : '#EF4444'}  // Blue for B-beds, red for vacant A-beds
                        />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[500px] flex items-center justify-center">
                  <span className="text-muted-foreground">No vacant units or B-beds found</span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* RRA Discounts Tab */}
        <TabsContent value="rra-discounts" className="space-y-4">
          <Card className="bg-[var(--dashboard-surface)] border-[var(--dashboard-border)]">
            <CardHeader>
              <CardTitle className="text-[var(--dashboard-text)]">Room Rate Adjustments (RRA) - T3 Discount Analysis</CardTitle>
              <CardDescription className="text-[var(--dashboard-muted)]">
                Trailing 3-month discount trends by service line and location. Tracks promotional allowances applied to occupied units.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingRra ? (
                <div className="h-[400px] flex items-center justify-center">
                  <span className="text-[var(--dashboard-muted)]">Loading RRA data...</span>
                </div>
              ) : rraData ? (
                <div className="space-y-6">
                  {/* Summary Cards - Teal themed like dashboard tiles */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div className="bg-[var(--trilogy-teal)] p-4 rounded-lg border border-[var(--trilogy-teal)]/30">
                      <div className="text-sm text-white/80">T3 Occupied Units</div>
                      <div className="text-2xl font-bold text-white">{rraData.summary?.t3TotalUnits?.toLocaleString() || 0}</div>
                    </div>
                    <div className="bg-[var(--dashboard-surface)] p-4 rounded-lg border border-[var(--dashboard-border)]">
                      <div className="text-sm text-[var(--dashboard-muted)]">Units with Discount</div>
                      <div className="text-2xl font-bold text-[var(--dashboard-text)]">{rraData.summary?.t3UnitsWithDiscount?.toLocaleString() || 0}</div>
                    </div>
                    <div className="bg-[var(--dashboard-surface)] p-4 rounded-lg border border-[var(--dashboard-border)]">
                      <div className="text-sm text-[var(--dashboard-muted)]">Discount Rate</div>
                      <div className="text-2xl font-bold text-[var(--dashboard-text)]">{(rraData.summary?.t3DiscountRate || 0).toFixed(1)}%</div>
                    </div>
                    <div className="bg-[var(--dashboard-surface)] p-4 rounded-lg border border-[var(--dashboard-border)]">
                      <div className="text-sm text-[var(--dashboard-muted)]">Avg Discount/Unit</div>
                      <div className="text-2xl font-bold text-[var(--dashboard-text)]">${(rraData.summary?.t3AvgDiscount || 0).toFixed(0)}</div>
                    </div>
                    <div className="bg-[var(--trilogy-teal)] p-4 rounded-lg border border-[var(--trilogy-teal)]/30">
                      <div className="text-sm text-white/80">Total T3 Discounts</div>
                      <div className="text-2xl font-bold text-white">${((rraData.summary?.t3TotalDiscountAmount || 0) / 1000).toFixed(1)}K</div>
                    </div>
                  </div>

                  {/* By Service Line Table */}
                  <div>
                    <h4 className="font-semibold mb-3 text-sm text-[var(--dashboard-text)]">Discounts by Service Line (T3)</h4>
                    <div className="overflow-x-auto rounded-lg border border-[var(--dashboard-border)]">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--dashboard-border)] bg-[var(--dashboard-background)]">
                            <th className="text-left py-3 px-4 font-medium text-[var(--dashboard-muted)]">Service Line</th>
                            <th className="text-right py-3 px-4 font-medium text-[var(--dashboard-muted)]">Total Units</th>
                            <th className="text-right py-3 px-4 font-medium text-[var(--dashboard-muted)]">With Discount</th>
                            <th className="text-right py-3 px-4 font-medium text-[var(--dashboard-muted)]">Discount %</th>
                            <th className="text-right py-3 px-4 font-medium text-[var(--dashboard-muted)]">Avg Discount</th>
                            <th className="text-right py-3 px-4 font-medium text-[var(--dashboard-muted)]">Total Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rraData.byServiceLine && Object.entries(rraData.byServiceLine)
                            .sort((a: any, b: any) => {
                              const order = ['HC', 'AL', 'SL', 'VIL'];
                              return order.indexOf(a[0]) - order.indexOf(b[0]);
                            })
                            .map(([sl, data]: [string, any]) => (
                              <tr key={sl} className="border-b border-[var(--dashboard-border)] last:border-b-0 hover:bg-[var(--dashboard-surface)]/50">
                                <td className="py-3 px-4 font-medium text-[var(--dashboard-text)]">{sl}</td>
                                <td className="text-right py-3 px-4 text-[var(--dashboard-text)]">{data.totalUnits?.toLocaleString()}</td>
                                <td className="text-right py-3 px-4 text-[var(--dashboard-text)]">{data.unitsWithDiscount?.toLocaleString()}</td>
                                <td className="text-right py-3 px-4">
                                  <span className={data.discountRate > 20 ? 'text-[var(--trilogy-error)]' : data.discountRate > 10 ? 'text-amber-500' : 'text-[var(--dashboard-text)]'}>
                                    {data.discountRate?.toFixed(1)}%
                                  </span>
                                </td>
                                <td className="text-right py-3 px-4 text-[var(--dashboard-text)]">${data.avgDiscount?.toFixed(0)}</td>
                                <td className="text-right py-3 px-4 text-[var(--dashboard-text)]">${(data.totalDiscountAmount / 1000).toFixed(1)}K</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Monthly Trend */}
                  {rraData.monthlyTrend && rraData.monthlyTrend.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-[var(--dashboard-text)]">Monthly Trend</h4>
                      <div className="grid grid-cols-3 gap-4">
                        {rraData.monthlyTrend.map((month: any) => (
                          <div key={month.month} className="bg-[var(--dashboard-surface)] p-4 rounded-lg border border-[var(--dashboard-border)]">
                            <div className="text-xs text-[var(--dashboard-muted)]">{month.month}</div>
                            <div className="text-lg font-semibold text-[var(--dashboard-text)]">{month.discountRate?.toFixed(1)}% discounted</div>
                            <div className="text-sm text-[var(--dashboard-muted)]">
                              Avg: ${month.avgDiscount?.toFixed(0)} | Total: ${(month.totalDiscountAmount / 1000).toFixed(1)}K
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Top Locations by Discount Amount */}
                  {rraData.byLocation && Object.keys(rraData.byLocation).length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-[var(--dashboard-text)]">Top 10 Locations by Discount Amount (T3)</h4>
                      <div className="overflow-x-auto rounded-lg border border-[var(--dashboard-border)]">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[var(--dashboard-border)] bg-[var(--dashboard-background)]">
                              <th className="text-left py-3 px-4 font-medium text-[var(--dashboard-muted)]">Location</th>
                              <th className="text-right py-3 px-4 font-medium text-[var(--dashboard-muted)]">Total Units</th>
                              <th className="text-right py-3 px-4 font-medium text-[var(--dashboard-muted)]">Discount %</th>
                              <th className="text-right py-3 px-4 font-medium text-[var(--dashboard-muted)]">Avg Discount</th>
                              <th className="text-right py-3 px-4 font-medium text-[var(--dashboard-muted)]">Total Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(rraData.byLocation)
                              .sort((a: any, b: any) => b[1].totalDiscountAmount - a[1].totalDiscountAmount)
                              .slice(0, 10)
                              .map(([loc, data]: [string, any]) => (
                                <tr key={loc} className="border-b border-[var(--dashboard-border)] last:border-b-0 hover:bg-[var(--dashboard-surface)]/50">
                                  <td className="py-3 px-4 font-medium text-[var(--dashboard-text)]">{loc}</td>
                                  <td className="text-right py-3 px-4 text-[var(--dashboard-text)]">{data.totalUnits?.toLocaleString()}</td>
                                  <td className="text-right py-3 px-4">
                                    <span className={data.discountRate > 20 ? 'text-[var(--trilogy-error)]' : data.discountRate > 10 ? 'text-amber-500' : 'text-[var(--dashboard-text)]'}>
                                      {data.discountRate?.toFixed(1)}%
                                    </span>
                                  </td>
                                  <td className="text-right py-3 px-4 text-[var(--dashboard-text)]">${data.avgDiscount?.toFixed(0)}</td>
                                  <td className="text-right py-3 px-4 text-[var(--dashboard-text)]">${(data.totalDiscountAmount / 1000).toFixed(1)}K</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {rraData.summary?.t3TotalUnits === 0 && (
                    <div className="p-8 text-center text-[var(--dashboard-muted)]">
                      <p>No RRA discount data found for the selected period.</p>
                      <p className="text-sm mt-2">Re-upload your rent roll data to populate Room Rate Adjustments.</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-[400px] flex items-center justify-center">
                  <span className="text-[var(--dashboard-muted)]">No RRA data available</span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Calculation Details Dialog */}
      <Dialog open={calculationDialogOpen} onOpenChange={setCalculationDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto" data-testid="dialog-calculation">
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
                {/* Rate Breakdown Display - for avgRate metric */}
                {calculationDetails.isRateBreakdown && calculationDetails.rateBreakdownData && (
                  <>
                    {/* Rates by Service Line */}
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-gray-700 dark:text-gray-300">
                        Rates by Service Line
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200 dark:border-gray-700">
                              <th className="text-left py-2 px-2 font-medium text-gray-600 dark:text-gray-400">Service Line</th>
                              <th className="text-right py-2 px-2 font-medium text-gray-600 dark:text-gray-400">Current Rate</th>
                              <th className="text-right py-2 px-2 font-medium text-gray-600 dark:text-gray-400">MOM</th>
                              <th className="text-right py-2 px-2 font-medium text-gray-600 dark:text-gray-400">T3</th>
                              <th className="text-right py-2 px-2 font-medium text-gray-600 dark:text-gray-400">T6</th>
                              <th className="text-right py-2 px-2 font-medium text-gray-600 dark:text-gray-400">T12</th>
                              <th className="text-right py-2 px-2 font-medium text-gray-600 dark:text-gray-400">YTD</th>
                            </tr>
                          </thead>
                          <tbody>
                            {calculationDetails.rateBreakdownData.byServiceLine?.map((row: any, idx: number) => (
                              <tr key={idx} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                <td className="py-2 px-2 font-medium text-gray-900 dark:text-gray-100">
                                  {row.serviceLine}
                                  <span className="ml-1 text-xs text-gray-500">({row.occupiedCount} occ)</span>
                                </td>
                                <td className="text-right py-2 px-2 font-semibold text-gray-900 dark:text-gray-100">
                                  {row.rateDisplay}
                                </td>
                                <td className={`text-right py-2 px-2 font-medium ${row.momChange !== null ? (row.momChange > 0 ? 'text-green-600' : row.momChange < 0 ? 'text-red-600' : 'text-gray-500') : 'text-gray-400'}`}>
                                  {row.momChange !== null ? `${row.momChange > 0 ? '+' : ''}${row.momChange}%` : '—'}
                                </td>
                                <td className={`text-right py-2 px-2 font-medium ${row.t3Change !== null ? (row.t3Change > 0 ? 'text-green-600' : row.t3Change < 0 ? 'text-red-600' : 'text-gray-500') : 'text-gray-400'}`}>
                                  {row.t3Change !== null ? `${row.t3Change > 0 ? '+' : ''}${row.t3Change}%` : '—'}
                                </td>
                                <td className={`text-right py-2 px-2 font-medium ${row.t6Change !== null ? (row.t6Change > 0 ? 'text-green-600' : row.t6Change < 0 ? 'text-red-600' : 'text-gray-500') : 'text-gray-400'}`}>
                                  {row.t6Change !== null ? `${row.t6Change > 0 ? '+' : ''}${row.t6Change}%` : '—'}
                                </td>
                                <td className={`text-right py-2 px-2 font-medium ${row.t12Change !== null ? (row.t12Change > 0 ? 'text-green-600' : row.t12Change < 0 ? 'text-red-600' : 'text-gray-500') : 'text-gray-400'}`}>
                                  {row.t12Change !== null ? `${row.t12Change > 0 ? '+' : ''}${row.t12Change}%` : '—'}
                                </td>
                                <td className={`text-right py-2 px-2 font-medium ${row.ytdChange !== null ? (row.ytdChange > 0 ? 'text-green-600' : row.ytdChange < 0 ? 'text-red-600' : 'text-gray-500') : 'text-gray-400'}`}>
                                  {row.ytdChange !== null ? `${row.ytdChange > 0 ? '+' : ''}${row.ytdChange}%` : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    
                    {/* Rates by Service Line + Room Type */}
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-gray-700 dark:text-gray-300">
                        Rates by Service Line & Room Type
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200 dark:border-gray-700">
                              <th className="text-left py-2 px-2 font-medium text-gray-600 dark:text-gray-400">Service Line</th>
                              <th className="text-left py-2 px-2 font-medium text-gray-600 dark:text-gray-400">Room Type</th>
                              <th className="text-right py-2 px-2 font-medium text-gray-600 dark:text-gray-400">Current Rate</th>
                              <th className="text-right py-2 px-2 font-medium text-gray-600 dark:text-gray-400">MOM</th>
                              <th className="text-right py-2 px-2 font-medium text-gray-600 dark:text-gray-400">T3</th>
                              <th className="text-right py-2 px-2 font-medium text-gray-600 dark:text-gray-400">T6</th>
                              <th className="text-right py-2 px-2 font-medium text-gray-600 dark:text-gray-400">T12</th>
                              <th className="text-right py-2 px-2 font-medium text-gray-600 dark:text-gray-400">YTD</th>
                            </tr>
                          </thead>
                          <tbody>
                            {calculationDetails.rateBreakdownData.byServiceLineRoomType?.map((row: any, idx: number) => (
                              <tr key={idx} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                <td className="py-2 px-2 font-medium text-gray-900 dark:text-gray-100">
                                  {row.serviceLine}
                                </td>
                                <td className="py-2 px-2 text-gray-700 dark:text-gray-300">
                                  {row.roomType}
                                  <span className="ml-1 text-xs text-gray-500">({row.occupiedCount})</span>
                                </td>
                                <td className="text-right py-2 px-2 font-semibold text-gray-900 dark:text-gray-100">
                                  {row.rateDisplay}
                                </td>
                                <td className={`text-right py-2 px-2 font-medium ${row.momChange !== null ? (row.momChange > 0 ? 'text-green-600' : row.momChange < 0 ? 'text-red-600' : 'text-gray-500') : 'text-gray-400'}`}>
                                  {row.momChange !== null ? `${row.momChange > 0 ? '+' : ''}${row.momChange}%` : '—'}
                                </td>
                                <td className={`text-right py-2 px-2 font-medium ${row.t3Change !== null ? (row.t3Change > 0 ? 'text-green-600' : row.t3Change < 0 ? 'text-red-600' : 'text-gray-500') : 'text-gray-400'}`}>
                                  {row.t3Change !== null ? `${row.t3Change > 0 ? '+' : ''}${row.t3Change}%` : '—'}
                                </td>
                                <td className={`text-right py-2 px-2 font-medium ${row.t6Change !== null ? (row.t6Change > 0 ? 'text-green-600' : row.t6Change < 0 ? 'text-red-600' : 'text-gray-500') : 'text-gray-400'}`}>
                                  {row.t6Change !== null ? `${row.t6Change > 0 ? '+' : ''}${row.t6Change}%` : '—'}
                                </td>
                                <td className={`text-right py-2 px-2 font-medium ${row.t12Change !== null ? (row.t12Change > 0 ? 'text-green-600' : row.t12Change < 0 ? 'text-red-600' : 'text-gray-500') : 'text-gray-400'}`}>
                                  {row.t12Change !== null ? `${row.t12Change > 0 ? '+' : ''}${row.t12Change}%` : '—'}
                                </td>
                                <td className={`text-right py-2 px-2 font-medium ${row.ytdChange !== null ? (row.ytdChange > 0 ? 'text-green-600' : row.ytdChange < 0 ? 'text-red-600' : 'text-gray-500') : 'text-gray-400'}`}>
                                  {row.ytdChange !== null ? `${row.ytdChange > 0 ? '+' : ''}${row.ytdChange}%` : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {calculationDetails.rateBreakdownData.currentMonth && (
                        <p className="text-xs text-gray-500 mt-2">
                          Data as of {calculationDetails.rateBreakdownData.currentMonth}
                        </p>
                      )}
                    </div>
                  </>
                )}

                {/* Standard Calculation Steps - for non-rate-breakdown metrics */}
                {!calculationDetails.isRateBreakdown && (
                  <>
                    <div>
                      <h4 className="font-semibold mb-3 text-sm text-gray-700 dark:text-gray-300">Calculation Steps:</h4>
                      <div className="space-y-2">
                        {calculationDetails.steps.map((step: any, idx: number) => (
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
                    {calculationDetails.breakdown?.length > 0 && (
                      <div>
                        <h4 className="font-semibold mb-3 text-sm text-gray-700 dark:text-gray-300">
                          Campus Breakdown (Top 10):
                        </h4>
                        <div className="space-y-1">
                          {calculationDetails.breakdown.map((campus: BreakdownItem, idx: number) => (
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
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}