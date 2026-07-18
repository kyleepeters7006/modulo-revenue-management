import Navigation from "@/components/navigation";
import OverviewTiles from "@/components/dashboard/overview-tiles";
import RevenueChart from "@/components/dashboard/revenue-chart";
import { Link } from "wouter";
import { BookOpen } from "lucide-react";

export default function Overview() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        {/* Main Logo Header */}
        <div className="w-full mb-3 sm:mb-6 py-2 sm:py-4 text-center">
          <img 
            src="/attached_assets/modulo_glass_v2_1784404625887.png" 
            alt="Modulo Revenue Management" 
            className="mx-auto h-60 sm:h-68 md:h-80 object-contain rounded-2xl"
            style={{ 
              objectPosition: 'center center',
              display: 'block'
            }}
          />
        </div>

        {/* Page Header */}
        <div className="mb-6 sm:mb-10 text-center">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-light text-[var(--trilogy-dark-blue)] mb-3 sm:mb-5" data-testid="text-page-title">
            Pricing Analytics Dashboard
          </h1>
          <p className="text-base sm:text-lg md:text-xl font-light text-[var(--trilogy-grey)] leading-relaxed px-2" data-testid="text-page-subtitle">
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

        {/* Overview Tiles */}
        <div className="mb-6 sm:mb-10">
          <OverviewTiles />
        </div>

        {/* Revenue Growth Chart */}
        <div className="mb-6 sm:mb-10">
          <RevenueChart />
        </div>
      </div>
    </div>
  );
}