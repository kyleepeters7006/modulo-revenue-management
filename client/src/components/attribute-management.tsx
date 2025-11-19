import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Settings, Save } from "lucide-react";

interface AttributeRating {
  id: string;
  attributeType: string;
  ratingLevel: string;
  adjustmentPercent: number;
  description?: string;
}

export default function AttributeManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingRating, setEditingRating] = useState<AttributeRating | null>(null);

  const { data: attributeRatings = [], isLoading } = useQuery({
    queryKey: ['/api/attribute-ratings'],
    queryFn: async () => {
      const response = await fetch('/api/attribute-ratings');
      return response.json();
    }
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
      setEditingRating(null);
    }
  });

  // Group ratings by attribute type
  const groupedRatings = attributeRatings.reduce((acc: Record<string, AttributeRating[]>, rating: AttributeRating) => {
    if (!acc[rating.attributeType]) {
      acc[rating.attributeType] = [];
    }
    acc[rating.attributeType].push(rating);
    return acc;
  }, {});

  // Sort rating levels (A, B, C)
  Object.keys(groupedRatings).forEach(type => {
    groupedRatings[type].sort((a, b) => a.ratingLevel.localeCompare(b.ratingLevel));
  });

  const handleSave = (rating: AttributeRating) => {
    updateMutation.mutate({
      attributeType: rating.attributeType,
      ratingLevel: rating.ratingLevel,
      adjustmentPercent: rating.adjustmentPercent,
      description: rating.description
    });
  };

  const getRatingColor = (level: string) => {
    switch (level) {
      case 'A': return 'bg-green-100 text-green-800';
      case 'B': return 'bg-yellow-100 text-yellow-800';
      case 'C': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>Attribute Management</span>
          </div>
          <Button 
            variant="outline"
            size="sm"
            onClick={() => initializeMutation.mutate()}
            disabled={initializeMutation.isPending}
          >
            Reset to Defaults
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Configure A/B/C ratings for each unit attribute. These percentages adjust the base pricing.
          </p>

          {Object.entries(groupedRatings).map(([attributeType, ratings]) => (
            <div key={attributeType}>
              <h3 className="font-medium text-lg capitalize mb-2">
                {attributeType} Ratings
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rating</TableHead>
                    <TableHead>Adjustment %</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ratings.map((rating) => (
                    <TableRow key={`${rating.attributeType}-${rating.ratingLevel}`}>
                      <TableCell>
                        <Badge className={getRatingColor(rating.ratingLevel)}>
                          {rating.ratingLevel}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {editingRating?.id === rating.id ? (
                          <Input
                            type="number"
                            value={editingRating.adjustmentPercent}
                            onChange={(e) => setEditingRating({
                              ...editingRating,
                              adjustmentPercent: parseFloat(e.target.value) || 0
                            })}
                            className="w-20"
                            step="0.1"
                            data-testid={`input-adjustment-${rating.attributeType}-${rating.ratingLevel}`}
                          />
                        ) : (
                          <span className={rating.adjustmentPercent > 0 ? "text-green-600" : rating.adjustmentPercent < 0 ? "text-red-600" : ""}>
                            {rating.adjustmentPercent > 0 ? '+' : ''}{rating.adjustmentPercent}%
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingRating?.id === rating.id ? (
                          <Textarea
                            value={editingRating.description || ''}
                            onChange={(e) => setEditingRating({
                              ...editingRating,
                              description: e.target.value
                            })}
                            className="min-h-[60px]"
                            data-testid={`textarea-description-${rating.attributeType}-${rating.ratingLevel}`}
                          />
                        ) : (
                          <span className="text-sm text-gray-600">
                            {rating.description || 'No description'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {editingRating?.id === rating.id ? (
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              onClick={() => handleSave(editingRating)}
                              disabled={updateMutation.isPending}
                              data-testid={`button-save-${rating.attributeType}-${rating.ratingLevel}`}
                            >
                              <Save className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
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
                            onClick={() => setEditingRating(rating)}
                            data-testid={`button-edit-${rating.attributeType}-${rating.ratingLevel}`}
                          >
                            Edit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}