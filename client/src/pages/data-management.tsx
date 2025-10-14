import Navigation from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react";
import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import PricingStrategyDocumentation from "@/components/pricing-strategy-documentation";

export default function DataManagement() {
  const [uploadHistory, setUploadHistory] = useState<any[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch('/api/template/unified');
      const blob = await response.blob();
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'portfolio_template.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Template Downloaded",
        description: "Portfolio template has been downloaded successfully.",
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
            Portfolio data upload in a single comprehensive template
          </p>
        </div>

        <div className="space-y-6">
          {/* Upload Card */}
          <Card>
            <CardHeader>
              <CardTitle>Portfolio Upload</CardTitle>
              <CardDescription>
                Upload all portfolio data in a single comprehensive Excel template
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <FileSpreadsheet className="h-4 w-4" />
                <AlertDescription>
                  The template contains all portfolio data in a single comprehensive sheet including unit-level occupancy, pricing data, competitor information, and performance metrics.
                </AlertDescription>
              </Alert>

              <div className="flex flex-col space-y-3">
                <Button
                  onClick={handleDownloadTemplate}
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white"
                  data-testid="button-download-template"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Template
                </Button>
                
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white border-2 border-blue-600"
                  data-testid="button-upload"
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
                data-testid="input-file"
              />
            </CardContent>
          </Card>

          {/* Export Options */}
          <Card>
            <CardHeader>
              <CardTitle>Export Data</CardTitle>
              <CardDescription>
                Export your data in various formats for external systems
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h3 className="font-medium text-sm">MatrixCare Export</h3>
                  <p className="text-xs text-gray-600">Export data formatted for MatrixCare EHR system</p>
                  <div className="flex gap-2">
                    <Button
                      onClick={async () => {
                        try {
                          const response = await fetch('/api/export/matrixcare?format=xlsx');
                          
                          // Check validation status from headers
                          const validationStatus = response.headers.get('X-Validation-Status');
                          const validationSuggestions = response.headers.get('X-Validation-Suggestions');
                          
                          const blob = await response.blob();
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `MatrixCare_Upload_${new Date().toISOString().split('T')[0]}.xlsx`;
                          document.body.appendChild(a);
                          a.click();
                          window.URL.revokeObjectURL(url);
                          document.body.removeChild(a);
                          
                          // Show appropriate message based on validation
                          if (validationStatus === 'invalid') {
                            toast({
                              title: "Export Completed with Issues",
                              description: "The export has validation issues. Please check the 'Validation Report' sheet in the Excel file before uploading to MatrixCare.",
                              variant: "destructive",
                              duration: 8000,
                            });
                          } else if (validationSuggestions) {
                            toast({
                              title: "Export Successful with Suggestions",
                              description: "MatrixCare template downloaded. AI validation suggests reviewing the data. Check 'Validation Report' sheet for details.",
                              duration: 6000,
                            });
                          } else {
                            toast({
                              title: "Export Successful",
                              description: "MatrixCare Excel template has been downloaded and validated successfully.",
                            });
                          }
                        } catch (error) {
                          toast({
                            title: "Export Failed",
                            description: "Failed to export MatrixCare template.",
                            variant: "destructive",
                          });
                        }
                      }}
                      variant="outline"
                      className="flex-1"
                      data-testid="button-export-matrixcare-excel"
                    >
                      <FileSpreadsheet className="w-4 h-4 mr-2" />
                      Excel Format
                    </Button>
                    <Button
                      onClick={async () => {
                        try {
                          const response = await fetch('/api/export/matrixcare?format=csv');
                          
                          // Check validation status from headers
                          const validationStatus = response.headers.get('X-Validation-Status');
                          const validationSuggestions = response.headers.get('X-Validation-Suggestions');
                          
                          const blob = await response.blob();
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `MatrixCare_Upload_${new Date().toISOString().split('T')[0]}.csv`;
                          document.body.appendChild(a);
                          a.click();
                          window.URL.revokeObjectURL(url);
                          document.body.removeChild(a);
                          
                          // Show appropriate message based on validation
                          if (validationStatus === 'invalid') {
                            toast({
                              title: "Export Completed with Issues",
                              description: "The export has validation issues. Check the validation comments at the end of the CSV file before uploading to MatrixCare.",
                              variant: "destructive",
                              duration: 8000,
                            });
                          } else if (validationSuggestions) {
                            toast({
                              title: "Export Successful with Suggestions",
                              description: "MatrixCare CSV downloaded. AI validation suggests reviewing the data. Check comments at end of file for details.",
                              duration: 6000,
                            });
                          } else {
                            toast({
                              title: "Export Successful",
                              description: "MatrixCare CSV has been downloaded and validated successfully.",
                            });
                          }
                        } catch (error) {
                          toast({
                            title: "Export Failed",
                            description: "Failed to export MatrixCare CSV.",
                            variant: "destructive",
                          });
                        }
                      }}
                      variant="outline"
                      className="flex-1"
                      data-testid="button-export-matrixcare-csv"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      CSV Format
                    </Button>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <h3 className="font-medium text-sm">Pricing Recommendations</h3>
                  <p className="text-xs text-gray-600">Export current pricing recommendations</p>
                  <Button
                    onClick={async () => {
                      try {
                        const response = await fetch('/api/publish', { method: 'POST' });
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `pricing_recommendations_${new Date().toISOString().split('T')[0]}.csv`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                        
                        toast({
                          title: "Export Successful",
                          description: "Pricing recommendations have been exported.",
                        });
                      } catch (error) {
                        toast({
                          title: "Export Failed",
                          description: "Failed to export pricing recommendations.",
                          variant: "destructive",
                        });
                      }
                    }}
                    variant="outline"
                    className="w-full"
                    data-testid="button-export-recommendations"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export Recommendations CSV
                  </Button>
                </div>
              </div>
              
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>MatrixCare Export:</strong> Includes facility names, room types with A/B/C ratings, service lines, 
                  daily rates, and payer types formatted for direct import into MatrixCare.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          {/* Pricing Strategy Documentation */}
          <PricingStrategyDocumentation />

          {/* Data Upload Instructions */}
          <Card>
            <CardHeader>
              <CardTitle>Data Upload Instructions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <h3 className="font-semibold text-lg text-[var(--trilogy-blue)]">Template Format</h3>
                <p className="text-sm text-gray-600">Single comprehensive sheet containing all portfolio data</p>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs font-mono text-gray-700">
                    Date | Region | Division | Location | Room Number | Room Type | Service Line | Occupied Y/N | Days Vacant | 
                    Preferred Location | Size | View | Renovated | Other Premium Feature | 
                    Street Rate | In-House Rate | Discount to Street Rate | Care Level | 
                    Care Rate | Rent and Care Rate | Competitor Rate | Competitor Average Care Rate | 
                    Competitor Final Rate | Census | Occupancy % | Move-ins | Move-outs | 
                    Revenue | RevPAR | RevPOR | ADR | Budget Revenue | Budget RevPOR | Budget ADR | Market Rate
                  </p>
                </div>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Important:</strong> Ensure all location names are consistent throughout the template. 
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