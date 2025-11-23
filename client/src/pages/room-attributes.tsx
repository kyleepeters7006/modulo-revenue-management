import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import Navigation from "@/components/navigation";
import AttributeManagement from "@/components/attribute-management";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { DollarSign, Home, Layers, TrendingUp, Eye, Check, X, AlertCircle, TrendingDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface RoomTypePrice {
  roomType: string;
  basePrice: number;
  serviceLine: string;
}

interface UnitWithAttributes {
  id: string;
  location: string;
  serviceLine: string;
  roomNumber: string;
  roomType: string;
  sizeRating?: string;
  viewRating?: string;
  renovationRating?: string;
  locationRating?: string;
  amenityRating?: string;
  streetRate: number;
  inHouseRate: number;
}

interface AttributeRating {
  id: string;
  attributeType: string;
  ratingLevel: string;
  adjustmentPercent: number;
  description?: string;
}

export default function RoomAttributes() {
  const { toast } = useToast();
  const [selectedServiceLine, setSelectedServiceLine] = useState<string>("All");
  const [selectedLocation, setSelectedLocation] = useState<string>("All");
  const [editingRoomType, setEditingRoomType] = useState<string | null>(null);
  const [newBasePrice, setNewBasePrice] = useState<string>("");
  
  // Issue #3 fix: State for attribute weight management workflow
  const [proposedRatings, setProposedRatings] = useState<AttributeRating[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);

  // Fetch rent roll data for units
  const { data: rentRollData = [] } = useQuery<UnitWithAttributes[]>({
    queryKey: ['/api/rent-roll'],
  });

  // Fetch attribute ratings
  const { data: attributeRatings = [], refetch: refetchRatings } = useQuery<AttributeRating[]>({
    queryKey: ['/api/attribute-ratings'],
  });

  // Fetch locations
  const { data: locationsData } = useQuery({
    queryKey: ['/api/locations'],
  });
  
  const locations = (locationsData as any)?.locations || [];
  
  // Issue #3 fix: Fetch attribute configuration status
  const { data: attributeStatus } = useQuery({
    queryKey: ['/api/attribute-ratings/status'],
  });
  
  // Issue #3 fix: Mutation to preview attribute weight changes
  const previewMutation = useMutation({
    mutationFn: async (ratings: AttributeRating[]) => {
      return await apiRequest('/api/attribute-ratings/preview', {
        method: 'POST',
        body: JSON.stringify({ proposedRatings: ratings }),
      });
    },
    onSuccess: (data) => {
      setPreviewData(data);
      setShowPreview(true);
    },
    onError: (error) => {
      toast({
        title: "Preview Failed",
        description: "Failed to preview attribute weight changes",
        variant: "destructive",
      });
    }
  });
  
  // Issue #3 fix: Mutation to accept attribute weight changes
  const acceptMutation = useMutation({
    mutationFn: async (ratings: AttributeRating[]) => {
      return await apiRequest('/api/attribute-ratings/accept', {
        method: 'POST',
        body: JSON.stringify({ proposedRatings: ratings }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Changes Accepted",
        description: "Attribute weights have been updated and pricing cache refreshed",
        variant: "default",
      });
      setProposedRatings([]);
      setShowPreview(false);
      setIsEditing(false);
      refetchRatings();
      queryClient.invalidateQueries({ queryKey: ['/api/rent-roll'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
    },
    onError: (error) => {
      toast({
        title: "Update Failed",
        description: "Failed to accept attribute weight changes",
        variant: "destructive",
      });
    }
  });

  // Get unique service lines
  const serviceLines = Array.from(new Set(rentRollData.map(unit => unit.serviceLine))).filter(Boolean).sort();
  
  // Get unique room types
  const roomTypes = Array.from(new Set(rentRollData.map(unit => unit.roomType))).filter(Boolean).sort();

  // Calculate attributed price for a unit based on its ratings
  const calculateAttributedPrice = (unit: UnitWithAttributes): number => {
    let price = unit.streetRate || 0;
    
    const attributeTypes = ['size', 'view', 'renovation', 'location', 'amenity'];
    
    attributeTypes.forEach(type => {
      const ratingKey = `${type}Rating` as keyof UnitWithAttributes;
      const rating = unit[ratingKey] as string | undefined;
      
      if (rating) {
        const ratingConfig = attributeRatings.find(
          r => r.attributeType === type && r.ratingLevel === rating
        );
        
        if (ratingConfig) {
          price = price * (1 + ratingConfig.adjustmentPercent / 100);
        }
      }
    });
    
    return Math.round(price * 100) / 100; // Round to 2 decimal places
  };

  // Filter units based on selections (used for both room type pricing and unit-level table)
  // For senior housing (AL, IL, SL, AL/MC): exclude B beds (rooms ending with "/B")
  // For HC: include both A and B beds
  const seniorHousingServiceLines = ['AL', 'IL', 'SL', 'AL/MC'];
  const filteredUnits = rentRollData.filter(unit => {
    if (selectedServiceLine !== "All" && unit.serviceLine !== selectedServiceLine) return false;
    if (selectedLocation !== "All" && unit.location !== selectedLocation) return false;
    
    // Exclude B beds for senior housing service lines
    const isSeniorHousing = seniorHousingServiceLines.includes(unit.serviceLine);
    const isBBed = unit.roomNumber?.endsWith('/B');
    if (isSeniorHousing && isBBed) return false;
    
    return true;
  });

  // Get unique room types from filtered data
  const filteredRoomTypes = Array.from(new Set(filteredUnits.map(unit => unit.roomType))).filter(Boolean).sort();

  // Group units by room type and calculate average attributed price (using filtered data)
  const roomTypePricing = filteredRoomTypes.map(roomType => {
    const unitsOfType = filteredUnits.filter(unit => unit.roomType === roomType);
    const avgBasePrice = unitsOfType.reduce((sum, u) => sum + (u.streetRate || 0), 0) / unitsOfType.length || 0;
    const avgAttributedPrice = unitsOfType.reduce((sum, u) => sum + calculateAttributedPrice(u), 0) / unitsOfType.length || 0;
    
    return {
      roomType,
      count: unitsOfType.length,
      avgBasePrice: Math.round(avgBasePrice),
      avgAttributedPrice: Math.round(avgAttributedPrice),
      lift: avgAttributedPrice > 0 && avgBasePrice > 0 ? ((avgAttributedPrice - avgBasePrice) / avgBasePrice * 100).toFixed(1) : '0.0'
    };
  });

  return (
    <div className="min-h-screen bg-[var(--dashboard-background)]">
      <Navigation />
      
      <div className="container mx-auto px-4 py-6 sm:px-6 lg:px-8 max-w-[1920px]">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold mb-2 text-[var(--trilogy-dark-blue)]">
                Room Attributes & Pricing
              </h1>
              <p className="text-[var(--dashboard-text-secondary)]">
                Configure attribute ratings and manage base pricing by room type with attributed pricing calculations
              </p>
            </div>
            
            {/* Campus Selector */}
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium whitespace-nowrap">Campus:</Label>
              <Select 
                value={selectedLocation} 
                onValueChange={setSelectedLocation}
              >
                <SelectTrigger className="w-[280px]" data-testid="select-campus">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Campuses</SelectItem>
                  {Array.isArray(locations) && locations.map((loc: any) => (
                    <SelectItem key={loc.id} value={loc.name || loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Base Pricing by Room Type */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Home className="h-5 w-5" />
                <span>Base Pricing by Room Type</span>
              </CardTitle>
              <CardDescription>
                {selectedLocation === "All" 
                  ? "View average pricing and attribute lift across all room types for all campuses"
                  : `View average pricing and attribute lift across all room types for ${selectedLocation}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Room Type</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Avg. Base Price</TableHead>
                    <TableHead className="text-right">Avg. Attributed Price</TableHead>
                    <TableHead className="text-right">Price Lift</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roomTypePricing.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                        No room data available
                      </TableCell>
                    </TableRow>
                  ) : (
                    roomTypePricing.map(({ roomType, count, avgBasePrice, avgAttributedPrice, lift }) => (
                      <TableRow key={roomType}>
                        <TableCell className="font-medium">{roomType || 'Unknown'}</TableCell>
                        <TableCell className="text-right">{count}</TableCell>
                        <TableCell className="text-right font-mono">
                          ${avgBasePrice.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-green-600">
                          ${avgAttributedPrice.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge 
                            variant={parseFloat(lift) > 5 ? "default" : "secondary"}
                            className={parseFloat(lift) > 5 ? "bg-green-600" : ""}
                          >
                            +{lift}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Attribute Management Section */}
          <AttributeManagement />
          
          {/* Issue #3 fix: Attribute Weight Management Workflow */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <TrendingUp className="h-5 w-5" />
                  <span>Attribute Weight Management</span>
                </div>
                {!isEditing && (
                  <Button 
                    onClick={() => {
                      setIsEditing(true);
                      setProposedRatings(attributeRatings);
                    }}
                    variant="outline"
                  >
                    Propose New Weights
                  </Button>
                )}
              </CardTitle>
              <CardDescription>
                {isEditing 
                  ? "Adjust attribute weights and preview their impact before applying"
                  : "Configure pricing adjustments for each attribute rating level"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Status Alert */}
              {attributeStatus && (
                <Alert className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="flex justify-between">
                      <span>
                        <strong>Coverage:</strong> {Math.round((attributeStatus as any).summary?.overallCoverage || 0)}% of units have attributes configured
                      </span>
                      <span>
                        <strong>Locations with Attributes:</strong> {(attributeStatus as any).summary?.locationsWithAttributes || 0}/{(attributeStatus as any).summary?.totalLocations || 0}
                      </span>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              
              {isEditing ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    {['location', 'size', 'view', 'renovation', 'amenity'].map(attrType => (
                      <div key={attrType} className="border rounded-lg p-4">
                        <h4 className="font-medium capitalize mb-3">{attrType}</h4>
                        {['A', 'B', 'C'].map(level => {
                          const currentRating = proposedRatings.find(
                            r => r.attributeType === attrType && r.ratingLevel === level
                          );
                          return (
                            <div key={level} className="flex items-center gap-2 mb-2">
                              <Badge className={getRatingColor(level)} variant="outline">
                                {level}
                              </Badge>
                              <Input
                                type="number"
                                className="w-20"
                                value={currentRating?.adjustmentPercent || 0}
                                onChange={(e) => {
                                  const newValue = parseFloat(e.target.value) || 0;
                                  setProposedRatings(prev => {
                                    const updated = [...prev];
                                    const idx = updated.findIndex(
                                      r => r.attributeType === attrType && r.ratingLevel === level
                                    );
                                    if (idx >= 0) {
                                      updated[idx] = { ...updated[idx], adjustmentPercent: newValue };
                                    }
                                    return updated;
                                  });
                                }}
                              />
                              <span className="text-sm text-gray-500">%</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsEditing(false);
                        setProposedRatings([]);
                      }}
                    >
                      <X className="h-4 w-4 mr-2" />
                      Cancel
                    </Button>
                    <Button
                      onClick={() => previewMutation.mutate(proposedRatings)}
                      disabled={previewMutation.isPending}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Preview Impact
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Attribute Type</TableHead>
                        <TableHead className="text-center">Rating A</TableHead>
                        <TableHead className="text-center">Rating B</TableHead>
                        <TableHead className="text-center">Rating C</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {['location', 'size', 'view', 'renovation', 'amenity'].map(attrType => (
                        <TableRow key={attrType}>
                          <TableCell className="font-medium capitalize">{attrType}</TableCell>
                          {['A', 'B', 'C'].map(level => {
                            const rating = attributeRatings.find(
                              r => r.attributeType === attrType && r.ratingLevel === level
                            );
                            return (
                              <TableCell key={level} className="text-center">
                                <Badge variant="secondary">
                                  {rating ? `+${rating.adjustmentPercent}%` : '0%'}
                                </Badge>
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* Preview Dialog */}
          <Dialog open={showPreview} onOpenChange={setShowPreview}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Preview Attribute Weight Changes</DialogTitle>
                <DialogDescription>
                  Review the impact of your proposed changes before applying them
                </DialogDescription>
              </DialogHeader>
              
              {previewData && (
                <div className="space-y-4">
                  <Alert>
                    <TrendingUp className="h-4 w-4" />
                    <AlertDescription>
                      <div className="grid grid-cols-2 gap-4 mt-2">
                        <div>
                          <span className="font-medium">Units Analyzed:</span> {previewData.summary.unitsAnalyzed}
                        </div>
                        <div>
                          <span className="font-medium">Avg Change:</span>{" "}
                          <span className={previewData.summary.avgChangePercent > 0 ? "text-green-600" : "text-red-600"}>
                            {previewData.summary.avgChangePercent > 0 ? "+" : ""}{previewData.summary.avgChangePercent}%
                          </span>
                        </div>
                        <div>
                          <span className="font-medium">Total Revenue Impact:</span>{" "}
                          <span className={previewData.summary.totalChangeAmount > 0 ? "text-green-600" : "text-red-600"}>
                            {previewData.summary.totalChangeAmount > 0 ? "+" : ""}${previewData.summary.totalChangeAmount.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                  
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Room</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Current Rate</TableHead>
                          <TableHead className="text-right">Proposed Rate</TableHead>
                          <TableHead className="text-right">Change</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewData.previews.slice(0, 10).map((preview: any) => (
                          <TableRow key={preview.unitId}>
                            <TableCell>{preview.roomNumber}</TableCell>
                            <TableCell>{preview.location}</TableCell>
                            <TableCell>{preview.roomType}</TableCell>
                            <TableCell className="text-right font-mono">
                              ${preview.currentAttributedRate.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              ${preview.proposedAttributedRate.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={preview.changePercent > 0 ? "text-green-600" : "text-red-600"}>
                                {preview.changePercent > 0 ? "+" : ""}{preview.changePercent}%
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {previewData.previews.length > 10 && (
                      <div className="p-4 text-center text-sm text-gray-500 border-t">
                        Showing 10 of {previewData.previews.length} affected units
                      </div>
                    )}
                  </div>
                  
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowPreview(false);
                        setPreviewData(null);
                      }}
                    >
                      <X className="h-4 w-4 mr-2" />
                      Reject Changes
                    </Button>
                    <Button
                      variant="default"
                      onClick={() => acceptMutation.mutate(proposedRatings)}
                      disabled={acceptMutation.isPending}
                    >
                      <Check className="h-4 w-4 mr-2" />
                      Accept Changes
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* Unit-Level Detail */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Layers className="h-5 w-5" />
                  <span>Unit-Level Attributed Pricing</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-normal">Service Line:</Label>
                  <Select 
                    value={selectedServiceLine} 
                    onValueChange={setSelectedServiceLine}
                  >
                    <SelectTrigger className="w-[180px]" data-testid="select-serviceline-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All Service Lines</SelectItem>
                      {serviceLines.map(sl => (
                        <SelectItem key={sl} value={sl}>{sl}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardTitle>
              <CardDescription>
                View individual units with their attribute ratings and calculated attributed prices
                {selectedLocation !== "All" && ` for ${selectedLocation}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Location</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Service Line</TableHead>
                      <TableHead className="text-center">Size</TableHead>
                      <TableHead className="text-center">View</TableHead>
                      <TableHead className="text-center">Reno.</TableHead>
                      <TableHead className="text-center">Loc.</TableHead>
                      <TableHead className="text-center">Amen.</TableHead>
                      <TableHead className="text-right">Current Rate</TableHead>
                      <TableHead className="text-right">Attributed Price</TableHead>
                      <TableHead className="text-right">Difference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUnits.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center py-8 text-gray-500">
                          No units match the selected filters
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredUnits.slice(0, 100).map(unit => {
                        const attributedPrice = calculateAttributedPrice(unit);
                        const difference = attributedPrice - unit.streetRate;
                        const percentDiff = unit.streetRate > 0 ? (difference / unit.streetRate * 100) : 0;
                        
                        return (
                          <TableRow key={unit.id}>
                            <TableCell className="text-sm">{unit.location}</TableCell>
                            <TableCell className="font-medium">{unit.roomNumber}</TableCell>
                            <TableCell className="text-sm">{unit.roomType}</TableCell>
                            <TableCell className="text-sm">{unit.serviceLine}</TableCell>
                            <TableCell className="text-center">
                              {unit.sizeRating ? (
                                <Badge className={getRatingColor(unit.sizeRating)} variant="outline">
                                  {unit.sizeRating}
                                </Badge>
                              ) : '-'}
                            </TableCell>
                            <TableCell className="text-center">
                              {unit.viewRating ? (
                                <Badge className={getRatingColor(unit.viewRating)} variant="outline">
                                  {unit.viewRating}
                                </Badge>
                              ) : '-'}
                            </TableCell>
                            <TableCell className="text-center">
                              {unit.renovationRating ? (
                                <Badge className={getRatingColor(unit.renovationRating)} variant="outline">
                                  {unit.renovationRating}
                                </Badge>
                              ) : '-'}
                            </TableCell>
                            <TableCell className="text-center">
                              {unit.locationRating ? (
                                <Badge className={getRatingColor(unit.locationRating)} variant="outline">
                                  {unit.locationRating}
                                </Badge>
                              ) : '-'}
                            </TableCell>
                            <TableCell className="text-center">
                              {unit.amenityRating ? (
                                <Badge className={getRatingColor(unit.amenityRating)} variant="outline">
                                  {unit.amenityRating}
                                </Badge>
                              ) : '-'}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              ${unit.streetRate.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right font-mono text-green-600 font-semibold">
                              ${attributedPrice.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-col items-end">
                                <span className={difference > 0 ? "text-green-600" : difference < 0 ? "text-red-600" : "text-gray-500"}>
                                  {difference > 0 ? '+' : ''}${Math.round(difference).toLocaleString()}
                                </span>
                                <span className="text-xs text-gray-500">
                                  ({percentDiff > 0 ? '+' : ''}{percentDiff.toFixed(1)}%)
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
                {filteredUnits.length > 100 && (
                  <div className="p-4 text-center text-sm text-gray-500 border-t">
                    Showing first 100 of {filteredUnits.length} units
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Helper function for rating badge colors
function getRatingColor(rating: string): string {
  switch (rating?.toUpperCase()) {
    case 'A':
      return 'border-green-500 text-green-700 bg-green-50';
    case 'B':
      return 'border-yellow-500 text-yellow-700 bg-yellow-50';
    case 'C':
      return 'border-gray-500 text-gray-700 bg-gray-50';
    default:
      return 'border-gray-300 text-gray-600 bg-gray-50';
  }
}
