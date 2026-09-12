import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import Navigation from "@/components/navigation";
import AIInsights from "@/components/dashboard/ai-insights";
import { Button } from "@/components/ui/button";

export default function AIInsightsPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="mb-4 sm:mb-8">
          <Button
            variant="ghost"
            className="mb-2 -ml-3 gap-2"
            onClick={() => setLocation("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>
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