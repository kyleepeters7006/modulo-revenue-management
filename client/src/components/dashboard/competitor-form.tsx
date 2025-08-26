import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function CompetitorForm() {
  const [formData, setFormData] = useState({
    name: "",
    lat: 38.2527,
    lng: -85.7585,
    roomType: "",
    streetRate: "",
    careRate: ""
  });
  const [saveStatus, setSaveStatus] = useState("Ready to add competitor...");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const addCompetitorMutation = useMutation({
    mutationFn: async (competitorData: any) => {
      const payload = {
        name: competitorData.name,
        lat: competitorData.lat,
        lng: competitorData.lng,
        rates: {
          [competitorData.roomType]: parseFloat(competitorData.streetRate)
        },
        ...(competitorData.careRate && { avgCareRate: parseFloat(competitorData.careRate) })
      };
      return apiRequest('POST', '/api/competitors', payload);
    },
    onSuccess: () => {
      setSaveStatus("Competitor added successfully");
      toast({
        title: "Competitor Added",
        description: "Competitor data saved successfully",
      });
      // Reset form
      setFormData({
        name: "",
        lat: 38.2527,
        lng: -85.7585,
        roomType: "",
        streetRate: "",
        careRate: ""
      });
      // Refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/competitors'] });
      queryClient.invalidateQueries({ queryKey: ['/api/compare'] });
    },
    onError: (error) => {
      setSaveStatus(`Save failed: ${error.message}`);
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.roomType || !formData.streetRate) {
      setSaveStatus("Please fill in all required fields");
      return;
    }

    if (isNaN(parseFloat(formData.streetRate))) {
      setSaveStatus("Street rate must be a valid number");
      return;
    }

    setSaveStatus("Saving...");
    addCompetitorMutation.mutate(formData);
  };

  const handleInputChange = (field: string, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  return (
    <div className="dashboard-card">
      <div className="mb-6">
        <h4 className="text-lg font-semibold text-[var(--dashboard-text)]">Add Competitor</h4>
        <p className="text-sm text-[var(--dashboard-muted)]">Update competitive intelligence data</p>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="comp-name" className="text-sm font-medium text-[var(--dashboard-text)]">
            Competitor Name
          </Label>
          <Input
            id="comp-name"
            type="text"
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            className="dashboard-input"
            placeholder="Sunny Springs Assisted Living"
            data-testid="input-competitor-name"
          />
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="comp-lat" className="text-sm font-medium text-[var(--dashboard-text)]">
              Latitude
            </Label>
            <Input
              id="comp-lat"
              type="number"
              step="0.000001"
              value={formData.lat}
              onChange={(e) => handleInputChange('lat', parseFloat(e.target.value))}
              className="dashboard-input"
              data-testid="input-competitor-lat"
            />
          </div>
          <div>
            <Label htmlFor="comp-lng" className="text-sm font-medium text-[var(--dashboard-text)]">
              Longitude
            </Label>
            <Input
              id="comp-lng"
              type="number"
              step="0.000001"
              value={formData.lng}
              onChange={(e) => handleInputChange('lng', parseFloat(e.target.value))}
              className="dashboard-input"
              data-testid="input-competitor-lng"
            />
          </div>
        </div>
        
        <div>
          <Label htmlFor="comp-room-type" className="text-sm font-medium text-[var(--dashboard-text)]">
            Room Type
          </Label>
          <Input
            id="comp-room-type"
            type="text"
            value={formData.roomType}
            onChange={(e) => handleInputChange('roomType', e.target.value)}
            className="dashboard-input"
            placeholder="Studio"
            data-testid="input-competitor-room-type"
          />
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="comp-street-rate" className="text-sm font-medium text-[var(--dashboard-text)]">
              Street Rate
            </Label>
            <Input
              id="comp-street-rate"
              type="number"
              step="1"
              value={formData.streetRate}
              onChange={(e) => handleInputChange('streetRate', e.target.value)}
              className="dashboard-input"
              placeholder="3200"
              data-testid="input-competitor-street-rate"
            />
          </div>
          <div>
            <Label htmlFor="comp-care-rate" className="text-sm font-medium text-[var(--dashboard-text)]">
              Care Rate
            </Label>
            <Input
              id="comp-care-rate"
              type="number"
              step="1"
              value={formData.careRate}
              onChange={(e) => handleInputChange('careRate', e.target.value)}
              className="dashboard-input"
              placeholder="850"
              data-testid="input-competitor-care-rate"
            />
          </div>
        </div>
        
        <Button
          type="submit"
          className="w-full bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white"
          disabled={addCompetitorMutation.isPending}
          data-testid="button-add-competitor"
        >
          {addCompetitorMutation.isPending ? "Adding..." : "Add Competitor"}
        </Button>
        
        <div 
          className="text-sm text-[var(--dashboard-muted)]"
          data-testid="text-competitor-status"
        >
          {saveStatus}
        </div>
      </form>
    </div>
  );
}
