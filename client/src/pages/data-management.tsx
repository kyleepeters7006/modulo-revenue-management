import Navigation from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react";
import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function DataManagement() {
  const [uploadHistory, setUploadHistory] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleDownloadUnifiedTemplate = async () => {
    try {
      const response = await fetch('/api/template/unified');
      const blob = await response.blob();
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'unified_portfolio_template.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Template Downloaded",
        description: "Unified portfolio template has been downloaded successfully.",
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
      const response = await fetch('/api/upload/unified', {
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
        description: `Processed ${data.rentRollRecords} rent roll records, ${data.competitorRecords} competitor records, and ${data.targetsRecords} targets & trends records.`,
      });
      setUploadHistory(prev => [data, ...prev.slice(0, 4)]);
      queryClient.invalidateQueries({ queryKey: ["/api"] });
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
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2" data-testid="text-page-title">
            Data Management
          </h1>
          <p className="text-gray-600" data-testid="text-page-subtitle">
            Unified portfolio data upload - Rent Rolls, Competitors, and Targets & Trends
          </p>
        </div>

        <div className="space-y-6">
          {/* Unified Upload Card */}
          <Card>
            <CardHeader>
              <CardTitle>Unified Portfolio Upload</CardTitle>
              <CardDescription>
                Upload all portfolio data in a single Excel file containing Rent Rolls, Competitors, and Targets & Trends
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <FileSpreadsheet className="h-4 w-4" />
                <AlertDescription>
                  The unified template includes three sheets:
                  <ul className="mt-2 ml-4 list-disc text-sm">
                    <li><strong>Rent Roll:</strong> Unit-level occupancy and pricing data</li>
                    <li><strong>Competitors:</strong> Market comparison data with rates and distances</li>
                    <li><strong>Targets & Trends:</strong> Monthly performance metrics and budgets</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Button
                  onClick={handleDownloadUnifiedTemplate}
                  className="w-full bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal)]/90 text-white"
                  data-testid="button-download-unified-template"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Unified Template
                </Button>
                
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="w-full bg-[var(--trilogy-blue)] hover:bg-[var(--trilogy-blue)]/90 text-white"
                  data-testid="button-upload-unified"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {isUploading ? 'Processing...' : 'Upload Portfolio Data'}
                </Button>
              </div>
              
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileUpload}
                data-testid="input-unified-file"
              />
            </CardContent>
          </Card>

          {/* Data Upload Instructions */}
          <Card>
            <CardHeader>
              <CardTitle>Data Upload Instructions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Rent Roll Sheet */}
              <div className="space-y-2">
                <h3 className="font-semibold text-lg text-[var(--trilogy-blue)]">Sheet 1: Rent Roll</h3>
                <p className="text-sm text-gray-600">Monthly unit-level occupancy and pricing data</p>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs font-mono text-gray-700">
                    Date | Location | Room Number | Room Type | Occupied Y/N | Days Vacant | 
                    Preferred Location | Size | View | Renovated | Other Premium Feature | 
                    Street Rate | In-House Rate | Discount to Street Rate | Care Level | 
                    Care Rate | Rent and Care Rate | Competitor Rate | Competitor Average Care Rate | 
                    Competitor Final Rate
                  </p>
                </div>
              </div>

              {/* Competitors Sheet */}
              <div className="space-y-2">
                <h3 className="font-semibold text-lg text-[var(--trilogy-blue)]">Sheet 2: Competitors</h3>
                <p className="text-sm text-gray-600">Competitor pricing and location data</p>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs font-mono text-gray-700">
                    Location | Competitor Name | Distance (miles) | Service Line | Room Type | 
                    Base Rate | Care Level 1 Rate | Care Level 2 Rate | Care Level 3 Rate | 
                    Market Position | Notes
                  </p>
                </div>
              </div>

              {/* Targets & Trends Sheet */}
              <div className="space-y-2">
                <h3 className="font-semibold text-lg text-[var(--trilogy-blue)]">Sheet 3: Targets & Trends</h3>
                <p className="text-sm text-gray-600">Monthly performance metrics and budget targets</p>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs font-mono text-gray-700">
                    Date | Location | Service Line | Census | Occupancy % | Move-ins | Move-outs | 
                    Revenue | RevPAR | RevPOR | ADR | Street Rate | In-House Rate | 
                    Budget Revenue | Budget RevPOR | Budget ADR | Market Rate
                  </p>
                </div>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Important:</strong> Ensure all location names match exactly across all three sheets. 
                  Upload data for the last day of each month for accurate trend analysis.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Upload History */}
          {uploadHistory.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent Uploads</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {uploadHistory.map((upload, index) => (
                    <div key={index} className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-5 w-5 text-green-600" />
                          <p className="font-medium text-green-900">
                            Upload completed successfully
                          </p>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-sm text-green-700 ml-7">
                          <span>Rent Roll: {upload.rentRollRecords} records</span>
                          <span>Competitors: {upload.competitorRecords} records</span>
                          <span>Targets: {upload.targetsRecords} records</span>
                        </div>
                        <p className="text-xs text-green-600 ml-7">
                          {new Date(upload.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}