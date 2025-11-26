import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, ChevronDown, Check, AlertCircle, Settings2, Save, X, Eye, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface MappingProfile {
  id: string;
  name: string;
  description?: string;
  isBuiltIn: boolean;
  isDefault: boolean;
  columnMappings: Record<string, string>;
}

interface DetectedMapping {
  sourceColumn: string;
  targetField: string | null;
  confidence: number;
  matchType: 'exact' | 'alias' | 'fuzzy' | 'none';
  isRequired: boolean;
}

interface MappingPreview {
  detectedMappings: DetectedMapping[];
  unmappedSourceColumns: string[];
  unmappedRequiredFields: string[];
  suggestedProfile: string | null;
  confidenceScore: number;
}

interface PreviewResponse {
  preview: MappingPreview;
  sourceColumns: string[];
  sampleRows: Record<string, any>[];
  totalRows: number;
}

const TARGET_FIELDS = [
  { field: 'uploadMonth', label: 'Upload Month', required: true },
  { field: 'date', label: 'Date', required: true },
  { field: 'location', label: 'Location', required: true },
  { field: 'roomNumber', label: 'Room Number', required: true },
  { field: 'roomType', label: 'Room Type', required: true },
  { field: 'serviceLine', label: 'Service Line', required: true },
  { field: 'occupiedYN', label: 'Occupied Y/N', required: true },
  { field: 'size', label: 'Size', required: true },
  { field: 'streetRate', label: 'Street Rate', required: true },
  { field: 'inHouseRate', label: 'In-House Rate', required: true },
  { field: 'daysVacant', label: 'Days Vacant', required: false },
  { field: 'preferredLocation', label: 'Preferred Location', required: false },
  { field: 'view', label: 'View', required: false },
  { field: 'renovated', label: 'Renovated', required: false },
  { field: 'careLevel', label: 'Care Level', required: false },
  { field: 'careRate', label: 'Care Rate', required: false },
  { field: 'competitorRate', label: 'Competitor Rate', required: false },
  { field: 'residentId', label: 'Resident ID', required: false },
  { field: 'residentName', label: 'Resident Name', required: false },
  { field: 'moveInDate', label: 'Move-In Date', required: false },
  { field: 'payorType', label: 'Payor Type', required: false },
];

export default function DataUpload() {
  const [dragActive, setDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("Ready to upload...");
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [showSaveProfileDialog, setShowSaveProfileDialog] = useState(false);
  const [customMappings, setCustomMappings] = useState<DetectedMapping[]>([]);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDescription, setNewProfileDescription] = useState("");
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: profilesData } = useQuery<{ profiles: MappingProfile[] }>({
    queryKey: ['/api/import-mappings'],
  });

  const profiles = profilesData?.profiles || [];

  useEffect(() => {
    if (profiles.length > 0 && !selectedProfile) {
      const defaultProfile = profiles.find(p => p.isDefault) || profiles[0];
      setSelectedProfile(defaultProfile.id);
    }
  }, [profiles, selectedProfile]);

  const previewMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      if (selectedProfile) {
        formData.append('profileId', selectedProfile);
      }
      const response = await fetch('/api/import-mappings/preview', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Preview failed');
      }
      return response.json() as Promise<PreviewResponse>;
    },
    onSuccess: (data) => {
      setPreviewData(data);
      setCustomMappings(data.preview.detectedMappings);
      setShowPreviewDialog(true);
    },
    onError: (error) => {
      toast({
        title: "Preview Failed",
        description: error instanceof Error ? error.message : 'Failed to preview file',
        variant: "destructive",
      });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, mappings }: { file: File; mappings: DetectedMapping[] }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (selectedProfile) {
        formData.append('profileId', selectedProfile);
      }
      formData.append('customMappings', JSON.stringify(mappings));
      
      const response = await fetch('/api/upload-rent-roll-mapped', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setUploadStatus(`Uploaded ${data.rows} rows successfully${data.errorRows ? `, ${data.errorRows} errors` : ''}`);
      toast({
        title: "Upload Successful",
        description: `Processed ${data.rows} rent roll records`,
      });
      setShowPreviewDialog(false);
      setSelectedFile(null);
      setPreviewData(null);
      setCustomMappings([]);
      queryClient.invalidateQueries({ queryKey: ['/api/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/series'] });
      queryClient.invalidateQueries({ queryKey: ['/api/recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/compare'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rent-roll'] });
    },
    onError: (error) => {
      setUploadStatus(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      });
    },
  });

  const saveProfileMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; mappings: DetectedMapping[] }) => {
      const columnMappings: Record<string, string> = {};
      data.mappings.forEach(m => {
        if (m.targetField) {
          columnMappings[m.sourceColumn] = m.targetField;
        }
      });
      
      return apiRequest('POST', '/api/import-mappings', {
        name: data.name,
        description: data.description,
        columnMappings,
        fieldAliases: [],
        isDefault: false,
      });
    },
    onSuccess: () => {
      toast({
        title: "Profile Saved",
        description: `Mapping profile "${newProfileName}" has been saved`,
      });
      setShowSaveProfileDialog(false);
      setNewProfileName("");
      setNewProfileDescription("");
      queryClient.invalidateQueries({ queryKey: ['/api/import-mappings'] });
    },
    onError: (error) => {
      toast({
        title: "Save Failed",
        description: error instanceof Error ? error.message : 'Failed to save profile',
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
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv') && !file.name.toLowerCase().endsWith('.xlsx')) {
      toast({
        title: "Invalid File",
        description: "Please upload a CSV or Excel file",
        variant: "destructive",
      });
      return;
    }

    setSelectedFile(file);
    setUploadStatus("Analyzing file...");
    previewMutation.mutate(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  };

  const handleMappingChange = (sourceColumn: string, targetField: string | null) => {
    setCustomMappings(prev => 
      prev.map(m => 
        m.sourceColumn === sourceColumn 
          ? { ...m, targetField, matchType: targetField ? 'exact' : 'none', confidence: targetField ? 1.0 : 0 }
          : m
      )
    );
  };

  const handleConfirmUpload = () => {
    if (selectedFile && customMappings.length > 0) {
      uploadMutation.mutate({ file: selectedFile, mappings: customMappings });
    }
  };

  const handleSaveProfile = () => {
    if (newProfileName.trim() && customMappings.length > 0) {
      saveProfileMutation.mutate({
        name: newProfileName.trim(),
        description: newProfileDescription.trim(),
        mappings: customMappings,
      });
    }
  };

  const getConfidenceBadge = (mapping: DetectedMapping) => {
    if (!mapping.targetField) {
      return <Badge variant="outline" className="text-slate-500">Unmapped</Badge>;
    }
    if (mapping.matchType === 'exact') {
      return <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/20">Exact</Badge>;
    }
    if (mapping.matchType === 'alias') {
      return <Badge className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/20">Alias</Badge>;
    }
    if (mapping.matchType === 'fuzzy') {
      return <Badge className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20">Fuzzy ({Math.round(mapping.confidence * 100)}%)</Badge>;
    }
    return <Badge variant="outline">Manual</Badge>;
  };

  const missingRequiredFields = customMappings.length > 0
    ? TARGET_FIELDS.filter(tf => tf.required && !customMappings.some(m => m.targetField === tf.field))
    : [];

  return (
    <div className="dashboard-card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-[var(--trilogy-blue)]/10 rounded-lg flex items-center justify-center">
            <Upload className="w-5 h-5 text-[var(--trilogy-blue)]" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[var(--dashboard-text)]">Rent Roll Upload</h3>
            <p className="text-sm text-[var(--dashboard-muted)]">Upload CSV/Excel with flexible column mapping</p>
          </div>
        </div>
      </div>
      
      <div className="space-y-4">
        <div className="p-4 bg-[var(--dashboard-bg)] border border-[var(--dashboard-border)] rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <Label className="text-sm font-medium text-[var(--dashboard-text)]">Import Format</Label>
            {profiles.length > 0 && (
              <Select value={selectedProfile} onValueChange={setSelectedProfile}>
                <SelectTrigger className="w-[200px]" data-testid="select-import-format">
                  <SelectValue placeholder="Select format..." />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id} data-testid={`option-format-${profile.id}`}>
                      <div className="flex items-center gap-2">
                        {profile.name}
                        {profile.isBuiltIn && (
                          <Badge variant="outline" className="text-xs">Built-in</Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <p className="text-xs text-[var(--dashboard-muted)]">
            Choose a mapping profile or upload a file to auto-detect column mappings
          </p>
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
          <FileSpreadsheet className="w-8 h-8 text-[var(--dashboard-muted)] mx-auto mb-3" />
          <p className="text-sm font-medium text-[var(--dashboard-text)]">
            Drop your CSV or Excel file here
          </p>
          <p className="text-xs text-[var(--dashboard-muted)] mt-1">
            or click to browse • Column mapping will be auto-detected
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={handleFileInputChange}
            data-testid="input-file-upload"
          />
        </div>
        
        <Button
          onClick={() => fileInputRef.current?.click()}
          className="w-full bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white"
          disabled={previewMutation.isPending || uploadMutation.isPending}
          data-testid="button-upload"
        >
          {previewMutation.isPending ? "Analyzing..." : uploadMutation.isPending ? "Uploading..." : "Select File to Upload"}
        </Button>
        
        <div 
          className="text-sm text-[var(--dashboard-muted)]"
          data-testid="text-upload-status"
        >
          {uploadStatus}
        </div>
      </div>

      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              Column Mapping Preview
            </DialogTitle>
            <DialogDescription>
              Review and adjust column mappings before importing {previewData?.totalRows || 0} rows
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="mappings" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="mappings" data-testid="tab-mappings">Column Mappings</TabsTrigger>
              <TabsTrigger value="preview" data-testid="tab-preview">Data Preview</TabsTrigger>
            </TabsList>

            <TabsContent value="mappings" className="mt-4">
              {missingRequiredFields.length > 0 && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">Missing required fields:</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {missingRequiredFields.map(f => (
                      <Badge key={f.field} variant="destructive" className="text-xs">
                        {f.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {previewData?.preview.suggestedProfile && (
                <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                    <Check className="w-4 h-4" />
                    <span className="text-sm">
                      Auto-detected format: <strong>{previewData.preview.suggestedProfile}</strong>
                      {' '}({Math.round(previewData.preview.confidenceScore * 100)}% confidence)
                    </span>
                  </div>
                </div>
              )}

              <ScrollArea className="h-[400px] rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">Source Column</TableHead>
                      <TableHead className="w-[200px]">Maps To</TableHead>
                      <TableHead className="w-[100px]">Status</TableHead>
                      <TableHead>Sample Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customMappings.map((mapping) => (
                      <TableRow key={mapping.sourceColumn}>
                        <TableCell className="font-mono text-sm">
                          {mapping.sourceColumn}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={mapping.targetField || ""}
                            onValueChange={(value) => handleMappingChange(mapping.sourceColumn, value || null)}
                          >
                            <SelectTrigger className="w-full" data-testid={`select-mapping-${mapping.sourceColumn}`}>
                              <SelectValue placeholder="Select field..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">— Unmapped —</SelectItem>
                              {TARGET_FIELDS.map((tf) => (
                                <SelectItem key={tf.field} value={tf.field}>
                                  {tf.label} {tf.required && '*'}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {getConfidenceBadge(mapping)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {previewData?.sampleRows[0]?.[mapping.sourceColumn] || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="preview" className="mt-4">
              <ScrollArea className="h-[400px] rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {previewData?.sourceColumns.map((col) => (
                        <TableHead key={col} className="min-w-[120px]">
                          {col}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData?.sampleRows.map((row, idx) => (
                      <TableRow key={idx}>
                        {previewData?.sourceColumns.map((col) => (
                          <TableCell key={col} className="text-sm">
                            {String(row[col] ?? '')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
              <p className="text-xs text-muted-foreground mt-2">
                Showing first 5 rows of {previewData?.totalRows || 0} total
              </p>
            </TabsContent>
          </Tabs>

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <Button
              variant="outline"
              onClick={() => setShowSaveProfileDialog(true)}
              className="flex items-center gap-2"
              data-testid="button-save-profile"
            >
              <Save className="w-4 h-4" />
              Save as Profile
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowPreviewDialog(false)} data-testid="button-cancel">
                Cancel
              </Button>
              <Button
                onClick={handleConfirmUpload}
                disabled={missingRequiredFields.length > 0 || uploadMutation.isPending}
                className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white"
                data-testid="button-confirm-upload"
              >
                {uploadMutation.isPending ? "Uploading..." : "Confirm & Upload"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSaveProfileDialog} onOpenChange={setShowSaveProfileDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-5 h-5" />
              Save Mapping Profile
            </DialogTitle>
            <DialogDescription>
              Save this column mapping configuration for future imports
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="profileName">Profile Name</Label>
              <Input
                id="profileName"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="e.g., My Custom Format"
                data-testid="input-profile-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profileDescription">Description (optional)</Label>
              <Input
                id="profileDescription"
                value={newProfileDescription}
                onChange={(e) => setNewProfileDescription(e.target.value)}
                placeholder="e.g., Format used by our ERP system"
                data-testid="input-profile-description"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveProfileDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveProfile}
              disabled={!newProfileName.trim() || saveProfileMutation.isPending}
              className="bg-[var(--trilogy-teal)] hover:bg-[var(--trilogy-teal-dark)] text-white"
              data-testid="button-confirm-save-profile"
            >
              {saveProfileMutation.isPending ? "Saving..." : "Save Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
