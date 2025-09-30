import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, TrendingDown, DollarSign, Target, Users, Activity } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

interface ImpactSummary {
  totalMonthlyImpact: number;
  totalAnnualImpact: number;
  totalVolumeAdjustedImpact: number;
  activeRuleCount: number;
  affectedUnitsCount: number;
  projectedVolumeIncrease: number;
  averageImpactPerUnit: number;
  topPerformingRule: {
    name: string;
    impact: number;
  } | null;
}

export default function AnnualImpactSummary() {
  const { data: rules, isLoading } = useQuery({
    queryKey: ['/api/adjustment-rules'],
  });

  // Calculate impact summary from active rules
  const impactSummary: ImpactSummary = rules ? rules.reduce((acc, rule) => {
    if (!rule.isActive) return acc;
    
    return {
      totalMonthlyImpact: acc.totalMonthlyImpact + (rule.monthlyImpact || 0),
      totalAnnualImpact: acc.totalAnnualImpact + (rule.annualImpact || 0),
      totalVolumeAdjustedImpact: acc.totalVolumeAdjustedImpact + (rule.volumeAdjustedAnnualImpact || 0),
      activeRuleCount: acc.activeRuleCount + 1,
      affectedUnitsCount: acc.affectedUnitsCount + (rule.affectedUnits || 0),
      projectedVolumeIncrease: 5, // Fixed 5% assumption
      averageImpactPerUnit: 0, // Will calculate after
      topPerformingRule: !acc.topPerformingRule || (rule.volumeAdjustedAnnualImpact || 0) > acc.topPerformingRule.impact
        ? { name: rule.name, impact: rule.volumeAdjustedAnnualImpact || 0 }
        : acc.topPerformingRule,
    };
  }, {
    totalMonthlyImpact: 0,
    totalAnnualImpact: 0,
    totalVolumeAdjustedImpact: 0,
    activeRuleCount: 0,
    affectedUnitsCount: 0,
    projectedVolumeIncrease: 5,
    averageImpactPerUnit: 0,
    topPerformingRule: null,
  } as ImpactSummary) : null;

  if (impactSummary && impactSummary.affectedUnitsCount > 0) {
    impactSummary.averageImpactPerUnit = impactSummary.totalVolumeAdjustedImpact / impactSummary.affectedUnitsCount;
  }

  const formatCurrency = (value: number) => {
    const absValue = Math.abs(value);
    if (absValue >= 1000000) {
      return `${value < 0 ? '-' : ''}$${(absValue / 1000000).toFixed(1)}M`;
    } else if (absValue >= 1000) {
      return `${value < 0 ? '-' : ''}$${(absValue / 1000).toFixed(0)}K`;
    }
    return `${value < 0 ? '-' : ''}$${absValue.toFixed(0)}`;
  };

  const isPositiveImpact = impactSummary ? impactSummary.totalVolumeAdjustedImpact > 0 : false;

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!impactSummary || impactSummary.activeRuleCount === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Annual Impact Tracker
          </CardTitle>
          <CardDescription>
            No active adjustment rules. Create rules to see projected annual impacts.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Annual Impact Tracker
            </CardTitle>
            <CardDescription>
              Projected revenue impact with {impactSummary.projectedVolumeIncrease}% volume increase
            </CardDescription>
          </div>
          <Badge variant={isPositiveImpact ? "default" : "secondary"} className="text-lg px-3 py-1">
            {isPositiveImpact ? <TrendingUp className="h-4 w-4 mr-1" /> : <TrendingDown className="h-4 w-4 mr-1" />}
            {formatCurrency(impactSummary.totalVolumeAdjustedImpact)}/year
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Key Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Monthly Impact</span>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">
              {formatCurrency(impactSummary.totalMonthlyImpact)}
            </div>
            <p className="text-xs text-muted-foreground">Per month revenue change</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Base Annual</span>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">
              {formatCurrency(impactSummary.totalAnnualImpact)}
            </div>
            <p className="text-xs text-muted-foreground">Without volume increase</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">With Volume Boost</span>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {formatCurrency(impactSummary.totalVolumeAdjustedImpact)}
            </div>
            <p className="text-xs text-muted-foreground">5% occupancy increase</p>
          </div>
        </div>

        {/* Progress Indicator */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Volume Boost Contribution</span>
            <span className="font-medium">
              +{formatCurrency(impactSummary.totalVolumeAdjustedImpact - impactSummary.totalAnnualImpact)}
            </span>
          </div>
          <Progress 
            value={5} 
            max={100} 
            className="h-2"
          />
          <p className="text-xs text-muted-foreground">
            5% volume increase adds {formatCurrency(impactSummary.totalVolumeAdjustedImpact - impactSummary.totalAnnualImpact)} in annual revenue
          </p>
        </div>

        {/* Rule Statistics */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">
                <span className="font-medium">{impactSummary.affectedUnitsCount}</span> units affected
              </span>
            </div>
            <div className="text-sm">
              <span className="font-medium">{impactSummary.activeRuleCount}</span> active rules
            </div>
          </div>
          {impactSummary.topPerformingRule && (
            <Badge variant="outline" className="text-xs">
              Top: {impactSummary.topPerformingRule.name}
            </Badge>
          )}
        </div>

        {/* Average Impact */}
        {impactSummary.averageImpactPerUnit > 0 && (
          <div className="text-sm text-muted-foreground text-center">
            Average annual impact: <span className="font-medium text-foreground">
              {formatCurrency(impactSummary.averageImpactPerUnit)}
            </span> per unit with volume increase
          </div>
        )}
      </CardContent>
    </Card>
  );
}