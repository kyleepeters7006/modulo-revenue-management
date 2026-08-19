import Navigation from "@/components/navigation";
import OverviewTiles from "@/components/dashboard/overview-tiles";
import RevenueChart from "@/components/dashboard/revenue-chart";
import { Link } from "wouter";
import { BookOpen } from "lucide-react";

export default function Overview() {
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