import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, FileSpreadsheet, Database, MapPin, CheckCircle, XCircle } from "lucide-react";
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

export default function DataImport() {
  const [rentRollFile, setRentRollFile] = useState<File | null>(null);
  const [rentRollMonth, setRentRollMonth] = useState(new Date().toISOString().slice(0, 7));
  const [enquireFile, setEnquireFile] = useState<File | null>(null);
  const [enquireSource, setEnquireSource] = useState<'Senior Housing' | 'Post Acute'>('Senior Housing');
  const [competitiveFile, setCompetitiveFile] = useState<File | null>(null);
  const [competitiveMonth, setCompetitiveMonth] = useState(new Date().toISOString().slice(0, 7));

  // Fetch import status
  const { data: importStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['/api/import/status'],
  });

  // Fetch location mappings
  const { data: locationMappings, refetch: refetchMappings } = useQuery({
    queryKey: ['/api/import/location-mappings'],
  });

  // Rent Roll Import
  const rentRollImport = useMutation({
    mutationFn: async () => {
      if (!rentRollFile) throw new Error("No file selected");
      
      const formData = new FormData();
      formData.append('file', rentRollFile);
      formData.append('uploadMonth', rentRollMonth);
      
      const response = await fetch('/api/import/rent-roll', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) throw new Error("Import failed");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Rent Roll Imported",
        description: `Successfully imported ${data.successfulImports} records. ${data.unmappedRecords} locations need mapping.`,
      });
      refetchStatus();
      setRentRollFile(null);
    },
    onError: (error: any) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Enquire Import
  const enquireImport = useMutation({
    mutationFn: async () => {
      if (!enquireFile) throw new Error("No file selected");
      
      const formData = new FormData();
      formData.append('file', enquireFile);
      formData.append('dataSource', enquireSource);
      
      const response = await fetch('/api/import/enquire', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) throw new Error("Import failed");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Enquire Data Imported",
        description: `Successfully imported ${data.successfulImports} records. ${data.unmappedRecords} locations need mapping.`,
      });
      refetchStatus();
      setEnquireFile(null);
    },
    onError: (error: any) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Competitive Survey Import
  const competitiveImport = useMutation({
    mutationFn: async () => {
      if (!competitiveFile) throw new Error("No file selected");
      
      const formData = new FormData();
      formData.append('file', competitiveFile);
      formData.append('surveyMonth', competitiveMonth);
      
      const response = await fetch('/api/import/competitive-survey', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) throw new Error("Import failed");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Competitive Survey Imported",
        description: `Successfully imported ${data.successfulImports} records.`,
      });
      refetchStatus();
      setCompetitiveFile(null);
    },
    onError: (error: any) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Auto-map locations
  const autoMapMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/import/auto-map-locations', {
        method: 'POST',
      });
      
      if (!response.ok) throw new Error("Auto-mapping failed");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Auto-Mapping Complete",
        description: `Created ${data.created} automatic mappings. ${data.suggested.length} locations need manual review.`,
      });
      refetchMappings();
      refetchStatus();
    },
    onError: (error: any) => {
      toast({
        title: "Auto-Mapping Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Sync to current month
  const syncToCurrent = useMutation({
    mutationFn: async (month: string) => {
      const response = await fetch(`/api/import/sync-to-current/${month}`, {
        method: 'POST',
      });
      
      if (!response.ok) throw new Error("Sync failed");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Synced to Current",
        description: `Synced ${data.synced} records to current rent roll.`,
      });
      refetchStatus();
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Data Import Management</h1>
        <Button 
          onClick={() => autoMapMutation.mutate()}
          disabled={autoMapMutation.isPending}
          variant="secondary"
        >
          <MapPin className="mr-2 h-4 w-4" />
          Auto-Map Locations
        </Button>
      </div>

      {/* Import Status Overview */}
      {importStatus && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Rent Roll History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{importStatus.rentRollHistory?.totalRecords || 0}</div>
              <p className="text-xs text-muted-foreground">
                {importStatus.rentRollHistory?.months?.length || 0} months loaded
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Enquire Data</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{importStatus.enquireData?.totalRecords || 0}</div>
              <p className="text-xs text-muted-foreground">
                {importStatus.enquireData?.mappedRecords || 0} mapped
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Competitive Survey</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{importStatus.competitiveSurvey?.totalRecords || 0}</div>
              <p className="text-xs text-muted-foreground">
                {importStatus.competitiveSurvey?.months?.length || 0} months
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Location Mappings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{importStatus.locationMappings?.totalMappings || 0}</div>
              <p className="text-xs text-muted-foreground">
                {importStatus.locationMappings?.manualMapped || 0} manual
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="rent-roll" className="space-y-4">
        <TabsList>
          <TabsTrigger value="rent-roll">Rent Roll</TabsTrigger>
          <TabsTrigger value="enquire">Enquire Data</TabsTrigger>
          <TabsTrigger value="competitive">Competitive Survey</TabsTrigger>
          <TabsTrigger value="history">Historical Data</TabsTrigger>
        </TabsList>

        {/* Rent Roll Import */}
        <TabsContent value="rent-roll">
          <Card>
            <CardHeader>
              <CardTitle>Import Rent Roll CSV</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="rent-roll-month">Upload Month</Label>
                <Input
                  id="rent-roll-month"
                  type="month"
                  value={rentRollMonth}
                  onChange={(e) => setRentRollMonth(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="rent-roll-file">CSV File</Label>
                <Input
                  id="rent-roll-file"
                  type="file"
                  accept=".csv"
                  onChange={(e) => setRentRollFile(e.target.files?.[0] || null)}
                />
              </div>

              <Button 
                onClick={() => rentRollImport.mutate()}
                disabled={!rentRollFile || rentRollImport.isPending}
              >
                <Upload className="mr-2 h-4 w-4" />
                Import Rent Roll
              </Button>

              {rentRollImport.isPending && (
                <Alert>
                  <AlertDescription>Importing rent roll data...</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Enquire Data Import */}
        <TabsContent value="enquire">
          <Card>
            <CardHeader>
              <CardTitle>Import Enquire CSV</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="enquire-source">Data Source</Label>
                <Select value={enquireSource} onValueChange={(v) => setEnquireSource(v as any)}>
                  <SelectTrigger id="enquire-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Senior Housing">Senior Housing</SelectItem>
                    <SelectItem value="Post Acute">Post Acute</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="enquire-file">CSV File</Label>
                <Input
                  id="enquire-file"
                  type="file"
                  accept=".csv"
                  onChange={(e) => setEnquireFile(e.target.files?.[0] || null)}
                />
              </div>

              <Button 
                onClick={() => enquireImport.mutate()}
                disabled={!enquireFile || enquireImport.isPending}
              >
                <Upload className="mr-2 h-4 w-4" />
                Import Enquire Data
              </Button>

              {enquireImport.isPending && (
                <Alert>
                  <AlertDescription>Importing Enquire data...</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Competitive Survey Import */}
        <TabsContent value="competitive">
          <Card>
            <CardHeader>
              <CardTitle>Import Competitive Survey Excel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="competitive-month">Survey Month</Label>
                <Input
                  id="competitive-month"
                  type="month"
                  value={competitiveMonth}
                  onChange={(e) => setCompetitiveMonth(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="competitive-file">Excel File</Label>
                <Input
                  id="competitive-file"
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setCompetitiveFile(e.target.files?.[0] || null)}
                />
              </div>

              <Button 
                onClick={() => competitiveImport.mutate()}
                disabled={!competitiveFile || competitiveImport.isPending}
              >
                <Upload className="mr-2 h-4 w-4" />
                Import Competitive Survey
              </Button>

              {competitiveImport.isPending && (
                <Alert>
                  <AlertDescription>Importing competitive survey data...</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Historical Data Management */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Historical Rent Roll Data</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Available Months</Label>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  {importStatus?.rentRollHistory?.months?.map((month: string) => (
                    <Button
                      key={month}
                      variant="outline"
                      size="sm"
                      onClick={() => syncToCurrent.mutate(month)}
                      disabled={syncToCurrent.isPending}
                    >
                      <Database className="mr-1 h-3 w-3" />
                      {month}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Click a month to sync it as the current active data
                </p>
              </div>

              {importStatus?.rentRollHistory?.months?.length === 0 && (
                <Alert>
                  <AlertDescription>
                    No historical rent roll data imported yet. Import CSV files above to build history.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Unmapped Locations Alert */}
      {importStatus?.enquireData?.unmappedRecords > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Unmapped Locations</AlertTitle>
          <AlertDescription>
            {importStatus.enquireData.unmappedRecords} Enquire records have unmapped locations. 
            Use the Auto-Map button or manually map locations to ensure accurate reporting.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}