import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Building2, Upload, MapPin, TrendingUp, Users, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Location {
  id: string;
  name: string;
  region?: string;
  division?: string;
  totalUnits: number;
  address?: string;
  city?: string;
  state?: string;
}

interface PortfolioCompetitor {
  id: string;
  portfolioName: string;
  locations?: any[];
  avgPortfolioRate?: number;
  totalUnits?: number;
  marketShare?: number;
}

export default function PortfolioManager() {
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [uploadType, setUploadType] = useState<"rent_roll" | "competitors" | "targets_trends">("rent_roll");
  const [region, setRegion] = useState("");
  const [division, setDivision] = useState("");
  const { toast } = useToast();

  // Fetch locations
  const { data: locations = [], isLoading } = useQuery<Location[]>({
    queryKey: ["/api/portfolio/locations"],
  });

  // Fetch portfolio competitors
  const { data: portfolioCompetitors = [] } = useQuery<PortfolioCompetitor[]>({
    queryKey: ["/api/portfolio/competitors"],
  });

  // Mass upload mutation
  const massUploadMutation = useMutation({
    mutationFn: async (files: FileList) => {
      const formData = new FormData();
      
      // Add all files
      Array.from(files).forEach((file, index) => {
        formData.append(`file_${index}`, file);
      });
      
      // Add metadata
      formData.append("uploadType", uploadType);
      formData.append("region", region);
      formData.append("division", division);
      
      return apiRequest("/api/portfolio/mass-upload", "POST", formData);
    },
    onSuccess: async (response) => {
      const data = await response.json();
      toast({
        title: "Upload Successful",
        description: `Processed ${data.filesProcessed} files with ${data.totalRecords} records across ${data.locationsCreated} locations`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rent-roll"] });
    },
    onError: (error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Portfolio competitor upload mutation
  const portfolioCompetitorUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return apiRequest("/api/portfolio/competitor-upload", "POST", formData);
    },
    onSuccess: async (response) => {
      const data = await response.json();
      toast({
        title: "Competitor Upload Successful",
        description: `Imported ${data.competitorsImported} competitor portfolios with ${data.totalLocations} locations`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/competitors"] });
    },
    onError: (error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Download template mutation
  const downloadTemplateMutation = useMutation({
    mutationFn: async (templateType: string) => {
      const response = await apiRequest(`/api/portfolio/download-template/${templateType}`, "GET");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${templateType}_template.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    },
    onError: (error) => {
      toast({
        title: "Download Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleMassUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      massUploadMutation.mutate(files);
    }
  };

  const handleCompetitorUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      portfolioCompetitorUploadMutation.mutate(file);
    }
  };

  // Calculate portfolio metrics
  const totalUnits = locations.reduce((sum, loc) => sum + loc.totalUnits, 0);
  const totalLocations = locations.length;
  const regionCount = new Set(locations.map(l => l.region).filter(Boolean)).size;
  const divisionCount = new Set(locations.map(l => l.division).filter(Boolean)).size;

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--trilogy-dark-blue)]">Portfolio Manager</h1>
          <p className="text-sm text-[var(--trilogy-grey)]">Manage locations, uploads, and competitor data across your portfolio</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => downloadTemplateMutation.mutate("rent_roll")}
            disabled={downloadTemplateMutation.isPending}
            data-testid="button-download-rent-template"
          >
            <Download className="h-4 w-4 mr-2" />
            Rent Roll Template
          </Button>
          <Button
            variant="outline"
            onClick={() => downloadTemplateMutation.mutate("competitor")}
            disabled={downloadTemplateMutation.isPending}
            data-testid="button-download-competitor-template"
          >
            <Download className="h-4 w-4 mr-2" />
            Competitor Template
          </Button>
          <Button
            variant="outline"
            onClick={() => downloadTemplateMutation.mutate("targets_trends")}
            disabled={downloadTemplateMutation.isPending}
            data-testid="button-download-targets-template"
          >
            <Download className="h-4 w-4 mr-2" />
            Targets & Trends
          </Button>
        </div>
      </div>

      {/* Portfolio Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--trilogy-grey)]">Total Locations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-[var(--trilogy-teal)]" />
              <span className="text-2xl font-bold" data-testid="text-total-locations">{totalLocations}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--trilogy-grey)]">Total Units</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-[var(--trilogy-turquoise)]" />
              <span className="text-2xl font-bold" data-testid="text-total-units">{totalUnits.toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--trilogy-grey)]">Regions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[var(--trilogy-success)]" />
              <span className="text-2xl font-bold" data-testid="text-regions">{regionCount}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--trilogy-grey)]">Divisions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[var(--trilogy-warning)]" />
              <span className="text-2xl font-bold" data-testid="text-divisions">{divisionCount}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="locations" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 lg:w-auto">
          <TabsTrigger value="locations">Locations</TabsTrigger>
          <TabsTrigger value="upload">Mass Upload</TabsTrigger>
          <TabsTrigger value="competitors">Portfolio Competitors</TabsTrigger>
        </TabsList>

        {/* Locations Tab */}
        <TabsContent value="locations" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Portfolio Locations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                    <SelectTrigger className="w-full sm:w-[250px]" data-testid="select-location-filter">
                      <SelectValue placeholder="Filter by location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Locations</SelectItem>
                      {locations.map((loc) => (
                        <SelectItem key={loc.id} value={loc.id}>
                          {loc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Location</th>
                        <th className="text-left p-2">Region</th>
                        <th className="text-left p-2">Division</th>
                        <th className="text-left p-2">City, State</th>
                        <th className="text-right p-2">Units</th>
                      </tr>
                    </thead>
                    <tbody>
                      {locations
                        .filter(loc => selectedLocation === "all" || loc.id === selectedLocation)
                        .map((location) => (
                          <tr key={location.id} className="border-b hover:bg-gray-50" data-testid={`row-location-${location.id}`}>
                            <td className="p-2 font-medium">{location.name}</td>
                            <td className="p-2">{location.region || "-"}</td>
                            <td className="p-2">{location.division || "-"}</td>
                            <td className="p-2">{location.city && location.state ? `${location.city}, ${location.state}` : "-"}</td>
                            <td className="p-2 text-right">{location.totalUnits.toLocaleString()}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Mass Upload Tab */}
        <TabsContent value="upload" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Mass Upload</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="upload-type">Upload Type</Label>
                  <Select value={uploadType} onValueChange={(v) => setUploadType(v as any)}>
                    <SelectTrigger id="upload-type" data-testid="select-upload-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rent_roll">Rent Roll Data</SelectItem>
                      <SelectItem value="competitors">Competitor Data</SelectItem>
                      <SelectItem value="targets_trends">Targets & Trends</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="region">Region (Optional)</Label>
                  <Input
                    id="region"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder="e.g., Midwest"
                    data-testid="input-region"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="division">Division (Optional)</Label>
                  <Input
                    id="division"
                    value={division}
                    onChange={(e) => setDivision(e.target.value)}
                    placeholder="e.g., Central"
                    data-testid="input-division"
                  />
                </div>
              </div>

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-sm text-gray-600 mb-2">
                  Drop multiple CSV files here or click to browse
                </p>
                <p className="text-xs text-gray-500 mb-4">
                  Files will be automatically separated by location based on the Location column
                </p>
                <input
                  type="file"
                  multiple
                  accept=".csv"
                  onChange={handleMassUpload}
                  className="hidden"
                  id="mass-upload"
                  data-testid="input-mass-upload"
                />
                <Button asChild disabled={massUploadMutation.isPending}>
                  <label htmlFor="mass-upload" className="cursor-pointer">
                    {massUploadMutation.isPending ? "Processing..." : "Select Files"}
                  </label>
                </Button>
              </div>

              {region && (
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-sm text-blue-800">
                    <strong>Note:</strong> Region "{region}" will supersede Division "{division || 'None'}" for all uploaded locations
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Portfolio Competitors Tab */}
        <TabsContent value="competitors" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Portfolio Competitor Upload</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-sm text-gray-600 mb-2">
                  Upload portfolio competitor data CSV
                </p>
                <p className="text-xs text-gray-500 mb-4">
                  Include competitor portfolio names, locations, and rates
                </p>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCompetitorUpload}
                  className="hidden"
                  id="competitor-upload"
                  data-testid="input-competitor-upload"
                />
                <Button asChild disabled={portfolioCompetitorUploadMutation.isPending}>
                  <label htmlFor="competitor-upload" className="cursor-pointer">
                    {portfolioCompetitorUploadMutation.isPending ? "Processing..." : "Select File"}
                  </label>
                </Button>
              </div>

              {portfolioCompetitors.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Portfolio Name</th>
                        <th className="text-left p-2">Locations</th>
                        <th className="text-right p-2">Avg Rate</th>
                        <th className="text-right p-2">Total Units</th>
                        <th className="text-right p-2">Market Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolioCompetitors.map((comp) => (
                        <tr key={comp.id} className="border-b hover:bg-gray-50" data-testid={`row-competitor-${comp.id}`}>
                          <td className="p-2 font-medium">{comp.portfolioName}</td>
                          <td className="p-2">{comp.locations?.length || 0}</td>
                          <td className="p-2 text-right">${Math.round(comp.avgPortfolioRate || 0).toLocaleString()}</td>
                          <td className="p-2 text-right">{(comp.totalUnits || 0).toLocaleString()}</td>
                          <td className="p-2 text-right">{Math.round(comp.marketShare || 0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}