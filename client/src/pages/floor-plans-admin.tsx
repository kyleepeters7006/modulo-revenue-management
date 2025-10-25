import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Settings } from "lucide-react";
import FloorPlanImageUpload from "@/components/floor-plans/admin/FloorPlanImageUpload";
import PolygonEditor from "@/components/floor-plans/admin/PolygonEditor";

export default function FloorPlansAdminPage() {
  const [selectedCampus, setSelectedCampus] = useState<string>("");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [, setLocation] = useLocation();

  const { data: locationsData } = useQuery({
    queryKey: ['/api/locations'],
  });

  const { data: campusMaps = [] } = useQuery({
    queryKey: [`/api/campus-maps/${selectedCampus}`],
    enabled: !!selectedCampus,
  });

  const locations = locationsData?.locations || [];
  const campusMap = campusMaps[0];

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
                <PolygonEditor campusMap={campusMap} locationId={selectedCampus} />
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
