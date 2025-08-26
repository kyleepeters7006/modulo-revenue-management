import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Sidebar from "@/components/dashboard/sidebar";
import MetricsOverview from "@/components/dashboard/metrics-overview";
import RevenueChart from "@/components/dashboard/revenue-chart";
import DataUpload from "@/components/dashboard/data-upload";
import PricingWeights from "@/components/dashboard/pricing-weights";
import CompetitorMap from "@/components/dashboard/competitor-map";
import CompetitorForm from "@/components/dashboard/competitor-form";
import ComparisonTable from "@/components/dashboard/comparison-table";
import UnitRecommendations from "@/components/dashboard/unit-recommendations";
import AiInsights from "@/components/dashboard/ai-insights";
import MlTrainer from "@/components/dashboard/ml-trainer";
import GuardrailsEditor from "@/components/dashboard/guardrails-editor";
import RateCard from "@/components/dashboard/rate-card";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import transparentLogoPath from "@assets/image_1756171963360.png";
import mainLogoPath from "@assets/image_1756172904290.png";
import newBannerLogoPath from "@assets/image_1756174752342.png";

// Debug: Log the logo path
console.log('Main logo path:', mainLogoPath);

export default function Dashboard() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ["/api/status"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--dashboard-bg)] flex items-center justify-center">
        <div className="text-[var(--dashboard-text)]">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[var(--dashboard-bg)]">
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex lg:w-80 lg:flex-col lg:fixed lg:inset-y-0">
        <Sidebar />
      </div>

      {/* Mobile Header */}
      <div className="lg:hidden bg-[var(--dashboard-surface)] border-b border-[var(--dashboard-border)] px-4 py-3 fixed top-0 left-0 right-0 z-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <img 
              src={mainLogoPath} 
              alt="Modulo Logo" 
              className="h-12 w-auto max-w-[60vw]"
            />
          </div>
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon"
                className="text-[var(--dashboard-muted)] hover:text-[var(--dashboard-text)]"
                data-testid="button-mobile-menu"
              >
                <Menu className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 p-0 bg-[var(--dashboard-surface)]">
              <Sidebar />
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 lg:pl-80 pt-16 lg:pt-0 w-full max-w-full overflow-y-auto">
        <main className="flex-1 px-2 py-4 sm:px-4 sm:py-6 lg:p-12 w-full max-w-full overflow-x-hidden">
          {/* Remove duplicate logo header on desktop, keep only on mobile */}
          <div className="lg:hidden w-full mb-4 py-2 overflow-hidden">
            {/* Logo already in mobile header, no need for duplicate */}
          </div>

          {/* Page Header */}
          <div className="mb-12 lg:mb-16 text-center lg:text-left">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-light text-[var(--trilogy-dark-blue)] mb-4 lg:mb-6" data-testid="text-page-title">
              Revenue Management Dashboard
            </h1>
            <p className="text-base sm:text-lg lg:text-xl font-light text-[var(--trilogy-grey)] leading-relaxed" data-testid="text-page-subtitle">
              Optimize pricing with AI-driven market analysis and competitor intelligence
            </p>
          </div>

          {/* Revenue Chart - Primary Visual */}
          <RevenueChart />
          
          {/* Rate Card & Floor Plans */}
          <div id="ratecard" className="scroll-mt-20">
            <RateCard />
          </div>

          {/* Metrics Overview */}
          <MetricsOverview data={status as any} />

          {/* Data Upload & Assumptions */}
          <div id="data-upload" className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-12 mb-12 lg:mb-16 scroll-mt-20">
            <DataUpload />
            <div className="dashboard-card">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"/>
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-[var(--dashboard-text)]">Model Assumptions</h3>
                  <p className="text-sm text-[var(--dashboard-muted)]">Configure projection parameters</p>
                </div>
              </div>
              {/* Assumptions form content will be added here */}
            </div>
          </div>

          {/* Pricing Weights */}
          <div id="pricing" className="mb-16 scroll-mt-20">
            <PricingWeights />
          </div>

          {/* Competitor Section */}
          <div id="competitors" className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-12 mb-12 lg:mb-16 scroll-mt-20">
            <div className="lg:col-span-2">
              <CompetitorMap />
            </div>
            <CompetitorForm />
          </div>

          {/* Comparison Table */}
          <div className="mb-16">
            <ComparisonTable />
          </div>

          {/* Unit Recommendations */}
          <div className="mb-16">
            <UnitRecommendations />
          </div>

          {/* AI Insights & ML Trainer */}
          <div id="ai" className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-16 scroll-mt-20">
            <AiInsights />
            <div className="dashboard-card">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-[var(--dashboard-text)]">Market Sentiment</h3>
                  <p className="text-sm text-[var(--dashboard-muted)]">Based on S&P 500 performance</p>
                </div>
              </div>
              {/* Market sentiment content will be added here */}
            </div>
          </div>

          {/* ML Trainer */}
          <div id="ml" className="mb-16 scroll-mt-20">
            <MlTrainer />
          </div>

          {/* Guardrails Editor */}
          <div id="guardrails" className="mb-16 scroll-mt-20">
            <GuardrailsEditor />
          </div>
        </main>
      </div>
    </div>
  );
}
