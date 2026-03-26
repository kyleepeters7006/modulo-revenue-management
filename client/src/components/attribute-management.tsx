import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Settings, Save, Eye, TrendingUp, AlertCircle, Check, X } from "lucide-react";

interface AttributeRating {
  id: string;
  attributeType: string;
  ratingLevel: string;
  adjustmentPercent: number;
  description?: string;
}

interface AttributeManagementProps {
  selectedLocations?: string[];
  selectedServiceLine?: string;
}

interface PreviewData {
  summary: {
    unitsAnalyzed: number;
    avgChangePercent: number;
    totalChangeAmount: number;
    affectedUnits: number;
  };
  byServiceLine?: Array<{
    serviceLine: string;
    count: number;
    avgChange: number;
  }>;
  topChanges?: Array<{
    location: string;
    roomNumber: string;
    currentPrice: number;
    newPrice: number;
    change: number;
  }>;
}

export default function AttributeManagement({ 
  selectedLocations = [], 
  selectedServiceLine = "All" 
}: AttributeManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingRating, setEditingRating] = useState<AttributeRating | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Map<string, AttributeRating>>(new Map());
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);

  const { data: attributeRatings = [], isLoading } = useQuery({
    queryKey: ['/api/attribute-ratings'],
    queryFn: async () => {
      const response = await fetch('/api/attribute-ratings');
      return response.json();
    }
  });

  const { data: attributeStatus } = useQuery({
    queryKey: ['/api/attribute-ratings/status'],
  });

  const initializeMutation = useMutation({
    mutationFn: () => apiRequest('/api/attribute-ratings/initialize', 'POST', {}),
    onSuccess: () => {
      toast({
        title: "Default ratings initialized",
        description: "Standard A/B/C attribute ratings have been created"
      });
      queryClient.invalidateQueries({ queryKey: ['/api/attribute-ratings'] });
    },
    onError: () => {
      toast({
        title: "Failed to initialize ratings",
        variant: "destructive"
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: (rating: Partial<AttributeRating>) => 
      apiRequest('/api/attribute-ratings', 'PUT', rating),
    onSuccess: () => {
      toast({
        title: "Rating updated",
        description: "Attribute rating has been saved"
      });
      queryClient.invalidateQueries({ queryKey: ['/api/attribute-ratings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rent-roll'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
      setEditingRating(null);
      setPendingChanges(new Map());
    }
  });

  const previewMutation = useMutation({
    mutationFn: async (proposedRatings: AttributeRating[]): Promise<PreviewData> => {
      const result = await apiRequest('/api/attribute-ratings/preview', 'POST', { 
        proposedRatings,
        filters: {
          locations: selectedLocations,
          serviceLine: selectedServiceLine
        }
      });
      return result as unknown as PreviewData;
    },
    onSuccess: (data: PreviewData) => {
      setPreviewData(data);
      setShowPreview(true);
    },
    onError: () => {
      toast({
        title: "Preview Failed",
        description: "Failed to preview attribute weight changes",
        variant: "destructive",
      });
    }
  });

  const acceptChangesMutation = useMutation({
    mutationFn: async (proposedRatings: AttributeRating[]) => {
      return await apiRequest('/api/attribute-ratings/accept', 'POST', { proposedRatings });
    },
    onSuccess: () => {
      toast({
        title: "Changes Applied",
        description: "Attribute weights have been updated and pricing cache refreshed",
        variant: "default",
      });
      setPendingChanges(new Map());
      setShowPreview(false);
      setEditingRating(null);
      queryClient.invalidateQueries({ queryKey: ['/api/attribute-ratings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rent-roll'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
    },
    onError: () => {
      toast({
        title: "Update Failed",
        description: "Failed to apply attribute weight changes",
        variant: "destructive",
      });
    }
  });

  const groupedRatings = (attributeRatings as AttributeRating[]).reduce((acc: Record<string, AttributeRating[]>, rating: AttributeRating) => {
    if (!acc[rating.attributeType]) {
      acc[rating.attributeType] = [];
    }
    acc[rating.attributeType].push(rating);
    return acc;
  }, {});

  Object.keys(groupedRatings).forEach(type => {
    groupedRatings[type].sort((a: AttributeRating, b: AttributeRating) => a.ratingLevel.localeCompare(b.ratingLevel));
  });

  const handleSaveEdit = (rating: AttributeRating) => {
    const key = `${rating.attributeType}-${rating.ratingLevel}`;
    setPendingChanges(prev => {
      const updated = new Map(prev);
      updated.set(key, rating);
      return updated;
    });
    setEditingRating(null);
  };

  const handleDirectSave = (rating: AttributeRating) => {
    updateMutation.mutate({
      attributeType: rating.attributeType,
      ratingLevel: rating.ratingLevel,
      adjustmentPercent: rating.adjustmentPercent,
      description: rating.description
    });
  };

  const handlePreviewChanges = () => {
    const allRatings = attributeRatings.map((r: AttributeRating) => {
      const key = `${r.attributeType}-${r.ratingLevel}`;
      return pendingChanges.get(key) || r;
    });
    previewMutation.mutate(allRatings);
  };

  const handleAcceptChanges = () => {
    const allRatings = attributeRatings.map((r: AttributeRating) => {
      const key = `${r.attributeType}-${r.ratingLevel}`;
      return pendingChanges.get(key) || r;
    });
    acceptChangesMutation.mutate(allRatings);
  };

  const handleCancelAllChanges = () => {
    setPendingChanges(new Map());
    setEditingRating(null);
  };

  const getRatingColor = (level: string) => {
    switch (level) {
      case 'A': return 'bg-green-100 text-green-800';
      case 'B': return 'bg-yellow-100 text-yellow-800';
      case 'C': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getDisplayRating = (rating: AttributeRating): AttributeRating => {
    const key = `${rating.attributeType}-${rating.ratingLevel}`;
    return pendingChanges.get(key) || rating;
  };

  const hasChanges = (rating: AttributeRating): boolean => {
    const key = `${rating.attributeType}-${rating.ratingLevel}`;
    return pendingChanges.has(key);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>Attribute Management</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (attributeRatings.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>Attribute Management</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">No attribute ratings configured</p>
            <Button 
              onClick={() => initializeMutation.mutate()}
              disabled={initializeMutation.isPending}
              data-testid="button-initialize-attributes"
            >
              Initialize Default A/B/C Ratings
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Settings className="h-5 w-5" />
              <span>Attribute Management</span>
            </div>
            <div className="flex items-center gap-2">
              {pendingChanges.size > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelAllChanges}
                    data-testid="button-cancel-changes"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel Changes
                  </Button>
                  <Button
                    size="sm"
                    onClick={handlePreviewChanges}
                    disabled={previewMutation.isPending}
                    data-testid="button-preview-impact"
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Preview Impact ({pendingChanges.size} changes)
                  </Button>
                </>
              )}
              <Button 
                variant="outline"
                size="sm"
                onClick={() => initializeMutation.mutate()}
                disabled={initializeMutation.isPending}
              >
                Reset to Defaults
              </Button>
            </div>
          </CardTitle>
          <CardDescription>
            Configure A/B/C ratings for each unit attribute. These percentages adjust the base pricing.
            {selectedLocations.length > 0 || selectedServiceLine !== "All" ? (
              <span className="text-blue-600 ml-2">
                Preview will use current filters ({selectedLocations.length > 0 ? `${selectedLocations.length} locations` : 'all locations'}, {selectedServiceLine === "All" ? 'all service lines' : selectedServiceLine})
              </span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {attributeStatus && typeof attributeStatus === 'object' && (
            <Alert className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="flex justify-between">
                  <span>
                    <strong>Coverage:</strong> {Math.round((attributeStatus as { summary?: { overallCoverage?: number } })?.summary?.overallCoverage || 0)}% of units have attributes configured
                  </span>
                  <span>
                    <strong>Locations with Attributes:</strong> {(attributeStatus as { summary?: { locationsWithAttributes?: number; totalLocations?: number } })?.summary?.locationsWithAttributes || 0}/{(attributeStatus as { summary?: { locationsWithAttributes?: number; totalLocations?: number } })?.summary?.totalLocations || 0}
                  </span>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Attribute</TableHead>
                <TableHead className="w-16">Rating</TableHead>
                <TableHead className="w-28">Adjustment %</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(groupedRatings).flatMap(([attributeType, ratings]: [string, AttributeRating[]], groupIdx) =>
                ratings.map((rating: AttributeRating, rowIdx: number) => {
                  const displayRating = getDisplayRating(rating);
                  const changed = hasChanges(rating);
                  const isFirstInGroup = rowIdx === 0;
                  const isLastInGroup = rowIdx === ratings.length - 1;

                  return (
                    <TableRow
                      key={`${rating.attributeType}-${rating.ratingLevel}`}
                      className={`${changed ? "bg-yellow-50 dark:bg-yellow-900/20" : ""} ${!isLastInGroup ? "border-b-0" : groupIdx < Object.keys(groupedRatings).length - 1 ? "border-b-2 border-muted" : ""}`}
                    >
                      <TableCell className="py-1.5 align-middle">
                        {isFirstInGroup && (
                          <span className="font-medium text-sm capitalize">{attributeType}</span>
                        )}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <div className="flex items-center gap-1">
                          <Badge className={`${getRatingColor(rating.ratingLevel)} text-xs px-1.5 py-0`}>
                            {rating.ratingLevel}
                          </Badge>
                          {changed && (
                            <Badge variant="outline" className="text-xs px-1 py-0 bg-yellow-100 border-yellow-400">
                              •
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-1.5">
                        {editingRating && editingRating.id === rating.id ? (
                          <Input
                            type="number"
                            value={editingRating.adjustmentPercent}
                            onChange={(e) => setEditingRating({
                              ...editingRating,
                              adjustmentPercent: parseFloat(e.target.value) || 0
                            })}
                            className="w-20 h-7 text-sm"
                            step="0.1"
                            data-testid={`input-adjustment-${rating.attributeType}-${rating.ratingLevel}`}
                          />
                        ) : (
                          <span className={`text-sm ${displayRating.adjustmentPercent > 0 ? "text-green-600" : displayRating.adjustmentPercent < 0 ? "text-red-600" : ""}`}>
                            {displayRating.adjustmentPercent > 0 ? '+' : ''}{displayRating.adjustmentPercent}%
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="py-1.5">
                        {editingRating && editingRating.id === rating.id ? (
                          <Input
                            value={editingRating.description || ''}
                            onChange={(e) => setEditingRating({
                              ...editingRating,
                              description: e.target.value
                            })}
                            className="h-7 text-sm"
                            data-testid={`textarea-description-${rating.attributeType}-${rating.ratingLevel}`}
                          />
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {displayRating.description || '—'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="py-1.5">
                        {editingRating && editingRating.id === rating.id ? (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => handleSaveEdit(editingRating)}
                              data-testid={`button-stage-${rating.attributeType}-${rating.ratingLevel}`}
                            >
                              <Check className="h-3 w-3 mr-1" />
                              Stage
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => setEditingRating(null)}
                              data-testid={`button-cancel-${rating.attributeType}-${rating.ratingLevel}`}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => setEditingRating({...displayRating, id: rating.id})}
                            data-testid={`button-edit-${rating.attributeType}-${rating.ratingLevel}`}
                          >
                            Edit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Preview Attribute Weight Changes</DialogTitle>
            <DialogDescription>
              Review the impact of your proposed changes before applying them
              {selectedLocations.length > 0 || selectedServiceLine !== "All" ? (
                <span className="block mt-1 text-blue-600">
                  Showing impact for: {selectedLocations.length > 0 ? selectedLocations.join(', ') : 'All locations'} | {selectedServiceLine === "All" ? 'All service lines' : selectedServiceLine}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          
          {previewData && (
            <div className="space-y-4">
              <Alert>
                <TrendingUp className="h-4 w-4" />
                <AlertDescription>
                  <div className="grid grid-cols-2 gap-4 mt-2">
                    <div>
                      <span className="font-medium">Units Analyzed:</span> {previewData.summary?.unitsAnalyzed?.toLocaleString() || 0}
                    </div>
                    <div>
                      <span className="font-medium">Units Affected:</span> {previewData.summary?.affectedUnits?.toLocaleString() || 0}
                    </div>
                    <div>
                      <span className="font-medium">Avg Change:</span>{" "}
                      <span className={(previewData.summary?.avgChangePercent || 0) > 0 ? "text-green-600" : "text-red-600"}>
                        {(previewData.summary?.avgChangePercent || 0) > 0 ? "+" : ""}{(previewData.summary?.avgChangePercent || 0).toFixed(2)}%
                      </span>
                    </div>
                    <div>
                      <span className="font-medium">Total Revenue Impact:</span>{" "}
                      <span className={(previewData.summary?.totalChangeAmount || 0) > 0 ? "text-green-600" : "text-red-600"}>
                        {(previewData.summary?.totalChangeAmount || 0) > 0 ? "+" : ""}${(previewData.summary?.totalChangeAmount || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>

              {previewData.byServiceLine && previewData.byServiceLine.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Impact by Service Line</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Service Line</TableHead>
                        <TableHead className="text-right">Units</TableHead>
                        <TableHead className="text-right">Avg Change</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.byServiceLine.map((sl) => (
                        <TableRow key={sl.serviceLine}>
                          <TableCell>{sl.serviceLine}</TableCell>
                          <TableCell className="text-right">{sl.count}</TableCell>
                          <TableCell className={`text-right ${sl.avgChange > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {sl.avgChange > 0 ? '+' : ''}{sl.avgChange.toFixed(2)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {previewData.topChanges && previewData.topChanges.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Sample Unit Changes</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Location</TableHead>
                        <TableHead>Room</TableHead>
                        <TableHead className="text-right">Current</TableHead>
                        <TableHead className="text-right">New</TableHead>
                        <TableHead className="text-right">Change</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewData.topChanges.slice(0, 10).map((change, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-sm">{change.location}</TableCell>
                          <TableCell>{change.roomNumber}</TableCell>
                          <TableCell className="text-right font-mono">${change.currentPrice.toLocaleString()}</TableCell>
                          <TableCell className="text-right font-mono">${change.newPrice.toLocaleString()}</TableCell>
                          <TableCell className={`text-right ${change.change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {change.change > 0 ? '+' : ''}${change.change.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => setShowPreview(false)}
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button
                  onClick={handleAcceptChanges}
                  disabled={acceptChangesMutation.isPending}
                >
                  <Check className="h-4 w-4 mr-2" />
                  Accept Changes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
