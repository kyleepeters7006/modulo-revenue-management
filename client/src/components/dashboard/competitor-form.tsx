import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Edit2, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const competitorFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  streetRate: z.number().optional(),
  avgCareRate: z.number().optional(),
  roomType: z.string().optional(),
  address: z.string().optional(),
  rank: z.number().optional(),
  weight: z.number().optional(),
  rating: z.number().min(0).max(5).optional(),
  ratingA: z.number().min(0).max(100).optional(),
  ratingB: z.number().min(0).max(100).optional(),
  ratingC: z.number().min(0).max(100).optional(),
  attributes: z.object({
    view: z.boolean().optional(),
    renovated: z.boolean().optional(),
    corner: z.boolean().optional(),
    balcony: z.boolean().optional(),
    parking: z.boolean().optional(),
  }).optional(),
});

type CompetitorFormData = z.infer<typeof competitorFormSchema>;

export default function CompetitorForm() {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: competitors, isLoading } = useQuery({
    queryKey: ["/api/competitors"],
  });

  const form = useForm<CompetitorFormData>({
    resolver: zodResolver(competitorFormSchema),
    defaultValues: {
      name: "",
      lat: 38.2527,
      lng: -85.7585,
      attributes: {
        view: false,
        renovated: false,
        corner: false,
        balcony: false,
        parking: false,
      },
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CompetitorFormData) => {
      return apiRequest("/api/competitors", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      toast({
        title: "Success",
        description: "Competitor added successfully",
      });
      setShowForm(false);
      form.reset();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to add competitor",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: CompetitorFormData }) => {
      return apiRequest(`/api/competitors/${id}`, "PUT", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      toast({
        title: "Success",
        description: "Competitor updated successfully",
      });
      setEditingId(null);
      setShowForm(false);
      form.reset();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to update competitor",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/competitors/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/competitors"] });
      toast({
        title: "Success",
        description: "Competitor deleted successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to delete competitor",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CompetitorFormData) => {
    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const startEdit = (competitor: any) => {
    setEditingId(competitor.id);
    setShowForm(true);
    form.setValue("name", competitor.name || "");
    form.setValue("lat", competitor.lat || 38.2527);
    form.setValue("lng", competitor.lng || -85.7585);
    form.setValue("streetRate", competitor.streetRate || undefined);
    form.setValue("avgCareRate", competitor.avgCareRate || undefined);
    form.setValue("roomType", competitor.roomType || "");
    form.setValue("address", competitor.address || "");
    form.setValue("rank", competitor.rank || undefined);
    form.setValue("weight", competitor.weight || undefined);
    form.setValue("rating", competitor.rating || undefined);
    form.setValue("ratingA", competitor.ratingA || undefined);
    form.setValue("ratingB", competitor.ratingB || undefined);
    form.setValue("ratingC", competitor.ratingC || undefined);
    form.setValue("attributes", competitor.attributes || {
      view: false,
      renovated: false,
      corner: false,
      balcony: false,
      parking: false,
    });
  };

  const startAdd = () => {
    setEditingId(null);
    setShowForm(true);
    form.reset();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setShowForm(false);
    form.reset();
  };

  console.log("CompetitorForm rendering:", { isLoading, competitors: competitors?.items?.length });
  
  if (isLoading) {
    return (
      <Card className="bg-[var(--dashboard-surface)] border-[var(--dashboard-border)]">
        <CardHeader>
          <CardTitle className="text-[var(--dashboard-text)]">Competitor Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse">Loading competitors...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-[var(--dashboard-surface)] border-[var(--dashboard-border)]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-[var(--dashboard-text)]">Competitor Management</CardTitle>
          <Button onClick={startAdd} className="flex items-center gap-2" data-testid="button-add-competitor">
            <Plus className="h-4 w-4" />
            Add Competitor
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {showForm && (
          <Card className="bg-[var(--dashboard-bg)] border-[var(--dashboard-border)]">
            <CardHeader>
              <CardTitle className="text-sm text-[var(--dashboard-text)]">
                {editingId ? "Edit Competitor" : "Add New Competitor"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Basic Information */}
                  <div>
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      {...form.register("name")}
                      placeholder="Competitor name"
                      data-testid="input-competitor-name"
                    />
                    {form.formState.errors.name && (
                      <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="address">Address</Label>
                    <Input
                      id="address"
                      {...form.register("address")}
                      placeholder="Street address"
                      data-testid="input-competitor-address"
                    />
                  </div>

                  {/* Location */}
                  <div>
                    <Label htmlFor="lat">Latitude *</Label>
                    <Input
                      id="lat"
                      type="number"
                      step="any"
                      {...form.register("lat", { valueAsNumber: true })}
                      placeholder="38.2527"
                      data-testid="input-competitor-lat"
                    />
                  </div>

                  <div>
                    <Label htmlFor="lng">Longitude *</Label>
                    <Input
                      id="lng"
                      type="number"
                      step="any"
                      {...form.register("lng", { valueAsNumber: true })}
                      placeholder="-85.7585"
                      data-testid="input-competitor-lng"
                    />
                  </div>

                  {/* Pricing */}
                  <div>
                    <Label htmlFor="streetRate">Street Rate</Label>
                    <Input
                      id="streetRate"
                      type="number"
                      step="0.01"
                      {...form.register("streetRate", { valueAsNumber: true })}
                      placeholder="3500.00"
                      data-testid="input-competitor-street-rate"
                    />
                  </div>

                  <div>
                    <Label htmlFor="avgCareRate">Avg Care Rate</Label>
                    <Input
                      id="avgCareRate"
                      type="number"
                      step="0.01"
                      {...form.register("avgCareRate", { valueAsNumber: true })}
                      placeholder="800.00"
                      data-testid="input-competitor-care-rate"
                    />
                  </div>

                  {/* Room Type */}
                  <div>
                    <Label htmlFor="roomType">Room Type</Label>
                    <Select onValueChange={(value) => form.setValue("roomType", value)}>
                      <SelectTrigger data-testid="select-competitor-room-type">
                        <SelectValue placeholder="Select room type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Studio">Studio</SelectItem>
                        <SelectItem value="One Bedroom">One Bedroom</SelectItem>
                        <SelectItem value="Two Bedroom">Two Bedroom</SelectItem>
                        <SelectItem value="Memory Care">Memory Care</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Rankings & Weights */}
                  <div>
                    <Label htmlFor="rank">Rank</Label>
                    <Input
                      id="rank"
                      type="number"
                      {...form.register("rank", { valueAsNumber: true })}
                      placeholder="1"
                      data-testid="input-competitor-rank"
                    />
                  </div>

                  <div>
                    <Label htmlFor="weight">Weight</Label>
                    <Input
                      id="weight"
                      type="number"
                      step="0.01"
                      {...form.register("weight", { valueAsNumber: true })}
                      placeholder="1.0"
                      data-testid="input-competitor-weight"
                    />
                  </div>

                  <div>
                    <Label htmlFor="rating">Rating (0-5)</Label>
                    <Input
                      id="rating"
                      type="number"
                      step="0.1"
                      min="0"
                      max="5"
                      {...form.register("rating", { valueAsNumber: true })}
                      placeholder="4.2"
                      data-testid="input-competitor-rating"
                    />
                  </div>

                  {/* A/B/C Ratings */}
                  <div>
                    <Label htmlFor="ratingA">Rating A (0-100)</Label>
                    <Input
                      id="ratingA"
                      type="number"
                      min="0"
                      max="100"
                      {...form.register("ratingA", { valueAsNumber: true })}
                      placeholder="85"
                      data-testid="input-competitor-rating-a"
                    />
                  </div>

                  <div>
                    <Label htmlFor="ratingB">Rating B (0-100)</Label>
                    <Input
                      id="ratingB"
                      type="number"
                      min="0"
                      max="100"
                      {...form.register("ratingB", { valueAsNumber: true })}
                      placeholder="75"
                      data-testid="input-competitor-rating-b"
                    />
                  </div>

                  <div>
                    <Label htmlFor="ratingC">Rating C (0-100)</Label>
                    <Input
                      id="ratingC"
                      type="number"
                      min="0"
                      max="100"
                      {...form.register("ratingC", { valueAsNumber: true })}
                      placeholder="65"
                      data-testid="input-competitor-rating-c"
                    />
                  </div>
                </div>

                {/* Attributes */}
                <div>
                  <Label>Attributes</Label>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2">
                    {["view", "renovated", "corner", "balcony", "parking"].map((attr) => (
                      <label key={attr} className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          {...form.register(`attributes.${attr}` as any)}
                          className="rounded"
                        />
                        <span className="text-sm capitalize">{attr}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button 
                    type="submit" 
                    disabled={createMutation.isPending || updateMutation.isPending}
                    data-testid="button-save-competitor"
                  >
                    {editingId ? "Update" : "Add"} Competitor
                  </Button>
                  <Button type="button" variant="outline" onClick={cancelEdit} data-testid="button-cancel-competitor">
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Competitor List */}
        <div className="space-y-3">
          <h3 className="text-lg font-medium text-[var(--dashboard-text)]">Current Competitors</h3>
          {(competitors as any)?.items?.length > 0 ? (
            <div className="grid gap-4">
              {(competitors as any).items.map((competitor: any) => (
                <Card key={competitor.id} className="bg-[var(--dashboard-bg)] border-[var(--dashboard-border)]">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        <h4 className="font-medium text-[var(--dashboard-text)]">{competitor.name}</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-[var(--dashboard-muted)]">
                          {competitor.address && (
                            <div className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {competitor.address}
                            </div>
                          )}
                          {competitor.streetRate && (
                            <div>Street Rate: ${competitor.streetRate}</div>
                          )}
                          {competitor.avgCareRate && (
                            <div>Care Rate: ${competitor.avgCareRate}</div>
                          )}
                          {competitor.rating && (
                            <div>Rating: ⭐ {competitor.rating}/5</div>
                          )}
                          {competitor.rank && (
                            <div>Rank: #{competitor.rank}</div>
                          )}
                          {competitor.roomType && (
                            <div>Room: {competitor.roomType}</div>
                          )}
                        </div>
                        {(competitor.ratingA || competitor.ratingB || competitor.ratingC) && (
                          <div className="flex gap-2">
                            {competitor.ratingA && <Badge variant="outline">A: {competitor.ratingA}</Badge>}
                            {competitor.ratingB && <Badge variant="outline">B: {competitor.ratingB}</Badge>}
                            {competitor.ratingC && <Badge variant="outline">C: {competitor.ratingC}</Badge>}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(competitor)}
                          data-testid={`button-edit-competitor-${competitor.id}`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteMutation.mutate(competitor.id)}
                          data-testid={`button-delete-competitor-${competitor.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-[var(--dashboard-muted)] text-center py-8">
              No competitors found. Add your first competitor above.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
