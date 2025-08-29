import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Sidebar from "@/components/dashboard/sidebar";
import MetricsOverview from "@/components/dashboard/metrics-overview";
import ServiceLineOverview from "@/components/dashboard/service-line-overview";
import RevenueChart from "@/components/dashboard/revenue-chart";
import DataUpload from "@/components/dashboard/data-upload";
import PricingWeights from "@/components/dashboard/pricing-weights";
import CompetitorMap from "@/components/dashboard/competitor-map";
import CompetitorForm from "@/components/dashboard/competitor-form";
import ComparisonTable from "@/components/dashboard/comparison-table";
import UnitRecommendations from "@/components/dashboard/unit-recommendations";
import AttributePricing from "@/components/dashboard/attribute-pricing";
import AiInsights from "@/components/dashboard/ai-insights";
import GuardrailsEditor from "@/components/dashboard/guardrails-editor";
import AttributeMap from "@/components/dashboard/attribute-map";
import BuildingMapUploader from "@/components/dashboard/building-map-uploader";
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
  const [selectedServiceLine, setSelectedServiceLine] = useState<string>("All");

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
              src={newBannerLogoPath} 
              alt="Modulo M Logo" 
              className="h-20 w-auto"
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
                <Menu className="h-16 w-16" />
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
          {/* Main Logo Header - Full logo with text */}
          <div className="w-full mb-4 lg:mb-8 py-6 lg:py-8">
            <img 
              src={mainLogoPath} 
              alt="Modulo Revenue Management" 
              className="w-full h-80 sm:h-96 md:h-112 lg:h-128 object-contain"
              style={{ 
                objectPosition: 'center center',
                display: 'block'
              }}
            />
          </div>

          {/* Page Header */}
          <div className="mb-12 lg:mb-16 text-center lg:text-left">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-light text-[var(--trilogy-dark-blue)] mb-4 lg:mb-6" data-testid="text-page-title">
              Revenue Management Dashboard
            </h1>
            <p className="text-base sm:text-lg lg:text-xl font-light text-[var(--trilogy-grey)] leading-relaxed" data-testid="text-page-subtitle">
              Optimize pricing with data-driven market analysis and competitor intelligence
            </p>
          </div>

          {/* Service Line Overview */}
          <div className="mb-12 lg:mb-16">
            <ServiceLineOverview onServiceLineChange={setSelectedServiceLine} />
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

          {/* Attribute Pricing - Primary Function */}
          <div id="attribute-pricing" className="mb-16 scroll-mt-20">
            <AttributePricing />
          </div>
          
          {/* Pricing Weights */}
          <div id="pricing" className="mb-16 scroll-mt-20">
            <PricingWeights />
          </div>

          {/* Test Section - Simple HTML */}
          <div style={{ border: '5px solid purple', padding: '30px', backgroundColor: 'orange', margin: '30px 0' }}>
            <h1 style={{ color: 'black', fontSize: '30px' }}>🟣 BASIC HTML TEST - This should ALWAYS be visible!</h1>
            <p style={{ color: 'black', fontSize: '18px' }}>If you don't see this, there's a page rendering issue.</p>
          </div>

          {/* Competitor Section */}
          <div id="competitors" className="mb-12 lg:mb-16 scroll-mt-20">
            <CompetitorMap />
            
            {/* Always show competitor form */}
            <div style={{ border: '3px solid red', padding: '20px', backgroundColor: 'yellow', margin: '20px 0' }}>
              <h2 style={{ color: 'black', fontSize: '24px', fontWeight: 'bold' }}>🔴 DEBUG: COMPETITOR FORM (Should always show!)</h2>
              <div style={{ backgroundColor: 'white', padding: '10px', margin: '10px 0' }}>
                <p style={{ color: 'black' }}>Simple test: This text should be visible</p>
              </div>
              <CompetitorForm />
            </div>
          </div>

          {/* Comparison Table */}
          <div className="mb-16">
            <ComparisonTable />
          </div>

          {/* Unit Recommendations */}
          <div className="mb-16">
            <UnitRecommendations />
          </div>

          {/* Attribute Map */}
          <div className="mb-16">
            <AttributeMap />
          </div>

          {/* Building Map Uploader */}
          <div className="mb-16">
            <BuildingMapUploader />
          </div>

          {/* AI Insights & Analytics */}
          <div id="ai-insights" className="mb-16 scroll-mt-20">
            <AiInsights />
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
