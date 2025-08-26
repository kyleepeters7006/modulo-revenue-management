import { DollarSign, Home, TrendingUp, BarChart3 } from "lucide-react";

interface MetricsOverviewProps {
  data?: {
    starting_revenue?: number;
    occupancy?: number;
  };
}

export default function MetricsOverview({ data }: MetricsOverviewProps) {
  const metrics = [
    {
      title: "Starting Revenue",
      value: data?.starting_revenue ? `$${data.starting_revenue.toLocaleString()}` : "$0",
      icon: DollarSign,
      color: "emerald",
      testId: "metric-revenue"
    },
    {
      title: "Occupancy Rate", 
      value: data?.occupancy ? `${(data.occupancy * 100).toFixed(1)}%` : "0.0%",
      icon: Home,
      color: "blue",
      testId: "metric-occupancy"
    },
    {
      title: "Market Sentiment",
      value: "Neutral", // Will be dynamic based on market data
      icon: TrendingUp,
      color: "emerald",
      testId: "metric-sentiment"
    },
    {
      title: "Avg vs Market",
      value: "--", // Will be calculated from comparison data
      icon: BarChart3,
      color: "amber",
      testId: "metric-comparison"
    },
  ];

  const getColorClasses = (color: string) => {
    const colors = {
      emerald: "bg-[var(--trilogy-success)]/10 text-[var(--trilogy-success)]",
      blue: "bg-[var(--trilogy-blue)]/10 text-[var(--trilogy-blue)]", 
      amber: "bg-[var(--trilogy-warning)]/10 text-[var(--trilogy-warning)]",
    };
    return colors[color as keyof typeof colors] || colors.emerald;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <div key={metric.title} className="dashboard-card">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--dashboard-muted)]">{metric.title}</p>
                <p 
                  className="text-2xl font-bold text-[var(--dashboard-text)]"
                  data-testid={metric.testId}
                >
                  {metric.value}
                </p>
              </div>
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${getColorClasses(metric.color)}`}>
                <Icon className="w-6 h-6" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
