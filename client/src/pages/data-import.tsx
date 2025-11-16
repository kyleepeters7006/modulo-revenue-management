import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, Download } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface ImportStatus {
  rentRollHistory?: {
    months: string[];
    totalRecords: number;
  };
  enquireData?: {
    totalRecords: number;
    mappedRecords: number;
    unmappedRecords: number;
  };
  competitiveSurvey?: {
    months: string[];
    totalRecords: number;
  };
  locationMappings?: {
    totalMappings: number;
    autoMapped: number;
    manualMapped: number;
  };
}

interface DataCategory {
  id: string;
  category: string;
  description: string;
  fileType: string;
  importEndpoint: string;
  exportEndpoint?: string;
  requiresMonth?: boolean;
  requiresSource?: boolean;
}

const dataCategories: DataCategory[] = [
  {
    id: 'rent-roll',
    category: 'Rent Roll History',
    description: 'Monthly rent roll CSV files',
    fileType: '.csv',
    importEndpoint: '/api/import/rent-roll',
    exportEndpoint: '/api/export/rent-roll-history/',
    requiresMonth: true,
  },
  {
    id: 'enquire-senior',
    category: 'Enquire - Senior Housing',
    description: 'Senior housing inquiry and tour data',
    fileType: '.csv',
    importEndpoint: '/api/import/enquire',
    exportEndpoint: '/api/export/enquire-data?dataSource=Senior Housing',
    requiresSource: true,
  },
  {
    id: 'enquire-post-acute',
    category: 'Enquire - Post Acute',
    description: 'Post acute inquiry and tour data',
    fileType: '.csv',
    importEndpoint: '/api/import/enquire',
    exportEndpoint: '/api/export/enquire-data?dataSource=Post Acute',
    requiresSource: true,
  },
  {
    id: 'competitive-survey',
    category: 'Competitive Survey',
    description: 'Competitor pricing survey data',
    fileType: '.xlsx',
    importEndpoint: '/api/import/competitive-survey',
    exportEndpoint: '/api/export/competitive-survey/',
    requiresMonth: true,
  },
  {
    id: 'location-mappings',
    category: 'Location Mappings',
    description: 'Campus location mapping configuration',
    fileType: 'N/A',
    importEndpoint: '',
    exportEndpoint: '/api/export/location-mappings',
  },
];

export default function DataImport() {
  const [selectedFiles, setSelectedFiles] = useState<Record<string, File>>({});
  const [selectedMonths, setSelectedMonths] = useState<Record<string, string>>({});
  
  // Initialize months with current month
  useState(() => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    setSelectedMonths({
      'rent-roll': currentMonth,
      'competitive-survey': currentMonth,
    });
  });

  // Fetch import status
  const { data: importStatus, refetch: refetchStatus } = useQuery<ImportStatus>({
    queryKey: ['/api/import/status'],
  });

  // Generic import mutation
  const importMutation = useMutation({
    mutationFn: async ({ categoryId, file }: { categoryId: string; file: File }) => {
      const category = dataCategories.find(c => c.id === categoryId);
      if (!category || !category.importEndpoint) return;

      const formData = new FormData();
      formData.append('file', file);
      
      if (category.requiresMonth && selectedMonths[categoryId]) {
        formData.append('uploadMonth', selectedMonths[categoryId]);
        formData.append('surveyMonth', selectedMonths[categoryId]);
      }
      
      if (category.requiresSource) {
        const source = categoryId === 'enquire-senior' ? 'Senior Housing' : 'Post Acute';
        formData.append('dataSource', source);
      }

      const response = await fetch(category.importEndpoint, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error("Import failed");
      return response.json();
    },
    onSuccess: (data, { categoryId }) => {
      const category = dataCategories.find(c => c.id === categoryId);
      toast({
        title: "Import Successful",
        description: `Successfully imported ${category?.category} data`,
      });
      refetchStatus();
      setSelectedFiles(prev => ({ ...prev, [categoryId]: undefined } as any));
    },
    onError: (error: any) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (categoryId: string, file: File | null) => {
    if (file) {
      setSelectedFiles(prev => ({ ...prev, [categoryId]: file }));
    }
  };

  const handleImport = (categoryId: string) => {
    const file = selectedFiles[categoryId];
    if (!file) {
      toast({
        title: "No file selected",
        description: "Please select a file to import",
        variant: "destructive",
      });
      return;
    }
    importMutation.mutate({ categoryId, file });
  };

  const handleExport = (category: DataCategory) => {
    if (!category.exportEndpoint) return;
    
    let exportUrl = category.exportEndpoint;
    if (category.requiresMonth && selectedMonths[category.id]) {
      exportUrl += selectedMonths[category.id];
    }
    
    window.location.href = exportUrl;
  };

  const getRecordCount = (categoryId: string): string => {
    if (!importStatus) return '-';
    
    switch (categoryId) {
      case 'rent-roll':
        return importStatus.rentRollHistory?.totalRecords?.toLocaleString() || '-';
      case 'enquire-senior':
      case 'enquire-post-acute':
        return importStatus.enquireData?.totalRecords?.toLocaleString() || '-';
      case 'competitive-survey':
        return importStatus.competitiveSurvey?.totalRecords?.toLocaleString() || '-';
      case 'location-mappings':
        return importStatus.locationMappings?.totalMappings?.toLocaleString() || '-';
      default:
        return '-';
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Data Management</h1>
        <div className="text-sm text-muted-foreground">
          Import and export production data files
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Data Import/Export</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[25%]">Category</TableHead>
                <TableHead className="w-[35%]">File Selection</TableHead>
                <TableHead className="w-[15%] text-center">Records</TableHead>
                <TableHead className="w-[25%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dataCategories.map((category) => (
                <TableRow key={category.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{category.category}</div>
                      <div className="text-xs text-muted-foreground">
                        {category.fileType !== 'N/A' ? `Accepts ${category.fileType}` : category.description}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {category.importEndpoint ? (
                      <div className="flex gap-2 items-center">
                        {category.requiresMonth && (
                          <Input
                            type="month"
                            value={selectedMonths[category.id] || ''}
                            onChange={(e) => setSelectedMonths(prev => ({
                              ...prev,
                              [category.id]: e.target.value
                            }))}
                            className="w-36"
                          />
                        )}
                        <Input
                          type="file"
                          accept={category.fileType}
                          onChange={(e) => handleFileSelect(category.id, e.target.files?.[0] || null)}
                          className="flex-1"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Export only
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {getRecordCount(category.id)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-2 justify-end">
                      {category.exportEndpoint && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleExport(category)}
                        >
                          <Download className="h-4 w-4 mr-1" />
                          Export
                        </Button>
                      )}
                      {category.importEndpoint && (
                        <Button
                          size="sm"
                          onClick={() => handleImport(category.id)}
                          disabled={importMutation.isPending || !selectedFiles[category.id]}
                        >
                          <Upload className="h-4 w-4 mr-1" />
                          Import
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Summary Statistics */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Rent Roll Months</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {importStatus?.rentRollHistory?.months?.length || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Enquire Records</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {importStatus?.enquireData?.totalRecords?.toLocaleString() || 0}
            </div>
            <div className="text-xs text-muted-foreground">
              {importStatus?.enquireData?.mappedRecords?.toLocaleString() || 0} mapped
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Survey Months</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {importStatus?.competitiveSurvey?.months?.length || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Location Mappings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {importStatus?.locationMappings?.totalMappings || 0}
            </div>
            <div className="text-xs text-muted-foreground">
              {importStatus?.locationMappings?.autoMapped || 0} auto-mapped
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}