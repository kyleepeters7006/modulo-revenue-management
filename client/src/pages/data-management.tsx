import Navigation from "@/components/navigation";
import TemplateDownload from "@/components/dashboard/template-download";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DataManagement() {
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
          <Card>
            <CardHeader>
              <CardTitle>Excel Template</CardTitle>
            </CardHeader>
            <CardContent>
              <TemplateDownload />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upload Data</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 mb-4">
                Upload your monthly rent roll data using the template above.
              </p>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <p className="text-gray-500">File upload functionality coming soon</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}