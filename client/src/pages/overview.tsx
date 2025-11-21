import Navigation from "@/components/navigation";
import OverviewTiles from "@/components/dashboard/overview-tiles";
import RevenueChart from "@/components/dashboard/revenue-chart";
import CensusSummary from "@/components/dashboard/census-summary";
import { useQuery } from "@tanstack/react-query";

export default function Overview() {
  // Fetch census data for the new component
  const { data: censusData, isLoading: censusLoading } = useQuery({
    queryKey: ["/api/overview/census"],
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Main Logo Header */}
        <div className="w-full mb-8 py-6 text-center">
          <img 
            src="/attached_assets/image_1756172904290.png" 
            alt="Modulo Revenue Management" 
            className="mx-auto h-80 object-contain"
            style={{ 
              objectPosition: 'center center',
              display: 'block'
            }}
          />
        </div>

        {/* Page Header */}
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-light text-[var(--trilogy-dark-blue)] mb-6" data-testid="text-page-title">
            Revenue Management Dashboard
          </h1>
          <p className="text-xl font-light text-[var(--trilogy-grey)] leading-relaxed" data-testid="text-page-subtitle">
            Real-time pricing optimization with automated execution and intelligent, AI-driven algorithmic governance.
          </p>
        </div>

        {/* Census Summary - NEW COMPONENT */}
        <div className="mb-12">
          <CensusSummary data={censusData} isLoading={censusLoading} />
        </div>

        {/* Overview Tiles */}
        <div className="mb-12">
          <OverviewTiles />
        </div>

        {/* Revenue Growth Chart */}
        <div className="mb-12">
          <RevenueChart />
        </div>
      </div>
    </div>
  );
}