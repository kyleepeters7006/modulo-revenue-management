import { useState, useEffect } from "react";
import Navigation from "@/components/navigation";
import RateCardTable from "@/components/dashboard/rate-card-table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";

export default function RateCard() {
  const [selectedServiceLine, setSelectedServiceLine] = useState<string>("All");
  const [selectedRegion, setSelectedRegion] = useState<string>("All");
  const [selectedDivision, setSelectedDivision] = useState<string>("All");
  const [selectedLocation, setSelectedLocation] = useState<string>("All");

  const serviceLines = ["All", "AL", "AL/MC", "HC", "HC/MC", "IL", "SL"];

  // Fetch locations data for filters
  const { data: locationsData } = useQuery({
    queryKey: ["/api/locations"],
  });

  // Extract unique regions, divisions, and locations
  const regions = ["All", ...(locationsData?.regions || [])];
  const divisions = ["All", ...(locationsData?.divisions || [])];
  const locations = ["All", ...(locationsData?.locations?.map((loc: any) => loc.name) || [])];

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
          
          {/* Filters */}
          <div className="mt-6 space-y-4">
            {/* Region, Division, Location Filters */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">Region:</h3>
                <Select value={selectedRegion} onValueChange={setSelectedRegion}>
                  <SelectTrigger data-testid="select-region">
                    <SelectValue placeholder="Select Region" />
                  </SelectTrigger>
                  <SelectContent>
                    {regions.map((region) => (
                      <SelectItem key={region} value={region}>
                        {region === "All" ? "All Regions" : region}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">Division:</h3>
                <Select value={selectedDivision} onValueChange={setSelectedDivision}>
                  <SelectTrigger data-testid="select-division">
                    <SelectValue placeholder="Select Division" />
                  </SelectTrigger>
                  <SelectContent>
                    {divisions.map((division) => (
                      <SelectItem key={division} value={division}>
                        {division === "All" ? "All Divisions" : division}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-900 mb-2">Location:</h3>
                <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                  <SelectTrigger data-testid="select-location">
                    <SelectValue placeholder="Select Location" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((location) => (
                      <SelectItem key={location} value={location}>
                        {location === "All" ? "All Locations" : location}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Service Line Filter */}
            <div>
              <h3 className="text-sm font-medium text-gray-900 mb-3">Service Line:</h3>
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
        </div>

        <RateCardTable 
          selectedServiceLine={selectedServiceLine}
          selectedRegion={selectedRegion}
          selectedDivision={selectedDivision}
          selectedLocation={selectedLocation}
        />
      </div>
    </div>
  );
}