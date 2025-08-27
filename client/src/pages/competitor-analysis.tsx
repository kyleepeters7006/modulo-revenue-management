import Navigation from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CompetitorAnalysis() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2" data-testid="text-page-title">
            Competitor Analysis
          </h1>
          <p className="text-gray-600" data-testid="text-page-subtitle">
            View competitor locations, rates, and market positioning
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Competitor Map</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">Competitor analysis functionality coming soon</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}