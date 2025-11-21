import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Map, LayoutTemplate, PenTool, Building2, ArrowLeft, Settings } from "lucide-react";
import SVGUploadDialog from "@/components/floor-plans/SVGUploadDialog";
import InteractiveFloorPlanViewer from "@/components/floor-plans/InteractiveFloorPlanViewer";

export default function FloorPlansPage() {
  const [selectedCampus, setSelectedCampus] = useState<string>("");
  const [bedroomsFilter, setBedroomsFilter] = useState<string>("any");
  const [floorPlanFilter, setFloorPlanFilter] = useState<string>("any");
  const [, setLocation] = useLocation();

  // Fetch locations for campus selector
  const { data: locationsData } = useQuery({
    queryKey: ['/api/locations'],
  });

  // Auto-select first campus when locations load
  useEffect(() => {
    const locations = locationsData?.locations || [];
    if (locations.length > 0 && !selectedCampus) {
      setSelectedCampus(locations[0].id);
    }
  }, [locationsData, selectedCampus]);
  
  // Fetch floor plans for filters
  const { data: floorPlans = [] } = useQuery({
    queryKey: [`/api/floor-plans/${selectedCampus}`],
    enabled: !!selectedCampus,
  });

  // Fetch rent roll data for the selected campus
  const { data: rentRollData = [] } = useQuery({
    queryKey: [`/api/rent-roll-data/location/${selectedCampus}`],
    enabled: !!selectedCampus,
  });
  
  const locations = locationsData?.locations || [];

  // Filter units based on selected filters
  const filteredUnits = rentRollData.filter((unit: any) => {
    if (bedroomsFilter !== "any") {
      const size = unit.size || '';
      const unitBedrooms = 
        size.includes('Companion') ? '0' :
        size.includes('Studio') ? '0' : 
        size.includes('One Bedroom') ? '1' :
        size.includes('Two Bedroom') ? '2' : '0';
      if (unitBedrooms !== bedroomsFilter) return false;
    }
    if (floorPlanFilter !== "any") {
      if (unit.size !== floorPlanFilter) return false;
    }
    return true;
  });

  const handleResetFilters = () => {
    setBedroomsFilter("any");
    setFloorPlanFilter("any");
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-screen-2xl mx-auto px-4 md:px-8 py-4">
          {/* Desktop Header */}
          <div className="hidden md:flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setLocation('/')}
              className="hover:bg-slate-100"
              data-testid="button-back"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div className="border-l pl-4">
              <h1 className="text-xl font-normal text-gray-900">
                Floor Plans
              </h1>
            </div>
            <div className="ml-auto flex items-center gap-3">
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
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setLocation(selectedCampus ? `/floor-plans-admin?campus=${selectedCampus}` : '/floor-plans-admin')}
                className="hover:bg-slate-100"
                data-testid="button-admin"
              >
                <Settings className="h-4 w-4 mr-2" />
                Admin
              </Button>
            </div>
          </div>

          {/* Mobile Header */}
          <div className="md:hidden space-y-3">
            <div className="flex items-center justify-between">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setLocation('/')}
                className="hover:bg-slate-100 -ml-2"
                data-testid="button-back-mobile"
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <h1 className="text-lg font-normal text-gray-900">
                Floor Plans
              </h1>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setLocation(selectedCampus ? `/floor-plans-admin?campus=${selectedCampus}` : '/floor-plans-admin')}
                className="hover:bg-slate-100"
                data-testid="button-admin-mobile"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
            <Select value={selectedCampus} onValueChange={setSelectedCampus}>
              <SelectTrigger className="w-full" data-testid="select-campus-mobile">
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

      {/* Filter Bar */}
      {selectedCampus && (
        <div className="bg-[#1e3a5f] text-white">
          <div className="max-w-screen-2xl mx-auto px-8 py-4">
            <div className="grid grid-cols-5 gap-4 items-end">
              <div>
                <label className="block text-xs uppercase mb-2 font-medium">Bedrooms</label>
                <Select value={bedroomsFilter} onValueChange={setBedroomsFilter}>
                  <SelectTrigger className="bg-white text-slate-900" data-testid="filter-bedrooms">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="0">Studio</SelectItem>
                    <SelectItem value="1">1 Bedroom</SelectItem>
                    <SelectItem value="2">2 Bedroom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-xs uppercase mb-2 font-medium">Floor Plan</label>
                <Select value={floorPlanFilter} onValueChange={setFloorPlanFilter}>
                  <SelectTrigger className="bg-white text-slate-900" data-testid="filter-floor-plan">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    {Array.from(new Set(rentRollData.map((u: any) => u.size).filter(Boolean))).map((size: any) => (
                      <SelectItem key={size} value={size}>{size}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-xs uppercase mb-2 font-medium">Square Footage</label>
                <Select value="any" disabled>
                  <SelectTrigger className="bg-white text-slate-900" data-testid="filter-sqft">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-xs uppercase mb-2 font-medium">Care Level</label>
                <Select value="any" disabled>
                  <SelectTrigger className="bg-white text-slate-900" data-testid="filter-care-level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="al">Assisted Living</SelectItem>
                    <SelectItem value="mc">Memory Care</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Button 
                  variant="secondary"
                  onClick={handleResetFilters}
                  className="w-full"
                  data-testid="button-reset-filters"
                >
                  RESET
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content - Split View */}
      {!selectedCampus ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Map className="h-16 w-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-700 mb-2">
              No Campus Selected
            </h3>
            <p className="text-sm text-muted-foreground">
              Select a campus from the dropdown above to view floor plans
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Map View - Takes full width on mobile, 60% on desktop */}
          <div className="flex-1 relative min-h-[500px] md:min-h-0">
            <CampusMapView campusId={selectedCampus} />
          </div>

          {/* Results Panel - Below map on mobile, right side on desktop */}
          <div className="w-full md:w-96 bg-white md:border-l overflow-y-auto max-h-[50vh] md:max-h-none">
            <div className="p-4 md:p-6">
              <h2 className="text-xl md:text-2xl font-light mb-1">
                {filteredUnits.length} <span className="uppercase text-sm md:text-base tracking-wide">MATCHES</span>
              </h2>
              <div className="mt-4 md:mt-6 space-y-3 md:space-y-4">
                {filteredUnits.slice(0, 20).map((unit: any) => (
                  <Card key={unit.id} className="hover:shadow-md transition-shadow cursor-pointer" data-testid={`unit-card-${unit.roomNumber}`}>
                    <CardContent className="p-3 md:p-4">
                      <h3 className="font-semibold text-sm md:text-base mb-1">
                        UNIT {unit.roomNumber}
                      </h3>
                      <p className="text-xs text-slate-600 uppercase mb-2">
                        {unit.serviceLine} - {unit.careLevel}
                      </p>
                      <p className="text-xs md:text-sm text-slate-700 mb-1">
                        {unit.size}
                      </p>
                      <p className="text-sm font-medium text-[var(--trilogy-teal)]">
                        ${unit.streetRate.toLocaleString()}/month
                      </p>
                      {!unit.occupiedYN && (
                        <p className="text-xs text-green-600 mt-2">Available</p>
                      )}
                      {unit.occupiedYN && (
                        <p className="text-xs text-slate-500 mt-2">Reserved</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Campus Map View Component
function CampusMapView({ campusId }: { campusId: string }) {
  const { data: result, isLoading } = useQuery({
    queryKey: [`/api/campus-maps/${campusId}`],
  });

  const campusMap = result?.campusMap;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-100">
        <div className="text-center">
          <div className="animate-spin">
            <Map className="h-12 w-12 text-slate-400 mx-auto" />
          </div>
          <p className="text-sm text-muted-foreground mt-2">Loading floor plan...</p>
        </div>
      </div>
    );
  }

  if (!campusMap) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-100">
        <div className="text-center">
          <Map className="h-16 w-16 text-slate-300 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">No campus map available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      <InteractiveFloorPlanViewer campusMap={campusMap} />
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
