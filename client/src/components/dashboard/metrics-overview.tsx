import { DollarSign, Home, TrendingUp, BarChart3 } from "lucide-react";
import { formatCurrency, formatPercentage } from "@/lib/formatters";

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
      value: formatCurrency(data?.starting_revenue || 0),
      icon: DollarSign,
      color: "emerald",
      testId: "metric-revenue"
    },
    {
      title: "Occupancy Rate", 
      value: formatPercentage(data?.occupancy || 0),
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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <div key={metric.title} className="bg-[var(--dashboard-surface)] border border-[var(--dashboard-border)] rounded-2xl p-8 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-light text-[var(--dashboard-muted)] tracking-wide uppercase mb-4">{metric.title}</p>
                <p 
                  className="text-3xl font-light text-[var(--dashboard-text)]"
                  data-testid={metric.testId}
                >
                  {metric.value}
                </p>
              </div>
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${getColorClasses(metric.color)}`}>
                <Icon className="w-7 h-7" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
