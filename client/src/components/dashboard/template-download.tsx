import { Button } from "@/components/ui/button";
import { Download, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function TemplateDownload() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch('/api/template/download');
      const blob = await response.blob();
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rent_roll_template.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Template Downloaded",
        description: "Excel template has been downloaded successfully.",
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Failed to download template. Please try again.",
        variant: "destructive",
      });
    }
  };

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      setIsUploading(true);
      const response = await fetch('/api/upload/rent-roll', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Upload failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Upload Successful",
        description: `Processed ${data.recordsProcessed} records for ${data.uploadMonth}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/rent-roll"] });
      queryClient.invalidateQueries({ queryKey: ["/api/status"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    uploadMutation.mutate(formData);
  };

  return (
    <Card className="dashboard-card">
      <CardHeader>
        <CardTitle className="text-xl font-semibold text-[var(--dashboard-text)]">
          Data Management
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Button
            onClick={handleDownloadTemplate}
            className="w-full bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/90 text-white"
            data-testid="button-download-template"
          >
            <Download className="w-4 h-4 mr-2" />
            Download Template
          </Button>
          
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-full bg-[var(--trilogy-blue)] hover:bg-[var(--trilogy-blue)]/90 text-white"
            data-testid="button-upload-data"
          >
            <Upload className="w-4 h-4 mr-2" />
            {isUploading ? 'Uploading...' : 'Upload Data'}
          </Button>
        </div>
        
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={handleFileUpload}
          data-testid="input-data-file"
        />
        
        <div className="text-sm text-[var(--dashboard-muted)] space-y-2">
          <p><strong>Template Fields:</strong></p>
          <p className="text-xs leading-relaxed">
            date, location, room number, room type, occupied Y/N, days vacant, 
            preferred location, size, view, renovated, other premium feature, 
            street rate, in-house rate, discount to street rate, care level, 
            care rate, rent and care rate, competitor rate, competitor average care rate, 
            competitor final rate
          </p>
          <p className="text-xs text-[var(--trilogy-warning)]">
            <strong>Note:</strong> Upload data for the last day of each month. 
            Historical data is stored by month for trend analysis.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}