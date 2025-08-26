import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Upload, MapPin, Trash2, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface DetectedRoom {
  roomNumber: string;
  x: number;
  y: number;
  confidence: number;
  matched: boolean;
  rentData?: any;
}

interface BuildingMap {
  id: string;
  filename: string;
  imageUrl: string;
  detectedRooms: DetectedRoom[];
  createdAt: string;
}

export default function BuildingMapUploader() {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedMap, setSelectedMap] = useState<BuildingMap | null>(null);
  const [showUnmatched, setShowUnmatched] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: buildingMaps, isLoading } = useQuery({
    queryKey: ["/api/building-maps"],
  });

  const { data: rentRollData } = useQuery({
    queryKey: ["/api/status"],
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("buildingMap", file);
      
      const response = await fetch("/api/upload-building-map", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Building map uploaded and processed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/building-maps"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (mapId: string) => {
      await apiRequest(`/api/building-maps/${mapId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Building map deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/building-maps"] });
      setSelectedMap(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length > 0) {
      uploadMutation.mutate(imageFiles[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      uploadMutation.mutate(file);
    }
  };

  const matchedRooms = selectedMap?.detectedRooms.filter(room => room.matched) || [];
  const unmatchedRooms = selectedMap?.detectedRooms.filter(room => !room.matched) || [];

  return (
    <Card className="dashboard-card">
      <CardHeader>
        <CardTitle className="text-xl font-semibold text-[var(--dashboard-text)] flex items-center gap-2">
          <MapPin className="w-5 h-5" />
          Building Map Intelligence
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Upload Area */}
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            isDragging
              ? 'border-[var(--trilogy-teal)] bg-[var(--trilogy-teal)]/5'
              : 'border-[var(--dashboard-border)] hover:border-[var(--trilogy-teal)]/50'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Upload className="w-12 h-12 mx-auto mb-4 text-[var(--dashboard-muted)]" />
          <h3 className="text-lg font-medium text-[var(--dashboard-text)] mb-2">
            Upload Building Floor Plan
          </h3>
          <p className="text-[var(--dashboard-muted)] mb-4">
            Drag and drop an image file, or click to browse
          </p>
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)]"
          >
            {uploadMutation.isPending ? "Processing..." : "Choose File"}
          </Button>
          <Input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          <p className="text-xs text-[var(--dashboard-muted)] mt-2">
            Supports JPG, PNG, SVG. AI will detect room numbers automatically.
          </p>
        </div>

        {/* Building Maps List */}
        {buildingMaps?.items && buildingMaps.items.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-[var(--dashboard-text)]">
              Uploaded Building Maps
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {buildingMaps.items.map((map: BuildingMap) => (
                <div
                  key={map.id}
                  className={`border rounded-lg p-4 cursor-pointer transition-all ${
                    selectedMap?.id === map.id
                      ? 'border-[var(--trilogy-teal)] bg-[var(--trilogy-teal)]/5'
                      : 'border-[var(--dashboard-border)] hover:border-[var(--trilogy-teal)]/50'
                  }`}
                  onClick={() => setSelectedMap(map)}
                >
                  <img
                    src={map.imageUrl}
                    alt={map.filename}
                    className="w-full h-32 object-cover rounded mb-3"
                  />
                  <div className="space-y-2">
                    <p className="font-medium text-[var(--dashboard-text)] truncate">
                      {map.filename}
                    </p>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--dashboard-muted)]">
                        {map.detectedRooms.length} rooms detected
                      </span>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteMutation.mutate(map.id);
                        }}
                        className="h-6 px-2"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Selected Map Analysis */}
        {selectedMap && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--dashboard-text)]">
                Room Analysis: {selectedMap.filename}
              </h3>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowUnmatched(!showUnmatched)}
                className="flex items-center gap-2"
              >
                {showUnmatched ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {showUnmatched ? 'Hide' : 'Show'} Unmatched
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Interactive Map */}
              <div className="space-y-4">
                <h4 className="font-medium text-[var(--dashboard-text)]">Interactive Floor Plan</h4>
                <div className="relative border border-[var(--dashboard-border)] rounded-lg overflow-hidden">
                  <img
                    src={selectedMap.imageUrl}
                    alt="Building floor plan"
                    className="w-full h-96 object-contain bg-white"
                  />
                  {/* Overlay detected rooms */}
                  {selectedMap.detectedRooms.map((room, index) => (
                    <div
                      key={index}
                      className={`absolute transform -translate-x-1/2 -translate-y-1/2 ${
                        room.matched ? 'text-green-500' : 'text-red-500'
                      }`}
                      style={{
                        left: `${room.x}%`,
                        top: `${room.y}%`,
                      }}
                    >
                      <div className={`w-3 h-3 rounded-full ${
                        room.matched ? 'bg-green-500' : 'bg-red-500'
                      }`} />
                      <div className="text-xs font-bold mt-1 whitespace-nowrap">
                        {room.roomNumber}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    <span>Matched to Rent Roll</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full"></div>
                    <span>Unmatched</span>
                  </div>
                </div>
              </div>

              {/* Room Details */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-[var(--dashboard-bg)] p-3 rounded-lg">
                    <div className="text-[var(--dashboard-muted)]">Total Detected</div>
                    <div className="text-xl font-semibold text-[var(--dashboard-text)]">
                      {selectedMap.detectedRooms.length}
                    </div>
                  </div>
                  <div className="bg-[var(--dashboard-bg)] p-3 rounded-lg">
                    <div className="text-[var(--dashboard-muted)]">Matched</div>
                    <div className="text-xl font-semibold text-green-600">
                      {matchedRooms.length}
                    </div>
                  </div>
                </div>

                {/* Matched Rooms */}
                {matchedRooms.length > 0 && (
                  <div className="space-y-3">
                    <h5 className="font-medium text-[var(--dashboard-text)]">
                      Matched Rooms ({matchedRooms.length})
                    </h5>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {matchedRooms.map((room, index) => (
                        <div key={index} className="flex items-center justify-between p-2 bg-[var(--dashboard-bg)] rounded">
                          <div className="flex items-center gap-2">
                            <Badge className="bg-green-500 text-white">
                              {room.roomNumber}
                            </Badge>
                            <span className="text-sm text-[var(--dashboard-text)]">
                              {room.rentData?.roomType || 'Unknown Type'}
                            </span>
                          </div>
                          <div className="text-sm text-[var(--dashboard-muted)]">
                            ${room.rentData?.baseRent || 0}/mo
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Unmatched Rooms */}
                {showUnmatched && unmatchedRooms.length > 0 && (
                  <div className="space-y-3">
                    <h5 className="font-medium text-[var(--dashboard-text)]">
                      Unmatched Rooms ({unmatchedRooms.length})
                    </h5>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {unmatchedRooms.map((room, index) => (
                        <div key={index} className="flex items-center justify-between p-2 bg-[var(--dashboard-bg)] rounded">
                          <Badge variant="destructive">
                            {room.roomNumber}
                          </Badge>
                          <div className="text-xs text-[var(--dashboard-muted)]">
                            {Math.round(room.confidence * 100)}% confidence
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-[var(--dashboard-muted)]">
                      These rooms were detected but don't match any units in your rent roll data.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="text-center py-8">
            <div className="text-[var(--dashboard-muted)]">Loading building maps...</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}