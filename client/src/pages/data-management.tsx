import Navigation from "@/components/navigation";
import TemplateDownload from "@/components/dashboard/template-download";
import FileUpload from "@/components/dashboard/file-upload";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useState } from "react";

export default function DataManagement() {
  const [uploadHistory, setUploadHistory] = useState<any[]>([]);

  const handleUploadComplete = (result: any) => {
    setUploadHistory(prev => [result, ...prev]);
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
            Download templates and upload monthly rent roll data
          </p>
        </div>

        <div className="grid gap-6">
          {/* Excel Template Download */}
          <Card>
            <CardHeader>
              <CardTitle>Excel Template</CardTitle>
            </CardHeader>
            <CardContent>
              <TemplateDownload />
            </CardContent>
          </Card>

          {/* File Upload */}
          <FileUpload onUploadComplete={handleUploadComplete} />

          {/* Upload History */}
          {uploadHistory.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent Uploads</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {uploadHistory.map((upload, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200">
                      <div>
                        <p className="font-medium text-green-900">
                          {upload.uploadMonth} - {upload.recordsProcessed} records processed
                        </p>
                        <p className="text-sm text-green-600">
                          Upload completed successfully
                        </p>
                      </div>
                      <div className="text-green-500">
                        ✓
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