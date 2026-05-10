import Navigation from "@/components/navigation";
import AIInsights from "@/components/dashboard/ai-insights";

export default function AIInsightsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="mb-4 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1 sm:mb-2" data-testid="text-page-title">
            AI Insights & Analytics
          </h1>
          <p className="text-sm sm:text-base text-gray-600" data-testid="text-page-subtitle">
            AI-powered market analysis, pricing recommendations, and revenue optimization
          </p>
        </div>

        <AIInsights />
      </div>
    </div>
  );
}