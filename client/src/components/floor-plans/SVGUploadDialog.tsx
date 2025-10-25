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
import { Upload, FileCode } from "lucide-react";

interface SVGUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campusId: string;
}

export default function SVGUploadDialog({ open, onOpenChange, campusId }: SVGUploadDialogProps) {
  const [name, setName] = useState("");
  const [svgFile, setSvgFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (data: { name: string; svgContent: string; campusId: string }) => {
      return await apiRequest(`/api/campus-maps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Campus map uploaded successfully",
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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.svg')) {
      toast({
        title: "Invalid file",
        description: "Please select an SVG file",
        variant: "destructive",
      });
      return;
    }

    setSvgFile(file);
    const content = await file.text();
    setPreview(content);
    
    // Auto-populate name if not set
    if (!name) {
      setName(file.name.replace('.svg', ''));
    }
  };

  const handleUpload = async () => {
    if (!svgFile || !preview || !name) {
      toast({
        title: "Missing information",
        description: "Please provide a name and select an SVG file",
        variant: "destructive",
      });
      return;
    }

    // Extract viewBox dimensions from SVG
    const viewBoxMatch = preview.match(/viewBox=["']([^"']+)["']/);
    let width = 1000;
    let height = 1000;
    
    if (viewBoxMatch) {
      const parts = viewBoxMatch[1].split(/\s+/);
      if (parts.length >= 4) {
        width = parseInt(parts[2]) || 1000;
        height = parseInt(parts[3]) || 1000;
      }
    }

    uploadMutation.mutate({
      name,
      svgContent: preview,
      campusId,
    });
  };

  const resetForm = () => {
    setName("");
    setSvgFile(null);
    setPreview("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Campus Map (SVG)</DialogTitle>
          <DialogDescription>
            Upload an SVG floor plan for this campus. The map will be used for drawing unit polygons and interactive displays.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="map-name">Map Name</Label>
            <Input
              id="map-name"
              placeholder="e.g., Building A - First Floor"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-map-name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="svg-file">SVG File</Label>
            <div className="flex items-center gap-2">
              <Input
                id="svg-file"
                type="file"
                accept=".svg"
                onChange={handleFileChange}
                data-testid="input-svg-file"
              />
              {svgFile && (
                <FileCode className="h-5 w-5 text-green-600" />
              )}
            </div>
          </div>

          {preview && (
            <div className="space-y-2">
              <Label>Preview</Label>
              <div className="border rounded p-4 bg-slate-50 max-h-96 overflow-auto">
                <div className="text-xs text-muted-foreground text-center py-8">
                  <FileCode className="h-8 w-8 mx-auto mb-2" />
                  <p>SVG file selected</p>
                  <p className="mt-1">{svgFile?.name}</p>
                  <p className="text-xs text-slate-500 mt-2">Preview disabled for security</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              resetForm();
            }}
            data-testid="button-cancel-upload"
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!svgFile || !name || uploadMutation.isPending}
            data-testid="button-confirm-upload"
          >
            {uploadMutation.isPending ? (
              "Uploading..."
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload Map
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
