import Navigation from "@/components/navigation";
import OverviewTiles from "@/components/dashboard/overview-tiles";
import RevenueChart from "@/components/dashboard/revenue-chart";

export default function Overview() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Main Logo Header */}
        <div className="w-full mb-8 py-6 text-center">
          <div style={{width: '400px', height: '100px', backgroundColor: '#1e40af', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '48px', fontWeight: 'bold', borderRadius: '12px', border: '4px solid #1d4ed8', fontFamily: 'Arial, sans-serif', letterSpacing: '2px', margin: '0 auto'}}>
            MODULO
          </div>
        </div>

        {/* Page Header */}
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-light text-[var(--trilogy-dark-blue)] mb-6" data-testid="text-page-title">
            Revenue Management Dashboard
          </h1>
          <p className="text-xl font-light text-[var(--trilogy-grey)] leading-relaxed" data-testid="text-page-subtitle">
            Optimize pricing with data-driven market analysis and competitor intelligence
          </p>
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