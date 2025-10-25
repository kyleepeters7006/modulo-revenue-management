import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Upload, Image as ImageIcon, Loader2 } from "lucide-react";

interface FloorPlanImageUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campusId: string;
}

export default function FloorPlanImageUpload({ 
  open, 
  onOpenChange, 
  campusId 
}: FloorPlanImageUploadProps) {
  const [name, setName] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(683);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (data: FormData) => {
      return await fetch(`/api/campus-maps/upload-image`, {
        method: "POST",
        body: data,
      }).then(res => res.json());
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Floor plan image uploaded successfully",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/campus-maps/${campusId}`] });
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: String(error),
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please select a JPG, PNG, or WebP image",
        variant: "destructive",
      });
      return;
    }

    setImageFile(file);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        setWidth(img.width);
        setHeight(img.height);
        setPreview(e.target?.result as string);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);

    if (!name) {
      setName(file.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleUpload = async () => {
    if (!imageFile || !name) {
      toast({
        title: "Missing information",
        description: "Please provide a name and select an image file",
        variant: "destructive",
      });
      return;
    }

    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('name', name);
    formData.append('locationId', campusId);
    formData.append('width', width.toString());
    formData.append('height', height.toString());

    uploadMutation.mutate(formData);
  };

  const resetForm = () => {
    setName("");
    setImageFile(null);
    setPreview("");
    setWidth(1024);
    setHeight(683);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Floor Plan Image</DialogTitle>
          <DialogDescription>
            Upload a photorealistic floor plan image (JPG, PNG, or WebP) for this campus.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="map-name">Map Name</Label>
            <Input
              id="map-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Main Building - Floor 1"
              data-testid="input-map-name"
            />
          </div>

          <div>
            <Label htmlFor="image-file">Floor Plan Image</Label>
            <Input
              id="image-file"
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onChange={handleFileChange}
              data-testid="input-image-file"
            />
          </div>

          {preview && (
            <div className="border rounded-lg p-4 bg-slate-50">
              <Label className="mb-2 block">Preview</Label>
              <div className="relative">
                <img 
                  src={preview} 
                  alt="Preview" 
                  className="max-h-96 w-full object-contain rounded border"
                />
                <div className="mt-2 text-sm text-slate-600">
                  Dimensions: {width} × {height} pixels
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="width">Width (px)</Label>
              <Input
                id="width"
                type="number"
                value={width}
                onChange={(e) => setWidth(parseInt(e.target.value) || 1024)}
                data-testid="input-width"
              />
            </div>
            <div>
              <Label htmlFor="height">Height (px)</Label>
              <Input
                id="height"
                type="number"
                value={height}
                onChange={(e) => setHeight(parseInt(e.target.value) || 683)}
                data-testid="input-height"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!imageFile || !name || uploadMutation.isPending}
            data-testid="button-upload"
          >
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload Image
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
