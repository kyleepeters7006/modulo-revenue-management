import Navigation from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AIInsights() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2" data-testid="text-page-title">
            AI Insights
          </h1>
          <p className="text-gray-600" data-testid="text-page-subtitle">
            AI-powered market analysis and pricing recommendations
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Market Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">AI insights functionality coming soon</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}