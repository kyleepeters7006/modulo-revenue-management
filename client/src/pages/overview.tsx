import Navigation from "@/components/navigation";
import OverviewTiles from "@/components/dashboard/overview-tiles";
import RevenueChart from "@/components/dashboard/revenue-chart";
import IndustryContext from "@/components/dashboard/industry-context";
import { Link } from "wouter";
import { BookOpen } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { readOverviewCache, writeOverviewCache } from "@/lib/overviewCache";

export default function Overview() {
  const queryClient = useQueryClient();
  const { clientId } = useAuth();
  const rateGrowthKey = useMemo(
    () => ["/api/overview/rate-growth", clientId, {}] as const,
    [clientId],
  );

  // RateGrowthDrilldown is rendered inside OverviewTiles after the larger
  // overview payload arrives. Start its independent request immediately so the
  // chart does not wait behind the KPI query; React Query shares the in-flight
  // request when the chart mounts.
  useEffect(() => {
    void queryClient.prefetchQuery({
      queryKey: rateGrowthKey,
      queryFn: async () => {
        const response = await fetch("/api/overview/rate-growth", {
          credentials: "include",
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Unable to preload rate growth");
        const data = await response.json();
        writeOverviewCache(clientId, "rate-growth-default", data);
        return data;
      },
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      initialData: readOverviewCache(clientId, "rate-growth-default")?.data,
      initialDataUpdatedAt: readOverviewCache(clientId, "rate-growth-default")?.updatedAt,
    });
  }, [clientId, queryClient, rateGrowthKey]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
        {/* Masthead — the logo keeps its full 260px, but sits beside the title
            instead of stacked above it. Stacked, the logo and the text block
            cost ~420px before a single metric appeared; side by side the text
            occupies height the logo was already taking, so the tiles move up
            into the first screen without shrinking the mark. */}
        <div className="mb-5 sm:mb-6 flex flex-col sm:flex-row items-center sm:items-center gap-4 sm:gap-8 text-center sm:text-left">
          <img 
            src="/attached_assets/modulo_flat_blue_1786491120146.png" 
            alt="Modulo Revenue Management" 
            className="object-contain rounded-3xl shrink-0"
            style={{ 
              height: '260px',
              width: '260px',
              display: 'block'
            }}
          />

          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-light text-[var(--trilogy-dark-blue)] mb-2 sm:mb-3" data-testid="text-page-title">
              Pricing Analytics Dashboard
            </h1>
            <p className="text-base sm:text-lg font-light text-[var(--trilogy-grey)] leading-relaxed" data-testid="text-page-subtitle">
              Real-time pricing optimization with automated execution and intelligent, AI-driven algorithmic governance.
            </p>
            <div className="mt-3">
              <Link href="/pricing-algorithm">
                <span className="inline-flex items-center gap-1.5 text-sm text-[var(--trilogy-teal)] hover:text-[var(--trilogy-teal)]/80 transition-colors cursor-pointer">
                  <BookOpen className="h-3.5 w-3.5" />
                  How the pricing algorithm works
                </span>
              </Link>
            </div>
          </div>
        </div>

         {/* Industry benchmarks before portfolio KPIs */}
         <div className="mb-5 sm:mb-6">
           <IndustryContext />
         </div>

        {/* Overview Tiles */}
        <div className="mb-5 sm:mb-6">
          <OverviewTiles />
        </div>

        {/* Revenue Growth Chart */}
        <div className="mb-5 sm:mb-6">
          <RevenueChart />
        </div>
      </div>
    </div>
  );
}