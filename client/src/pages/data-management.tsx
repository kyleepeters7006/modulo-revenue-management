import Navigation from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react";
import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import PricingStrategyDocumentation from "@/components/pricing-strategy-documentation";

export default function DataManagement() {
  const [uploadHistory, setUploadHistory] = useState<any[]>([]);
  const [isUploadingRentRoll, setIsUploadingRentRoll] = useState(false);
  const [isUploadingInquiry, setIsUploadingInquiry] = useState(false);
  const [isUploadingCompetitor, setIsUploadingCompetitor] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadDate, setUploadDate] = useState<string>('');
  const rentRollFileInputRef = useRef<HTMLInputElement>(null);
  const inquiryFileInputRef = useRef<HTMLInputElement>(null);
  const competitorFileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleDownloadTemplate = async (type: 'rent-roll' | 'inquiry' | 'competitor') => {
    try {
      const endpoints = {
        'rent-roll': '/api/template/rent-roll',
        'inquiry': '/api/template/inquiry',
        'competitor': '/api/template/competitor'
      };
      
      const filenames = {
        'rent-roll': 'rent_roll_template.xlsx',
        'inquiry': 'inquiry_data_template.xlsx',
        'competitor': 'competitive_data_template.xlsx'
      };
      
      const response = await fetch(endpoints[type]);
      const blob = await response.blob();
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filenames[type];
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Template Downloaded",
        description: `${type.replace('-', ' ')} template has been downloaded successfully.`,
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Failed to download template. Please try again.",
        variant: "destructive",
      });
    }
  };

  const rentRollMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      setIsUploadingRentRoll(true);
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
        description: `Processed ${data.recordsProcessed || 0} rent roll records.`,
      });
      setUploadHistory(prev => [{ ...data, type: 'rent-roll', timestamp: new Date() }, ...prev.slice(0, 9)]);
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
      setIsUploadingRentRoll(false);
      if (rentRollFileInputRef.current) {
        rentRollFileInputRef.current.value = '';
      }
    },
  });

  const inquiryMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      setIsUploadingInquiry(true);
      const response = await fetch('/api/upload/inquiry', {
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
        description: `Processed ${data.recordsProcessed || 0} inquiry records.`,
      });
      setUploadHistory(prev => [{ ...data, type: 'inquiry', timestamp: new Date() }, ...prev.slice(0, 9)]);
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
      setIsUploadingInquiry(false);
      if (inquiryFileInputRef.current) {
        inquiryFileInputRef.current.value = '';
      }
    },
  });

  const competitorMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      setIsUploadingCompetitor(true);
      const response = await fetch('/api/upload/competitor', {
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
        description: `Processed ${data.recordsProcessed || 0} competitor records.`,
      });
      setUploadHistory(prev => [{ ...data, type: 'competitor', timestamp: new Date() }, ...prev.slice(0, 9)]);
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
      setIsUploadingCompetitor(false);
      if (competitorFileInputRef.current) {
        competitorFileInputRef.current.value = '';
      }
    },
  });

  // Parse date from filename (e.g., "RentRoll_1.31.25.csv" -> "2025-01-31")
  const parseDateFromFilename = (filename: string): string => {
    // Try various date patterns
    const patterns = [
      /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/,  // 1.31.25 or 01.31.2025
      /(\d{1,2})-(\d{1,2})-(\d{2,4})/,    // 1-31-25 or 01-31-2025
      /(\d{4})-(\d{1,2})-(\d{1,2})/,      // 2025-01-31
      /(\d{4})(\d{2})(\d{2})/             // 20250131
    ];
    
    for (const pattern of patterns) {
      const match = filename.match(pattern);
      if (match) {
        let year, month, day;
        
        if (pattern === patterns[2]) {
          // YYYY-MM-DD format
          [, year, month, day] = match;
        } else if (pattern === patterns[3]) {
          // YYYYMMDD format
          [, year, month, day] = match;
        } else {
          // MM.DD.YY or MM-DD-YY format
          [, month, day, year] = match;
          
          // Convert 2-digit year to 4-digit
          if (year.length === 2) {
            const yearNum = parseInt(year);
            year = yearNum < 50 ? `20${year}` : `19${year}`;
          }
        }
        
        // Pad month and day with leading zeros if needed
        month = month.padStart(2, '0');
        day = day.padStart(2, '0');
        
        return `${year}-${month}-${day}`;
      }
    }
    
    // Default to current month if no date found
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setSelectedFile(file);
    
    // Parse date from filename and pre-populate
    const parsedDate = parseDateFromFilename(file.name);
    setUploadDate(parsedDate);
  };

  const handleConfirmUpload = () => {
    if (!selectedFile || !uploadDate) {
      toast({
        title: "Missing Information",
        description: "Please select a file and upload date.",
        variant: "destructive",
      });
      return;
    }
    
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('uploadDate', uploadDate);
    
    rentRollMutation.mutate(formData);
    
    // Reset
    setSelectedFile(null);
    setUploadDate('');
  };

  const handleFileUpload = (type: 'rent-roll' | 'inquiry' | 'competitor') => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    const mutations = {
      'rent-roll': rentRollMutation,
      'inquiry': inquiryMutation,
      'competitor': competitorMutation
    };
    
    mutations[type].mutate(formData);
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
            Upload rent roll, inquiry, and competitive data to power your revenue management dashboard
          </p>
        </div>

        <div className="space-y-6">
          {/* Rent Roll Upload */}
          <Card>
            <CardHeader>
              <CardTitle>Rent Roll Data Upload</CardTitle>
              <CardDescription>
                Upload monthly rent roll data including occupancy, rates, and unit details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <FileSpreadsheet className="h-4 w-4" />
                <AlertDescription>
                  Upload rent roll data containing unit-level occupancy status, room types, service lines, street rates, care rates, and resident information.
                </AlertDescription>
              </Alert>

              {!selectedFile ? (
                <div className="flex flex-col space-y-3">
                  <Button
                    onClick={() => handleDownloadTemplate('rent-roll')}
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white"
                    data-testid="button-download-rent-roll-template"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Rent Roll Template
                  </Button>
                  
                  <Button
                    onClick={() => rentRollFileInputRef.current?.click()}
                    disabled={isUploadingRentRoll}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white border-2 border-blue-600"
                    data-testid="button-select-rent-roll-file"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Select Rent Roll File
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm font-medium text-blue-900 mb-1">Selected File:</p>
                    <p className="text-sm text-blue-700">{selectedFile.name}</p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="upload-date" className="text-sm font-medium">
                      Upload Date (YYYY-MM-DD)
                    </Label>
                    <Input
                      id="upload-date"
                      type="date"
                      value={uploadDate}
                      onChange={(e) => setUploadDate(e.target.value)}
                      className="w-full"
                      data-testid="input-upload-date"
                    />
                    <p className="text-xs text-gray-500">
                      Date auto-detected from filename. You can change it if needed.
                    </p>
                  </div>
                  
                  <div className="flex gap-3">
                    <Button
                      onClick={handleConfirmUpload}
                      disabled={isUploadingRentRoll || !uploadDate}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                      data-testid="button-confirm-upload"
                    >
                      {isUploadingRentRoll ? 'Processing...' : 'Confirm Upload'}
                    </Button>
                    <Button
                      onClick={() => {
                        setSelectedFile(null);
                        setUploadDate('');
                        if (rentRollFileInputRef.current) {
                          rentRollFileInputRef.current.value = '';
                        }
                      }}
                      variant="outline"
                      disabled={isUploadingRentRoll}
                      data-testid="button-cancel-upload"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              
              <input
                ref={rentRollFileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileSelect}
                data-testid="input-rent-roll-file"
              />
            </CardContent>
          </Card>

          {/* Inquiry Data Upload */}
          <Card>
            <CardHeader>
              <CardTitle>Inquiry Data Upload</CardTitle>
              <CardDescription>
                Upload inquiry and tour data to track lead sources and conversion metrics
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <FileSpreadsheet className="h-4 w-4" />
                <AlertDescription>
                  Upload inquiry data including lead sources, tour dates, inquiry counts, conversion rates, and marketing channel performance.
                </AlertDescription>
              </Alert>

              <div className="flex flex-col space-y-3">
                <Button
                  onClick={() => handleDownloadTemplate('inquiry')}
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white"
                  data-testid="button-download-inquiry-template"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Inquiry Template
                </Button>
                
                <Button
                  onClick={() => inquiryFileInputRef.current?.click()}
                  disabled={isUploadingInquiry}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white border-2 border-blue-600"
                  data-testid="button-upload-inquiry"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {isUploadingInquiry ? 'Processing...' : 'Upload Inquiry Data'}
                </Button>
              </div>
              
              <input
                ref={inquiryFileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileUpload('inquiry')}
                data-testid="input-inquiry-file"
              />
            </CardContent>
          </Card>

          {/* Competitive Data Upload */}
          <Card>
            <CardHeader>
              <CardTitle>Competitive Data Upload</CardTitle>
              <CardDescription>
                Upload competitor pricing and market analysis data
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <FileSpreadsheet className="h-4 w-4" />
                <AlertDescription>
                  Upload competitor data including facility names, room types, service lines, base rates, care rates, and location information for market benchmarking.
                </AlertDescription>
              </Alert>

              <div className="flex flex-col space-y-3">
                <Button
                  onClick={() => handleDownloadTemplate('competitor')}
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white"
                  data-testid="button-download-competitor-template"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Competitor Template
                </Button>
                
                <Button
                  onClick={() => competitorFileInputRef.current?.click()}
                  disabled={isUploadingCompetitor}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white border-2 border-blue-600"
                  data-testid="button-upload-competitor"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {isUploadingCompetitor ? 'Processing...' : 'Upload Competitor Data'}
                </Button>
              </div>
              
              <input
                ref={competitorFileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileUpload('competitor')}
                data-testid="input-competitor-file"
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
                  <h3 className="font-medium text-sm">MatrixCare Street Rates (New Admissions)</h3>
                  <p className="text-xs text-gray-600">Export Corporate Room Charges for new admissions</p>
                  <Button
                    onClick={async () => {
                      try {
                        const response = await fetch('/api/export/street-rates');
                        
                        const validationStatus = response.headers.get('X-Validation-Status');
                        const validationSummary = response.headers.get('X-Validation-Summary');
                        
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `CORPORATEROOMCHARGESEXPORT_Trilogy_${new Date().toISOString().split('T')[0]}.CSV`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                        
                        if (validationStatus === 'valid') {
                          toast({
                            title: "Street Rates Export Successful",
                            description: "Corporate Room Charges exported for new admissions. Ready for MatrixCare upload.",
                          });
                        } else {
                          toast({
                            title: "Export Completed with Issues",
                            description: "Please review the exported file before uploading to MatrixCare.",
                            variant: "destructive",
                          });
                        }
                      } catch (error) {
                        toast({
                          title: "Export Failed",
                          description: "Failed to export Street Rates.",
                          variant: "destructive",
                        });
                      }
                    }}
                    variant="outline"
                    className="w-full"
                    data-testid="button-export-street-rates"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export Street Rates
                  </Button>
                </div>

                <div className="space-y-2">
                  <h3 className="font-medium text-sm">MatrixCare Special Rates (Current Residents)</h3>
                  <p className="text-xs text-gray-600">Freeze rates for existing residents</p>
                  <Button
                    onClick={async () => {
                      try {
                        const response = await fetch('/api/export/special-rates');
                        
                        const validationStatus = response.headers.get('X-Validation-Status');
                        const validationSummary = response.headers.get('X-Validation-Summary');
                        
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `SPECIALROOMRATESEXPORT_Trilogy_${new Date().toISOString().split('T')[0]}.CSV`;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                        
                        if (validationStatus === 'valid') {
                          toast({
                            title: "Special Rates Export Successful",
                            description: "Special rates exported for current residents. Ready for MatrixCare upload.",
                          });
                        } else {
                          toast({
                            title: "Export Completed with Issues",
                            description: "Please review the exported file before uploading to MatrixCare.",
                            variant: "destructive",
                          });
                        }
                      } catch (error) {
                        toast({
                          title: "Export Failed",
                          description: "Failed to export Special Rates.",
                          variant: "destructive",
                        });
                      }
                    }}
                    variant="outline"
                    className="w-full"
                    data-testid="button-export-special-rates"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Export Special Rates
                  </Button>
                </div>

                <div className="space-y-2">
                  <h3 className="font-medium text-sm">MatrixCare Full Export</h3>
                  <p className="text-xs text-gray-600">Export complete data for MatrixCare EHR system</p>
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
                  {uploadHistory.map((upload, index) => {
                    const typeLabels = {
                      'rent-roll': 'Rent Roll',
                      'inquiry': 'Inquiry Data',
                      'competitor': 'Competitive Data'
                    };
                    
                    return (
                      <div key={index} className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                            <p className="font-medium text-green-900">
                              {typeLabels[upload.type as keyof typeof typeLabels] || 'Data'} Upload Successful
                            </p>
                          </div>
                          <div className="text-sm text-green-700 ml-7">
                            <span>{upload.recordsProcessed || 0} records processed</span>
                            {upload.uploadMonth && <span className="ml-4">Month: {upload.uploadMonth}</span>}
                          </div>
                          <p className="text-xs text-green-600 ml-7">
                            {new Date(upload.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}