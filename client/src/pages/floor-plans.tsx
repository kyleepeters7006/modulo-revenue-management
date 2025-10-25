import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Map, LayoutTemplate, PenTool, Building2 } from "lucide-react";
import SVGUploadDialog from "@/components/floor-plans/SVGUploadDialog";

export default function FloorPlansPage() {
  const [selectedCampus, setSelectedCampus] = useState<string>("");
  const [activeTab, setActiveTab] = useState("maps");
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  // Fetch locations for campus selector
  const { data: locations = [] } = useQuery({
    queryKey: ['/api/locations'],
  });

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-screen-2xl mx-auto px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Floor Plan Manager
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Manage campus maps, floor plan templates, and interactive unit polygons
              </p>
            </div>
            <Button 
              className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/90" 
              data-testid="button-upload-map"
              onClick={() => setShowUploadDialog(true)}
              disabled={!selectedCampus}
            >
              <Upload className="h-4 w-4 mr-2" />
              Upload New Map
            </Button>
          </div>

          {/* Campus Selector */}
          <div className="mt-6">
            <label className="text-xs font-medium text-slate-600 uppercase tracking-wide mb-2 block">
              Select Campus
            </label>
            <Select value={selectedCampus} onValueChange={setSelectedCampus}>
              <SelectTrigger className="w-80" data-testid="select-campus">
                <SelectValue placeholder="Choose a campus to manage..." />
              </SelectTrigger>
              <SelectContent>
                {locations.map((location: any) => (
                  <SelectItem key={location.id} value={location.id}>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-[var(--trilogy-teal)]" />
                      <span>{location.name}</span>
                      {location.state && (
                        <span className="text-xs text-muted-foreground">({location.state})</span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-screen-2xl mx-auto px-8 py-6">
        {!selectedCampus ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Map className="h-16 w-16 text-slate-300 mb-4" />
              <h3 className="text-lg font-medium text-slate-700 mb-2">
                No Campus Selected
              </h3>
              <p className="text-sm text-muted-foreground max-w-md text-center">
                Select a campus from the dropdown above to view and manage its floor plans,
                upload SVG maps, and create interactive unit polygons.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="bg-white border border-slate-200 p-1">
              <TabsTrigger value="maps" className="gap-2" data-testid="tab-maps">
                <Map className="h-4 w-4" />
                Campus Maps
              </TabsTrigger>
              <TabsTrigger value="templates" className="gap-2" data-testid="tab-templates">
                <LayoutTemplate className="h-4 w-4" />
                Floor Plan Templates
              </TabsTrigger>
              <TabsTrigger value="mapping" className="gap-2" data-testid="tab-mapping">
                <PenTool className="h-4 w-4" />
                Unit Mapping
              </TabsTrigger>
            </TabsList>

            <TabsContent value="maps" className="space-y-6">
              <CampusMapsTab campusId={selectedCampus} />
            </TabsContent>

            <TabsContent value="templates" className="space-y-6">
              <FloorPlanTemplatesTab campusId={selectedCampus} />
            </TabsContent>

            <TabsContent value="mapping" className="space-y-6">
              <UnitMappingTab campusId={selectedCampus} />
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Upload Dialog */}
      <SVGUploadDialog
        open={showUploadDialog}
        onOpenChange={setShowUploadDialog}
        campusId={selectedCampus}
      />
    </div>
  );
}

// Campus Maps Tab Component
function CampusMapsTab({ campusId }: { campusId: string }) {
  const { data: campusMaps = [], isLoading } = useQuery({
    queryKey: [`/api/campus-maps/${campusId}`],
    enabled: !!campusId,
  });

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>Campus Maps</CardTitle>
          <CardDescription>
            Upload and manage SVG floor plan maps for this campus. These maps will be used for polygon drawing and interactive displays.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-sm text-muted-foreground">Loading maps...</div>
            </div>
          ) : campusMaps.length === 0 ? (
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-12 text-center">
              <Upload className="h-12 w-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-base font-medium text-slate-700 mb-2">
                No maps uploaded yet
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Upload an SVG floor plan to get started with unit mapping
              </p>
              <Button variant="outline" data-testid="button-upload-first-map">
                <Upload className="h-4 w-4 mr-2" />
                Upload SVG Map
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-6">
              {campusMaps.map((map: any) => (
                <Card key={map.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="aspect-video bg-slate-100 rounded mb-3 flex items-center justify-center">
                      <Map className="h-8 w-8 text-slate-400" />
                    </div>
                    <h4 className="font-medium text-sm mb-1">{map.name}</h4>
                    <p className="text-xs text-muted-foreground">
                      {map.width} × {map.height} • {map.isPublished ? 'Published' : 'Draft'}
                    </p>
                    <div className="flex gap-2 mt-3">
                      <Button variant="outline" size="sm" className="flex-1" data-testid={`button-edit-map-${map.id}`}>
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1" data-testid={`button-delete-map-${map.id}`}>
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Floor Plan Templates Tab Component
function FloorPlanTemplatesTab({ campusId }: { campusId: string }) {
  const { data: floorPlans = [], isLoading } = useQuery({
    queryKey: [`/api/floor-plans/${campusId}`],
    enabled: !!campusId,
  });

  return (
    <div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Floor Plan Templates</CardTitle>
              <CardDescription>
                Create and manage reusable floor plan templates (e.g., "1BR Sycamore", "2BR Maple") with photos and specifications
              </CardDescription>
            </div>
            <Button variant="outline" data-testid="button-create-template">
              <LayoutTemplate className="h-4 w-4 mr-2" />
              Create Template
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-sm text-muted-foreground">Loading templates...</div>
            </div>
          ) : floorPlans.length === 0 ? (
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-12 text-center">
              <LayoutTemplate className="h-12 w-12 text-slate-400 mx-auto mb-4" />
              <h3 className="text-base font-medium text-slate-700 mb-2">
                No floor plan templates
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create templates to define room types with photos, dimensions, and amenities
              </p>
              <Button variant="outline" data-testid="button-create-first-template">
                <LayoutTemplate className="h-4 w-4 mr-2" />
                Create First Template
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-6">
              {floorPlans.map((plan: any) => (
                <Card key={plan.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="aspect-video bg-slate-100 rounded mb-3 flex items-center justify-center">
                      <LayoutTemplate className="h-8 w-8 text-slate-400" />
                    </div>
                    <h4 className="font-medium text-sm mb-1">{plan.name}</h4>
                    <p className="text-xs text-muted-foreground mb-2">
                      {plan.bedrooms}BR / {plan.bathrooms}BA • {plan.sqft} sq ft
                    </p>
                    <p className="text-xs text-slate-600 line-clamp-2">
                      {plan.description || 'No description'}
                    </p>
                    <div className="flex gap-2 mt-3">
                      <Button variant="outline" size="sm" className="flex-1" data-testid={`button-edit-template-${plan.id}`}>
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1" data-testid={`button-delete-template-${plan.id}`}>
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Unit Mapping Tab Component
function UnitMappingTab({ campusId }: { campusId: string }) {
  const { data: campusMap } = useQuery({
    queryKey: [`/api/campus-maps/${campusId}`],
    enabled: !!campusId,
  });

  const { data: polygons = [] } = useQuery({
    queryKey: [`/api/unit-polygons/${campusId}`],
    enabled: !!campusId && !!campusMap,
  });

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Canvas Area (60%) */}
      <div className="col-span-2">
        <Card className="h-[700px]">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Interactive Canvas</CardTitle>
          </CardHeader>
          <CardContent className="p-0 h-full">
            <div className="w-full h-full bg-slate-50 flex items-center justify-center">
              <div className="text-center">
                <PenTool className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                <p className="text-sm text-muted-foreground">
                  Canvas will be implemented in next task
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Draw polygons, link to units, and manage floor plan overlays
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tool Palette & Controls (40%) */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Drawing Tools</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" size="sm" className="flex-col h-auto py-3" data-testid="tool-select">
                <span className="text-2xl mb-1">↖</span>
                <span className="text-xs">Select</span>
              </Button>
              <Button variant="outline" size="sm" className="flex-col h-auto py-3" data-testid="tool-polygon">
                <PenTool className="h-5 w-5 mb-1" />
                <span className="text-xs">Polygon</span>
              </Button>
              <Button variant="outline" size="sm" className="flex-col h-auto py-3" data-testid="tool-pan">
                <span className="text-2xl mb-1">✋</span>
                <span className="text-xs">Pan</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Polygon List</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground text-center py-8">
              {polygons.length === 0 ? 'No polygons drawn yet' : `${polygons.length} polygons`}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
