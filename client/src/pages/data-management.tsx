import Navigation from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import PricingStrategyDocumentation from "@/components/pricing-strategy-documentation";
import { useUploads } from "@/contexts/upload-context";

interface FileWithDate {
  file: File;
  uploadDate: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

export default function DataManagement() {
  const [uploadHistory, setUploadHistory] = useState<any[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<FileWithDate[]>([]);
  const rentRollFileInputRef = useRef<HTMLInputElement>(null);
  const inquiryFileInputRef = useRef<HTMLInputElement>(null);
  const competitorFileInputRef = useRef<HTMLInputElement>(null);
  const locationFileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeUploads, addUpload, updateUpload, isUploading } = useUploads();

  const handleDownloadTemplate = async (type: 'rent-roll' | 'inquiry' | 'competitor' | 'location') => {
    try {
      const endpoints = {
        'rent-roll': '/api/template/rent-roll',
        'inquiry': '/api/template/inquiry',
        'competitor': '/api/template/competitor',
        'location': '/api/template/location'
      };
      
      const filenames = {
        'rent-roll': 'rent_roll_template.xlsx',
        'inquiry': 'inquiry_data_template.xlsx',
        'competitor': 'competitive_data_template.xlsx',
        'location': 'location_template.xlsx'
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
    mutationFn: async ({ formData, uploadId }: { formData: FormData; uploadId: string }) => {
      const response = await fetch('/api/upload/rent-roll', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Upload failed');
      }
      
      return { data: await response.json(), uploadId };
    },
    onSuccess: ({ data, uploadId }) => {
      updateUpload(uploadId, { status: 'success', message: `Processed ${data.recordsProcessed || 0} records` });
      toast({
        title: "Upload Successful",
        description: `Processed ${data.recordsProcessed || 0} rent roll records.`,
      });
      setUploadHistory(prev => [{ ...data, type: 'rent-roll', timestamp: new Date() }, ...prev.slice(0, 9)]);
      queryClient.invalidateQueries({ queryKey: ["/api"] });
    },
    onError: (error: Error, variables) => {
      updateUpload(variables.uploadId, { status: 'error', error: error.message });
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      if (rentRollFileInputRef.current) {
        rentRollFileInputRef.current.value = '';
      }
    },
  });

  const inquiryMutation = useMutation({
    mutationFn: async ({ formData, uploadId }: { formData: FormData; uploadId: string }) => {
      const response = await fetch('/api/upload/inquiry', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Upload failed');
      }
      
      return { data: await response.json(), uploadId };
    },
    onSuccess: ({ data, uploadId }) => {
      updateUpload(uploadId, { status: 'success', message: `Processed ${data.recordsProcessed || 0} records` });
      toast({
        title: "Upload Successful",
        description: `Processed ${data.recordsProcessed || 0} inquiry records.`,
      });
      setUploadHistory(prev => [{ ...data, type: 'inquiry', timestamp: new Date() }, ...prev.slice(0, 9)]);
      queryClient.invalidateQueries({ queryKey: ["/api"] });
    },
    onError: (error: Error, variables) => {
      updateUpload(variables.uploadId, { status: 'error', error: error.message });
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      if (inquiryFileInputRef.current) {
        inquiryFileInputRef.current.value = '';
      }
    },
  });

  const competitorMutation = useMutation({
    mutationFn: async ({ formData, uploadId }: { formData: FormData; uploadId: string }) => {
      // Add current month as surveyMonth if not already present
      if (!formData.has('surveyMonth')) {
        const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM format
        formData.append('surveyMonth', currentMonth);
      }
      
      const response = await fetch('/api/import/competitive-survey', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Upload failed');
      }
      
      return { data: await response.json(), uploadId };
    },
    onSuccess: ({ data, uploadId }) => {
      const imported = data.successfulImports || 0;
      const totalRows = data.totalRecords || 0;
      const hasWarning = imported === 0 && totalRows > 0;

      if (hasWarning) {
        updateUpload(uploadId, { status: 'error', message: `0 of ${totalRows} rows imported — column format mismatch` });
        toast({
          title: "Competitive Survey: 0 Records Imported",
          description: data.warning || `The file had ${totalRows} rows but 0 records were imported. The column names likely don't match the expected template format (TrilogyCampusName, AL, HC, AL_StudioRate, etc.).`,
          variant: "destructive",
        });
      } else {
        updateUpload(uploadId, { status: 'success', message: `Processed ${imported} records` });
        toast({
          title: "Competitive Survey Upload Successful",
          description: `Processed ${imported} competitive survey records. System will recalculate competitor rates in the background.`,
        });
      }
      setUploadHistory(prev => [{ ...data, type: 'competitor', timestamp: new Date() }, ...prev.slice(0, 9)]);
      queryClient.invalidateQueries({ queryKey: ["/api"] });
      
      // Only trigger recalculation if records were actually imported
      if (imported > 0) {
        fetch('/api/competitor-rates/recalculate', { method: 'POST' }).catch(err => {
          console.warn('Failed to trigger competitor rate recalculation:', err);
        });
      }
    },
    onError: (error: Error, variables) => {
      updateUpload(variables.uploadId, { status: 'error', error: error.message });
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      if (competitorFileInputRef.current) {
        competitorFileInputRef.current.value = '';
      }
    },
  });

  const locationMutation = useMutation({
    mutationFn: async ({ formData, uploadId }: { formData: FormData; uploadId: string }) => {
      const response = await fetch('/api/upload/locations', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Upload failed');
      }
      
      return { data: await response.json(), uploadId };
    },
    onSuccess: ({ data, uploadId }) => {
      updateUpload(uploadId, { status: 'success', message: `Processed ${data.recordsProcessed || 0} locations` });
      toast({
        title: "Location Upload Successful",
        description: `Processed ${data.recordsProcessed || 0} locations (${data.created || 0} created, ${data.updated || 0} updated).`,
      });
      setUploadHistory(prev => [{ ...data, type: 'location', timestamp: new Date() }, ...prev.slice(0, 9)]);
      queryClient.invalidateQueries({ queryKey: ["/api"] });
    },
    onError: (error: Error, variables) => {
      updateUpload(variables.uploadId, { status: 'error', error: error.message });
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      if (locationFileInputRef.current) {
        locationFileInputRef.current.value = '';
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
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    // Convert FileList to array and create FileWithDate objects
    const filesArray = Array.from(files).map(file => ({
      file,
      uploadDate: parseDateFromFilename(file.name),
      status: 'pending' as const
    }));
    
    setSelectedFiles(filesArray);
  };

  const handleUpdateFileDate = (index: number, newDate: string) => {
    setSelectedFiles(prev => prev.map((f, idx) => 
      idx === index ? { ...f, uploadDate: newDate } : f
    ));
  };

  const handleConfirmUpload = async () => {
    if (selectedFiles.length === 0) {
      toast({
        title: "No Files Selected",
        description: "Please select at least one file to upload.",
        variant: "destructive",
      });
      return;
    }
    
    // Validate all file dates before uploading
    const invalidFiles = selectedFiles.filter(f => !f.uploadDate || f.uploadDate.trim() === '');
    if (invalidFiles.length > 0) {
      // Mark invalid files with error status
      setSelectedFiles(prev => prev.map(f => 
        (!f.uploadDate || f.uploadDate.trim() === '') 
          ? { ...f, status: 'error' as const, error: 'Upload date is required' } 
          : f
      ));
      
      toast({
        title: "Invalid Upload Dates",
        description: `${invalidFiles.length} file(s) have missing or invalid upload dates. Please correct them before uploading.`,
        variant: "destructive",
      });
      return;
    }
    
    // Create a batch upload tracking entry
    const batchUploadId = addUpload({
      type: 'rent-roll',
      fileName: `${selectedFiles.length} files`,
      status: 'uploading',
    });
    
    // Track results in a local array
    const results: Array<{ success: boolean; error?: string }> = [];
    
    // Process files sequentially
    for (let i = 0; i < selectedFiles.length; i++) {
      const fileWithDate = selectedFiles[i];
      
      // Update status to uploading and clear any previous error
      setSelectedFiles(prev => prev.map((f, idx) => 
        idx === i ? { ...f, status: 'uploading' as const, error: undefined } : f
      ));
      
      try {
        const formData = new FormData();
        formData.append('file', fileWithDate.file);
        formData.append('uploadDate', fileWithDate.uploadDate);
        
        const response = await fetch('/api/upload/rent-roll', {
          method: 'POST',
          body: formData,
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Upload failed');
        }
        
        const data = await response.json();
        
        // Update status to success and clear any previous error
        setSelectedFiles(prev => prev.map((f, idx) => 
          idx === i ? { ...f, status: 'success' as const, error: undefined } : f
        ));
        
        setUploadHistory(prev => [{ ...data, type: 'rent-roll', timestamp: new Date() }, ...prev.slice(0, 9)]);
        results.push({ success: true });
      } catch (error: any) {
        // Update status to error
        setSelectedFiles(prev => prev.map((f, idx) => 
          idx === i ? { ...f, status: 'error' as const, error: error.message } : f
        ));
        results.push({ success: false, error: error.message });
      }
    }
    
    // Update the batch upload status
    const successCount = results.filter(r => r.success).length;
    const errorCount = results.filter(r => !r.success).length;
    updateUpload(batchUploadId, { 
      status: errorCount > 0 ? 'error' : 'success', 
      message: `${successCount} succeeded, ${errorCount} failed` 
    });
    queryClient.invalidateQueries({ queryKey: ["/api"] });
    
    toast({
      title: "Batch Upload Complete",
      description: `Successfully uploaded ${successCount} file(s). ${errorCount > 0 ? `${errorCount} failed.` : ''}`,
      variant: errorCount > 0 ? "destructive" : "default",
    });
    
    // Only clear successful files, keep failed ones visible for user review
    setSelectedFiles(prev => prev.filter(f => f.status === 'error'));
    
    // Clear file input only if all files succeeded
    if (errorCount === 0 && rentRollFileInputRef.current) {
      rentRollFileInputRef.current.value = '';
    }
  };

  const handleFileUpload = (type: 'rent-roll' | 'inquiry' | 'competitor' | 'location') => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    const uploadId = addUpload({
      type,
      fileName: file.name,
      status: 'uploading',
    });
    
    const mutations = {
      'rent-roll': rentRollMutation,
      'inquiry': inquiryMutation,
      'competitor': competitorMutation,
      'location': locationMutation
    };
    
    mutations[type].mutate({ formData, uploadId });
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

        {/* Active Uploads Banner */}
        {activeUploads.length > 0 && (
          <Card className="mb-6 border-blue-200 bg-blue-50">
            <CardContent className="py-4">
              <h3 className="text-sm font-medium text-blue-900 mb-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Active Uploads
              </h3>
              <div className="space-y-2">
                {activeUploads.map((upload) => (
                  <div 
                    key={upload.id} 
                    className="flex items-center justify-between p-2 bg-white rounded border border-blue-100"
                  >
                    <div className="flex items-center gap-3">
                      {upload.status === 'uploading' || upload.status === 'processing' ? (
                        <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                      ) : upload.status === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-red-600" />
                      )}
                      <div>
                        <span className="text-sm font-medium capitalize">{upload.type.replace('-', ' ')}</span>
                        <span className="text-sm text-gray-500 ml-2">{upload.fileName}</span>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${
                      upload.status === 'success' ? 'bg-green-100 text-green-700' :
                      upload.status === 'error' ? 'bg-red-100 text-red-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {upload.status === 'uploading' ? 'Uploading...' : 
                       upload.status === 'processing' ? 'Processing...' :
                       upload.status === 'success' ? 'Complete' : 
                       upload.error || 'Failed'}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-6">
          {/* Location/Region/Division Upload */}
          <Card>
            <CardHeader>
              <CardTitle>Location Data Upload</CardTitle>
              <CardDescription>
                Upload your organization's locations with region and division hierarchy
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <FileSpreadsheet className="h-4 w-4" />
                <AlertDescription>
                  Upload location data including facility names, regions, divisions, and addresses. This establishes the organizational hierarchy for all data.
                </AlertDescription>
              </Alert>

              <div className="flex flex-col space-y-3">
                <Button
                  onClick={() => handleDownloadTemplate('location')}
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white"
                  data-testid="button-download-location-template"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Location Template
                </Button>
                
                <Button
                  onClick={() => locationFileInputRef.current?.click()}
                  disabled={isUploading('location')}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white border-2 border-blue-600"
                  data-testid="button-upload-location"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {isUploading('location') ? 'Processing...' : 'Upload Location Data'}
                </Button>
              </div>
              
              <input
                ref={locationFileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileUpload('location')}
                data-testid="input-location-file"
              />
            </CardContent>
          </Card>

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

              {selectedFiles.length === 0 ? (
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
                    disabled={isUploading('rent-roll')}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white border-2 border-blue-600"
                    data-testid="button-select-rent-roll-file"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Select Rent Roll Files
                  </Button>
                  <p className="text-xs text-gray-500 text-center">
                    You can select multiple files at once for batch upload
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg max-h-96 overflow-y-auto">
                    <p className="text-sm font-medium text-blue-900 mb-3">
                      Selected Files: {selectedFiles.length}
                    </p>
                    <div className="space-y-2">
                      {selectedFiles.map((fileWithDate, index) => (
                        <div 
                          key={index} 
                          className={`p-3 rounded border text-sm ${
                            fileWithDate.status === 'success' ? 'bg-green-50 border-green-200' :
                            fileWithDate.status === 'error' ? 'bg-red-50 border-red-200' :
                            fileWithDate.status === 'uploading' ? 'bg-yellow-50 border-yellow-200' :
                            'bg-white border-gray-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900 truncate">
                                {fileWithDate.file.name}
                              </p>
                              <div className="mt-2">
                                <Input
                                  type="date"
                                  value={fileWithDate.uploadDate}
                                  onChange={(e) => handleUpdateFileDate(index, e.target.value)}
                                  disabled={isUploading('rent-roll')}
                                  className="text-xs h-7"
                                  data-testid={`input-file-date-${index}`}
                                />
                              </div>
                              {fileWithDate.error && (
                                <p className="text-xs text-red-600 mt-1">
                                  Error: {fileWithDate.error}
                                </p>
                              )}
                            </div>
                            <div className="ml-3 flex-shrink-0">
                              {fileWithDate.status === 'success' && (
                                <CheckCircle2 className="w-5 h-5 text-green-600" />
                              )}
                              {fileWithDate.status === 'error' && (
                                <AlertCircle className="w-5 h-5 text-red-600" />
                              )}
                              {fileWithDate.status === 'uploading' && (
                                <div className="w-5 h-5 border-2 border-yellow-600 border-t-transparent rounded-full animate-spin" />
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div className="flex gap-3">
                    <Button
                      onClick={handleConfirmUpload}
                      disabled={isUploading('rent-roll')}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                      data-testid="button-confirm-upload"
                    >
                      {isUploading('rent-roll') ? 'Uploading...' : `Upload ${selectedFiles.length} File(s)`}
                    </Button>
                    <Button
                      onClick={() => {
                        setSelectedFiles([]);
                        if (rentRollFileInputRef.current) {
                          rentRollFileInputRef.current.value = '';
                        }
                      }}
                      variant="outline"
                      disabled={isUploading('rent-roll')}
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
                multiple
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
                  disabled={isUploading('inquiry')}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white border-2 border-blue-600"
                  data-testid="button-upload-inquiry"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {isUploading('inquiry') ? 'Processing...' : 'Upload Inquiry Data'}
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
                  disabled={isUploading('competitor')}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white border-2 border-blue-600"
                  data-testid="button-upload-competitor"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {isUploading('competitor') ? 'Processing...' : 'Upload Competitor Data'}
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
                <h3 className="font-semibold text-lg text-[var(--trilogy-blue)]">Source Report</h3>
                <p className="text-sm text-gray-600">KeyStats Rent Roll export from MatrixCare — one file per campus per month</p>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-base text-[var(--trilogy-blue)]">Key Columns Used</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-1 text-gray-800 dark:text-gray-200">
                    <p className="font-semibold text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Identity & Location</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">division</span> — Division name</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">location</span> — Campus name (must match exactly across files)</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">Room_Bed</span> — Unit / bed identifier</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">BedTypeDesc</span> — Room type (Studio, One Bedroom, etc.)</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">Service1</span> — Service line (AL, HC, SL, VIL, etc.)</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">Private_Companion1</span> — Private or Companion unit</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-1 text-gray-800 dark:text-gray-200">
                    <p className="font-semibold text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Occupancy & Resident</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">PatientID1</span> — Resident ID (used for occupancy)</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">MoveInDate</span> — Move-in date</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">MoveOutDate</span> — Move-out date</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">PayerName</span> — Payer type (used for private pay filter)</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">DisplayPayer</span> — Display payer name</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">LevelOfCare1</span> — Care level description</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-1 text-gray-800 dark:text-gray-200">
                    <p className="font-semibold text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Rates</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">BaseRate1</span> — Street rate <span className="text-gray-500">(fallback: Room_Rate)</span></p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">FinalRate</span> — In-house (actual billed) rate</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">BilledRate</span> — Daily billed rate (HC/HC-MC units)</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">BaseLOC1</span> — Base level-of-care rate</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">LOC_Rate</span> — Level-of-care rate</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">Room_Rate_Adjustments</span> — Promotion allowance / RRA (stored negative)</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 space-y-1 text-gray-800 dark:text-gray-200">
                    <p className="font-semibold text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Rate Charge Type</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">ChargeBy</span> — Rate charge basis (Day / Month)</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">Rate_Type</span> — Rate type classification</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">RRADescription</span> — RRA reason description</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">RRAEndDate</span> — RRA expiry date</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">Certified</span> — Certified bed flag</p>
                    <p><span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1 rounded">BedSpecialization1</span> — Bed specialization type</p>
                  </div>
                </div>
              </div>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>HC / HC-MC rates:</strong> Stored as $/day and automatically multiplied by actual calendar days when calculating monthly revenue. All other service lines (AL, SL, VIL, AL/MC) are stored as $/month.
                </AlertDescription>
              </Alert>

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Private Pay Filter:</strong> Revenue calculations exclude residents whose <span className="font-mono text-xs">PayerName</span> contains Hospice, Medicaid, Medicare, or Managed — only private pay residents are counted.
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