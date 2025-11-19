import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Settings, Wand2, Loader2, Zap } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import FloorPlanImageUpload from "@/components/floor-plans/admin/FloorPlanImageUpload";
import PolygonEditor from "@/components/floor-plans/admin/PolygonEditor";

export default function FloorPlansAdminPage() {
  const [selectedCampus, setSelectedCampus] = useState<string>("");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [, setLocation] = useLocation();

  // Read campus from URL parameters on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const campusParam = params.get('campus');
    if (campusParam) {
      setSelectedCampus(campusParam);
    }
  }, []);

  const { data: locationsData } = useQuery({
    queryKey: ['/api/locations'],
  });

  // Auto-select first campus when locations load if not set from URL
  useEffect(() => {
    const locations = locationsData?.locations || [];
    if (locations.length > 0 && !selectedCampus) {
      setSelectedCampus(locations[0].id);
    }
  }, [locationsData, selectedCampus]);

  const { data: campusMaps = [] } = useQuery({
    queryKey: [`/api/campus-maps/${selectedCampus}`],
    enabled: !!selectedCampus,
  });

  const locations = locationsData?.locations || [];
  const campusMap = campusMaps[0];

  // Auto-map mutation for single campus
  const autoMapMutation = useMutation({
    mutationFn: async (campusId: string) => {
      const response = await fetch(`/api/campus-maps/${campusId}/auto-map`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Auto-mapping failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Grid Generation Complete",
        description: data.stats ? 
          `Created ${data.stats.created} unit mappings` : 
          data.message,
      });
      
      // Refresh campus maps and polygons
      queryClient.invalidateQueries({ queryKey: [`/api/campus-maps/${selectedCampus}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/unit-polygons`] });
    },
    onError: (error: any) => {
      toast({
        title: "Grid Generation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Bulk generate for all campuses
  const bulkGenerateMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('/api/campus-maps/auto-generate-all', 'POST');
    },
    onSuccess: (data: any) => {
      toast({
        title: "Bulk Generation Complete",
        description: data.message || `Generated floor plans for all campuses`,
      });
      
      // Refresh all data
      queryClient.invalidateQueries({ queryKey: ['/api/campus-maps'] });
      queryClient.invalidateQueries({ queryKey: ['/api/unit-polygons'] });
    },
    onError: (error: any) => {
      toast({
        title: "Bulk Generation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-screen-2xl mx-auto px-8 py-4">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setLocation('/floor-plans')}
              className="hover:bg-slate-100"
              data-testid="button-back"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Floor Plans
            </Button>
            <div className="border-l pl-4">
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-slate-600" />
                <h1 className="text-xl font-normal text-gray-900">
                  Floor Plans Admin
                </h1>
              </div>
            </div>
            <div className="ml-auto">
              <Select value={selectedCampus} onValueChange={setSelectedCampus}>
                <SelectTrigger className="w-64" data-testid="select-campus">
                  <SelectValue placeholder="Select a campus..." />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((location: any) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 max-w-screen-2xl mx-auto w-full px-8 py-6">
        {/* Bulk Actions Section */}
        <Card className="mb-6 border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-blue-600" />
              Quick Setup - All Campuses
            </CardTitle>
            <CardDescription>
              Generate grid-based floor plan layouts for all {locations.length} campuses at once. Each campus will get a default floor plan with units automatically arranged in a grid pattern.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={() => bulkGenerateMutation.mutate()}
              disabled={bulkGenerateMutation.isPending || locations.length === 0}
              size="lg"
              className="w-full sm:w-auto"
              data-testid="button-bulk-generate"
            >
              {bulkGenerateMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating for all campuses...
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-4 w-4" />
                  Generate Grid Layouts for All Campuses
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground mt-3">
              This creates a simple grid layout for quick setup. You can later customize individual campuses with AI detection or manual drawing.
            </p>
          </CardContent>
        </Card>

        {!selectedCampus ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <Settings className="h-16 w-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-700 mb-2">
                No Campus Selected
              </h3>
              <p className="text-sm text-muted-foreground">
                Select a campus from the dropdown above to manage floor plans
              </p>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="mb-6">
              <TabsTrigger value="upload" data-testid="tab-upload">
                Upload Image
              </TabsTrigger>
              <TabsTrigger value="polygons" data-testid="tab-polygons">
                Draw Polygons
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h2 className="text-2xl font-semibold">Upload Floor Plan Image</h2>
                  <p className="text-sm text-slate-600 mt-1">
                    Upload a photorealistic aerial/satellite image of the campus floor plan
                  </p>
                </div>
                <Button onClick={() => setUploadDialogOpen(true)} data-testid="button-open-upload">
                  Upload New Image
                </Button>
              </div>

              {campusMap?.baseImageUrl && (
                <div className="border rounded-lg p-6 bg-slate-50">
                  <h3 className="font-medium mb-4">Current Floor Plan</h3>
                  <div className="bg-white p-4 rounded border">
                    <img 
                      src={campusMap.baseImageUrl} 
                      alt={campusMap.name}
                      className="max-w-full h-auto"
                    />
                    <div className="mt-4 text-sm text-slate-600">
                      <div><strong>Name:</strong> {campusMap.name}</div>
                      <div><strong>Dimensions:</strong> {campusMap.width} × {campusMap.height} pixels</div>
                    </div>
                  </div>
                </div>
              )}

              {!campusMap?.baseImageUrl && (
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-12 text-center">
                  <p className="text-slate-500">No floor plan image uploaded yet</p>
                  <Button 
                    onClick={() => setUploadDialogOpen(true)} 
                    className="mt-4"
                    data-testid="button-upload-first"
                  >
                    Upload First Image
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="polygons">
              {campusMap ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <h2 className="text-2xl font-semibold">Map Units to Rooms</h2>
                      <p className="text-sm text-slate-600 mt-1">
                        Use AI detection (Step 1 tab below) or create a simple grid layout
                      </p>
                    </div>
                    <Button 
                      onClick={() => autoMapMutation.mutate(selectedCampus)}
                      disabled={autoMapMutation.isPending}
                      variant="outline"
                      data-testid="button-generate-grid"
                    >
                      {autoMapMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Generating Grid...
                        </>
                      ) : (
                        <>
                          <Wand2 className="mr-2 h-4 w-4" />
                          Generate Grid Layout
                        </>
                      )}
                    </Button>
                  </div>
                  <PolygonEditor campusMap={campusMap} locationId={selectedCampus} />
                </div>
              ) : (
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-12 text-center">
                  <p className="text-slate-500">Please upload a floor plan image first</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>

      <FloorPlanImageUpload
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        campusId={selectedCampus}
      />
    </div>
  );
}
