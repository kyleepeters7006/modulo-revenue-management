import { useState } from "react";
import Navigation from "@/components/navigation";
import RateCardTable from "@/components/dashboard/rate-card-table";
import { Button } from "@/components/ui/button";

export default function RateCard() {
  const [selectedServiceLine, setSelectedServiceLine] = useState<string>("All");

  const serviceLines = ["All", "AL", "AL/MC", "HC", "HC/MC", "IL", "SL"];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2" data-testid="text-page-title">
            Rate Card & Pricing
          </h1>
          <p className="text-gray-600" data-testid="text-page-subtitle">
            Review current rates, Modulo suggestions, and AI recommendations
          </p>
          
          {/* Service Line Filter */}
          <div className="mt-6">
            <h3 className="text-sm font-medium text-gray-900 mb-3">Filter by Service Line:</h3>
            <div className="flex flex-wrap gap-2">
              {serviceLines.map((serviceLine) => (
                <Button
                  key={serviceLine}
                  variant={selectedServiceLine === serviceLine ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedServiceLine(serviceLine)}
                  data-testid={`button-serviceline-${serviceLine.toLowerCase()}`}
                  className="text-xs"
                >
                  {serviceLine === "All" ? "All Service Lines" : serviceLine}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <RateCardTable selectedServiceLine={selectedServiceLine} />
      </div>
    </div>
  );
}