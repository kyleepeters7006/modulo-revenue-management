import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Home, Users, Bed, Shield, Download } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

const floorPlanData = {
  Studio: {
    sqft: 450,
    features: ["Kitchenette", "Private Bath", "Walk-in Closet", "Emergency Call System"],
    basePrice: 3175,
    description: "Cozy and efficient studio apartment perfect for independent seniors",
    availability: 3,
    floorPlanImage: "https://images.unsplash.com/photo-1565183997392-2f6f122e5912?w=400"
  },
  "One Bedroom": {
    sqft: 650,
    features: ["Full Kitchen", "Separate Bedroom", "Living Area", "Private Bath", "Walk-in Closet", "Balcony/Patio"],
    basePrice: 4200,
    description: "Spacious one-bedroom apartment with separate living and sleeping areas",
    availability: 4,
    floorPlanImage: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=400"
  },
  "Two Bedroom": {
    sqft: 950,
    features: ["Full Kitchen", "Two Bedrooms", "Living Room", "Dining Area", "1.5 Baths", "Storage", "Balcony"],
    basePrice: 5100,
    description: "Perfect for couples or those who want extra space for guests",
    availability: 2,
    floorPlanImage: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=400"
  },
  "Memory Care": {
    sqft: 400,
    features: ["Secure Environment", "Private Bath", "24-Hour Care", "Specialized Programming", "Safety Features"],
    basePrice: 4800,
    description: "Specialized care environment for residents with memory impairment",
    availability: 1,
    floorPlanImage: "https://images.unsplash.com/photo-1586105251261-72a756497a11?w=400"
  }
};

const careLevels = [
  { level: "Level 1 - Independent", monthlyFee: 0, description: "No assistance needed" },
  { level: "Level 2 - Light Assist", monthlyFee: 500, description: "Medication reminders, light housekeeping" },
  { level: "Level 3 - Moderate Assist", monthlyFee: 850, description: "Daily living assistance, mobility support" },
  { level: "Level 4 - High Assist", monthlyFee: 1400, description: "Extensive daily care, multiple ADL support" },
  { level: "Level 5 - Memory Care", monthlyFee: 1800, description: "Specialized dementia and Alzheimer's care" }
];

export default function RateCard() {
  const [selectedFloorPlan, setSelectedFloorPlan] = useState("Studio");
  const [selectedCareLevel, setSelectedCareLevel] = useState(0);

  const { data: recommendations } = useQuery({
    queryKey: ["/api/recommendations"],
  });

  const getRecommendedPrice = (roomType: string) => {
    const recs = recommendations as any;
    if (!recs?.items) return null;
    const item = recs.items.find((r: any) => r.Unit_Type === roomType);
    return item?.Recommended_Rent;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const handleDownloadRateCard = () => {
    const rateCardData = Object.entries(floorPlanData).map(([type, data]) => ({
      "Room Type": type,
      "Square Feet": data.sqft,
      "Base Price": formatCurrency(data.basePrice),
      "Modulo Recommended": formatCurrency(getRecommendedPrice(type) || data.basePrice),
      "Available Units": data.availability
    }));

    const csvContent = [
      Object.keys(rateCardData[0]).join(','),
      ...rateCardData.map(row => Object.values(row).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rate_card_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const currentFloorPlan = floorPlanData[selectedFloorPlan as keyof typeof floorPlanData];
  const currentCareLevel = careLevels[selectedCareLevel];
  const recommendedPrice = getRecommendedPrice(selectedFloorPlan);
  const totalMonthlyRate = (recommendedPrice || currentFloorPlan.basePrice) + currentCareLevel.monthlyFee;

  return (
    <div className="dashboard-card mb-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-[var(--trilogy-teal)]/10 rounded-lg flex items-center justify-center">
            <Home className="w-5 h-5 text-[var(--trilogy-teal)]" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[var(--dashboard-text)]">
              Rate Card & Floor Plans
            </h3>
            <p className="text-sm text-[var(--dashboard-muted)]">
              Current pricing and availability by room type
            </p>
          </div>
        </div>
        <Button
          onClick={handleDownloadRateCard}
          className="bg-[var(--trilogy-success)] hover:bg-[var(--trilogy-green)] text-white"
          data-testid="button-download-rate-card"
        >
          <Download className="w-4 h-4 mr-2" />
          Download Rate Card
        </Button>
      </div>

      <Tabs defaultValue="floor-plans" className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-[var(--dashboard-bg)]">
          <TabsTrigger value="floor-plans">Floor Plans</TabsTrigger>
          <TabsTrigger value="care-levels">Care Levels</TabsTrigger>
        </TabsList>

        <TabsContent value="floor-plans" className="space-y-4 mt-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {Object.keys(floorPlanData).map((type) => (
              <Button
                key={type}
                variant={selectedFloorPlan === type ? "default" : "outline"}
                className={`${
                  selectedFloorPlan === type 
                    ? "bg-[var(--trilogy-teal)] text-white" 
                    : "bg-[var(--dashboard-surface)] text-[var(--dashboard-text)]"
                }`}
                onClick={() => setSelectedFloorPlan(type)}
              >
                {type}
              </Button>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-6 mt-6">
            <Card className="bg-[var(--dashboard-surface)] border-[var(--dashboard-border)]">
              <CardHeader>
                <CardTitle className="text-[var(--dashboard-text)]">{selectedFloorPlan}</CardTitle>
                <CardDescription className="text-[var(--dashboard-muted)]">
                  {currentFloorPlan.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="w-full h-48 bg-gradient-to-br from-[var(--trilogy-light-blue)] to-[var(--trilogy-teal)] rounded-lg flex items-center justify-center">
                  <div className="text-white text-center">
                    <div className="text-3xl font-bold mb-2">{selectedFloorPlan}</div>
                    <div className="text-sm opacity-90">{currentFloorPlan.sqft} sq ft</div>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Bed className="w-4 h-4 text-[var(--dashboard-muted)]" />
                    <span className="text-sm text-[var(--dashboard-text)]">{currentFloorPlan.sqft} sq ft</span>
                  </div>
                  <Badge 
                    variant="secondary" 
                    className="bg-[var(--trilogy-teal)]/10 text-[var(--trilogy-teal)]"
                  >
                    {currentFloorPlan.availability} Available
                  </Badge>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium text-[var(--dashboard-text)]">Features:</h4>
                  <ul className="text-sm text-[var(--dashboard-muted)] space-y-1">
                    {currentFloorPlan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-center space-x-2">
                        <span className="w-1 h-1 bg-[var(--trilogy-teal)] rounded-full"></span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-[var(--dashboard-surface)] border-[var(--dashboard-border)]">
              <CardHeader>
                <CardTitle className="text-[var(--dashboard-text)]">Monthly Pricing</CardTitle>
                <CardDescription className="text-[var(--dashboard-muted)]">
                  Base rent plus care level fees
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center pb-3 border-b border-[var(--dashboard-border)]">
                    <span className="text-sm text-[var(--dashboard-muted)]">Market Rate</span>
                    <span className="text-lg text-[var(--dashboard-text)]">
                      {formatCurrency(currentFloorPlan.basePrice)}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center pb-3 border-b border-[var(--dashboard-border)]">
                    <span className="text-sm text-[var(--trilogy-teal)]">Modulo Recommended</span>
                    <span className="text-lg font-semibold text-[var(--trilogy-teal)]">
                      {formatCurrency(recommendedPrice || currentFloorPlan.basePrice)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center pb-3 border-b border-[var(--dashboard-border)]">
                    <span className="text-sm text-[var(--dashboard-muted)]">Care Level {selectedCareLevel + 1}</span>
                    <span className="text-lg text-[var(--dashboard-text)]">
                      {formatCurrency(currentCareLevel.monthlyFee)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center pt-2">
                    <span className="text-base font-medium text-[var(--dashboard-text)]">Total Monthly</span>
                    <span className="text-xl font-bold text-[var(--trilogy-success)]">
                      {formatCurrency(totalMonthlyRate)}
                    </span>
                  </div>
                </div>

                <div className="bg-[var(--dashboard-bg)] rounded-lg p-4">
                  <p className="text-xs text-[var(--dashboard-muted)]">
                    * Pricing includes all utilities, housekeeping, dining services, and activities. 
                    Additional fees may apply for specialized care services.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="care-levels" className="mt-6">
          <div className="space-y-4">
            {careLevels.map((level, idx) => (
              <Card 
                key={idx}
                className={`bg-[var(--dashboard-surface)] border cursor-pointer transition-all ${
                  selectedCareLevel === idx 
                    ? 'border-[var(--trilogy-teal)] shadow-lg' 
                    : 'border-[var(--dashboard-border)]'
                }`}
                onClick={() => setSelectedCareLevel(idx)}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Shield className={`w-5 h-5 ${
                        selectedCareLevel === idx 
                          ? 'text-[var(--trilogy-teal)]' 
                          : 'text-[var(--dashboard-muted)]'
                      }`} />
                      <div>
                        <CardTitle className="text-[var(--dashboard-text)]">{level.level}</CardTitle>
                        <CardDescription className="text-[var(--dashboard-muted)]">
                          {level.description}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-[var(--trilogy-teal)]">
                        {formatCurrency(level.monthlyFee)}
                      </div>
                      <div className="text-xs text-[var(--dashboard-muted)]">per month</div>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}