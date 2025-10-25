import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Map, LayoutTemplate, PenTool, Building2 } from "lucide-react";
import SVGUploadDialog from "@/components/floor-plans/SVGUploadDialog";
import InteractiveFloorPlanViewer from "@/components/floor-plans/InteractiveFloorPlanViewer";

export default function FloorPlansPage() {
  const [selectedCampus, setSelectedCampus] = useState<string>("");
  const [activeTab, setActiveTab] = useState("maps");
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  // Fetch locations for campus selector
  const { data: locationsData } = useQuery({
    queryKey: ['/api/locations'],
  });
  
  const locations = locationsData?.locations || [];

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
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  
  const { data: campusMaps = [], isLoading } = useQuery({
    queryKey: [`/api/campus-maps/${campusId}`],
    enabled: !!campusId,
  });

  const selectedMap = campusMaps.find((map: any) => map.id === selectedMapId);

  // Auto-select first map if available
  useEffect(() => {
    if (campusMaps.length > 0 && !selectedMapId) {
      setSelectedMapId(campusMaps[0].id);
    }
  }, [campusMaps, selectedMapId]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-sm text-muted-foreground">Loading maps...</div>
        </CardContent>
      </Card>
    );
  }

  if (campusMaps.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Campus Maps</CardTitle>
          <CardDescription>
            Upload and manage SVG floor plan maps for this campus. These maps will be used for polygon drawing and interactive displays.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    );
  }

  // If there's only one map, use it directly. Otherwise show selector
  if (campusMaps.length === 1) {
    return <InteractiveFloorPlanViewer campusMap={campusMaps[0]} />;
  }

  return (
    <div className="grid grid-cols-4 gap-6">
      {/* Sidebar with map list */}
      <div className="col-span-1 space-y-3">
        <h3 className="text-sm font-medium text-slate-700 mb-3">Available Maps</h3>
        {campusMaps.map((map: any) => (
          <Card 
            key={map.id} 
            className={`cursor-pointer transition-all ${
              selectedMapId === map.id 
                ? 'border-[var(--trilogy-teal)] bg-teal-50 shadow-md' 
                : 'hover:border-slate-400'
            }`}
            onClick={() => setSelectedMapId(map.id)}
            data-testid={`map-selector-${map.id}`}
          >
            <CardContent className="p-3">
              <div className="flex items-start gap-2">
                <Map className="h-5 w-5 text-[var(--trilogy-teal)] mt-0.5" />
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-sm truncate">{map.name}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {map.width} × {map.height}
                  </p>
                  {map.isPublished && (
                    <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">
                      Published
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main viewer */}
      <div className="col-span-3">
        {selectedMap ? (
          <InteractiveFloorPlanViewer campusMap={selectedMap} />
        ) : (
          <Card>
            <CardContent className="flex items-center justify-center py-20 text-muted-foreground">
              <div className="text-center">
                <Map className="h-12 w-12 mx-auto mb-2" />
                <p>Select a map from the list to view</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// Floor Plan Templates Tab Component - Four Seasons Style
function FloorPlanTemplatesTab({ campusId }: { campusId: string }) {
  const [selectedBedrooms, setSelectedBedrooms] = useState<string>("all");
  
  const { data: floorPlans = [], isLoading } = useQuery({
    queryKey: [`/api/floor-plans/${campusId}`],
    enabled: !!campusId,
  });

  const filteredPlans = selectedBedrooms === "all" 
    ? floorPlans 
    : floorPlans.filter((plan: any) => plan.bedrooms.toString() === selectedBedrooms);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-muted-foreground">Loading floor plans...</div>
      </div>
    );
  }

  if (floorPlans.length === 0) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <LayoutTemplate className="h-16 w-16 text-slate-300 mx-auto mb-6" />
        <h3 className="text-2xl font-light text-slate-800 mb-3">
          No Floor Plans Available
        </h3>
        <p className="text-slate-600 mb-6">
          Floor plan templates will be displayed here once created
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white">
      {/* Hero Section */}
      <div className="text-center py-12 border-b">
        <h2 className="text-4xl font-light text-slate-800 mb-3">
          Floor Plans
        </h2>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto">
          Discover our thoughtfully designed living spaces, each crafted to provide comfort, elegance, and the highest quality of life.
        </p>
      </div>

      {/* Filter Bar */}
      <div className="border-b bg-slate-50">
        <div className="max-w-7xl mx-auto px-8 py-6">
          <div className="flex items-center gap-6">
            <span className="text-sm font-medium text-slate-700">Filter by:</span>
            <div className="flex gap-2">
              <Button
                variant={selectedBedrooms === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedBedrooms("all")}
                className={selectedBedrooms === "all" ? "bg-[var(--trilogy-teal)]" : ""}
                data-testid="filter-all"
              >
                All Floor Plans
              </Button>
              <Button
                variant={selectedBedrooms === "0" ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedBedrooms("0")}
                className={selectedBedrooms === "0" ? "bg-[var(--trilogy-teal)]" : ""}
                data-testid="filter-studio"
              >
                Studio
              </Button>
              <Button
                variant={selectedBedrooms === "1" ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedBedrooms("1")}
                className={selectedBedrooms === "1" ? "bg-[var(--trilogy-teal)]" : ""}
                data-testid="filter-1br"
              >
                1 Bedroom
              </Button>
              <Button
                variant={selectedBedrooms === "2" ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedBedrooms("2")}
                className={selectedBedrooms === "2" ? "bg-[var(--trilogy-teal)]" : ""}
                data-testid="filter-2br"
              >
                2 Bedroom
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Floor Plans Grid */}
      <div className="max-w-7xl mx-auto px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredPlans.map((plan: any) => (
            <Card 
              key={plan.id} 
              className="group overflow-hidden border-0 shadow-lg hover:shadow-2xl transition-all duration-300 cursor-pointer"
              data-testid={`floor-plan-card-${plan.code}`}
            >
              {/* Floor Plan Image */}
              <div className="aspect-[4/3] bg-gradient-to-br from-slate-100 to-slate-200 overflow-hidden relative">
                {plan.imageUrl ? (
                  <img 
                    src={plan.imageUrl} 
                    alt={plan.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <LayoutTemplate className="h-20 w-20 text-slate-300" />
                  </div>
                )}
                {/* Service Line Badge */}
                <div className="absolute top-4 right-4 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-xs font-medium text-slate-700">
                  {plan.serviceLine || 'AL'}
                </div>
              </div>

              {/* Floor Plan Details */}
              <CardContent className="p-6">
                <h3 className="text-2xl font-light text-slate-800 mb-2">
                  {plan.name}
                </h3>
                
                {/* Specs */}
                <div className="flex items-center gap-4 mb-4 text-sm text-slate-600">
                  <span className="flex items-center gap-1">
                    <span className="font-medium">{plan.bedrooms === 0 ? 'Studio' : `${plan.bedrooms} Bedroom${plan.bedrooms > 1 ? 's' : ''}`}</span>
                  </span>
                  <span className="text-slate-300">•</span>
                  <span>{plan.bathrooms} Bath{plan.bathrooms > 1 ? 's' : ''}</span>
                  {plan.sqft && (
                    <>
                      <span className="text-slate-300">•</span>
                      <span>{plan.sqft.toLocaleString()} sq ft</span>
                    </>
                  )}
                </div>

                {/* Description */}
                <p className="text-sm text-slate-600 line-clamp-3 mb-4">
                  {plan.description}
                </p>

                {/* Amenities */}
                {plan.amenities && plan.amenities.length > 0 && (
                  <div className="border-t pt-4 mt-4">
                    <h4 className="text-xs font-medium text-slate-700 mb-2 uppercase tracking-wide">
                      Features
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {plan.amenities.slice(0, 3).map((amenity: string, idx: number) => (
                        <span 
                          key={idx}
                          className="inline-block px-2 py-1 bg-slate-100 text-xs text-slate-700 rounded"
                        >
                          {amenity}
                        </span>
                      ))}
                      {plan.amenities.length > 3 && (
                        <span className="inline-block px-2 py-1 text-xs text-slate-500">
                          +{plan.amenities.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* CTA */}
                <Button 
                  className="w-full mt-4 bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/90"
                  data-testid={`button-view-details-${plan.code}`}
                >
                  View Details
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredPlans.length === 0 && (
          <div className="text-center py-20">
            <p className="text-slate-500">No floor plans match your criteria</p>
          </div>
        )}
      </div>
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
