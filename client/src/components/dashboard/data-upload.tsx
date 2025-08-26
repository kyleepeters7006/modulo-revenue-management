import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function DataUpload() {
  const [dragActive, setDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("Ready to upload...");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiRequest('POST', '/api/upload_rent_roll', formData);
    },
    onSuccess: async (response) => {
      const data = await response.json();
      setUploadStatus(`Uploaded ${data.rows} rows successfully`);
      toast({
        title: "Upload Successful",
        description: `Processed ${data.rows} rent roll records`,
      });
      // Refresh relevant data
      queryClient.invalidateQueries({ queryKey: ['/api/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/series'] });
      queryClient.invalidateQueries({ queryKey: ['/api/recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/compare'] });
    },
    onError: (error) => {
      setUploadStatus(`Upload failed: ${error.message}`);
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileUpload = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast({
        title: "Invalid File",
        description: "Please upload a CSV file",
        variant: "destructive",
      });
      return;
    }

    setUploadStatus("Uploading...");
    uploadMutation.mutate(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  return (
    <div className="dashboard-card">
      <div className="flex items-center space-x-3 mb-4">
        <div className="w-10 h-10 bg-[var(--trilogy-blue)]/10 rounded-lg flex items-center justify-center">
          <Upload className="w-5 h-5 text-[var(--trilogy-blue)]" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-[var(--dashboard-text)]">Rent Roll Upload</h3>
          <p className="text-sm text-[var(--dashboard-muted)]">Upload your CSV data file</p>
        </div>
      </div>
      
      <div className="space-y-4">
        <div className="p-4 bg-[var(--dashboard-bg)] border border-[var(--dashboard-border)] rounded-lg">
          <p className="text-sm text-[var(--dashboard-muted)] mb-2">Required CSV columns:</p>
          <div className="flex flex-wrap gap-2">
            {['Unit_ID', 'Occupied_YN', 'Base_Rent', 'Care_Fee', 'Room_Type'].map((column) => (
              <span
                key={column}
                className="px-2 py-1 text-xs font-medium bg-[var(--trilogy-teal)]/10 text-[var(--trilogy-teal-light)] rounded-md"
                data-testid={`tag-column-${column.toLowerCase()}`}
              >
                {column}
              </span>
            ))}
          </div>
        </div>
        
        <div
          className={`
            border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer
            ${dragActive 
              ? 'border-[var(--trilogy-teal)]/50 bg-[var(--trilogy-teal)]/5' 
              : 'border-[var(--dashboard-border)] hover:border-[var(--trilogy-teal)]/50'
            }
          `}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          data-testid="dropzone-upload"
        >
          <Upload className="w-8 h-8 text-[var(--dashboard-muted)] mx-auto mb-3" />
          <p className="text-sm font-medium text-[var(--dashboard-text)]">
            Drop your CSV file here
          </p>
          <p className="text-xs text-[var(--dashboard-muted)] mt-1">
            or click to browse
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileInputChange}
            data-testid="input-file-upload"
          />
        </div>
        
        <Button
          onClick={() => fileInputRef.current?.click()}
          className="w-full bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white"
          disabled={uploadMutation.isPending}
          data-testid="button-upload"
        >
          {uploadMutation.isPending ? "Uploading..." : "Upload File"}
        </Button>
        
        <div 
          className="text-sm text-[var(--dashboard-muted)]"
          data-testid="text-upload-status"
        >
          {uploadStatus}
        </div>
      </div>
    </div>
  );
}
