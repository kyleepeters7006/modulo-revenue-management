import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import Navigation from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload, Download, FileSpreadsheet, FileText, CheckCircle2, XCircle, AlertTriangle, Clock, Play, Trash2, Pencil, Server, Bell } from "lucide-react";
import { toast } from "@/hooks/use-toast";

// ── Types (mirror server registry / API) ────────────────────────────

interface RegistryField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  format?: string;
  allowedValues?: string[];
  description: string;
  sample: string;
  aliases?: string[];
}

interface DatasetDefinition {
  id: string;
  name: string;
  description: string;
  targetTable: string;
  periodField: string | null;
  replacesPeriod: boolean;
  fields: RegistryField[];
}

interface ValidationResponse {
  datasetType: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  columnIssues: { column: string; issue: string; message: string }[];
  rowErrors: { row: number; field: string; value: string; message: string }[];
  warnings: string[];
  detectedPeriod: string | null;
  periodSource: string | null;
  periods: string[];
  canImport: boolean;
  previewRows: Record<string, any>[];
}

interface ImportRun {
  id: string;
  datasetType: string;
  source: string;
  fileName: string;
  period: string | null;
  mode: string | null;
  status: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  insertedRows: number;
  deletedRows: number;
  errorMessage: string | null;
  startedAt: string;
}

interface Schedule {
  id: string;
  name: string;
  datasetType: string;
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  remotePath: string;
  filePattern: string;
  scheduleTime: string;
  frequency: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  deleteAfterImport: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunMessage: string | null;
  hasPassword?: boolean;
}

interface Notification {
  id: string;
  severity: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
    imported: { variant: "default", icon: CheckCircle2 },
    success: { variant: "default", icon: CheckCircle2 },
    partial: { variant: "secondary", icon: AlertTriangle },
    failed: { variant: "destructive", icon: XCircle },
    skipped_duplicate: { variant: "outline", icon: Clock },
    no_files: { variant: "outline", icon: Clock },
    pending: { variant: "outline", icon: Clock },
  };
  const cfg = map[status] || { variant: "outline" as const, icon: Clock };
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.variant} className="gap-1">
      <Icon className="h-3 w-3" />
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

const emptySchedule = {
  name: "",
  datasetType: "rent_roll",
  host: "",
  port: 22,
  username: "",
  password: "",
  remotePath: "/",
  filePattern: "*.csv",
  scheduleTime: "06:00",
  frequency: "daily",
  runDate: "",
  dayOfWeek: 1,
  dayOfMonth: 1,
  deleteAfterImport: false,
  enabled: true,
};

// ── Page ────────────────────────────────────────────────────────────

export default function DataImports() {
  const { data: registry = [] } = useQuery<DatasetDefinition[]>({ queryKey: ["/api/data-imports/registry"] });

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Data Imports</h1>
          <p className="text-muted-foreground">Templates, manual uploads, scheduled SFTP pickups, and import history</p>
        </div>
        <Tabs defaultValue="import">
          <TabsList>
            <TabsTrigger value="import" data-testid="tab-import"><Upload className="h-4 w-4 mr-1" />Import</TabsTrigger>
            <TabsTrigger value="templates" data-testid="tab-templates"><Download className="h-4 w-4 mr-1" />Templates & Fields</TabsTrigger>
            <TabsTrigger value="schedules" data-testid="tab-schedules"><Server className="h-4 w-4 mr-1" />Scheduled (SFTP)</TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history"><Clock className="h-4 w-4 mr-1" />History</TabsTrigger>
          </TabsList>
          <TabsContent value="import"><ImportTab registry={registry} /></TabsContent>
          <TabsContent value="templates"><TemplatesTab registry={registry} /></TabsContent>
          <TabsContent value="schedules"><SchedulesTab registry={registry} /></TabsContent>
          <TabsContent value="history"><HistoryTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ── Import tab ──────────────────────────────────────────────────────

function ImportTab({ registry }: { registry: DatasetDefinition[] }) {
  const [datasetId, setDatasetId] = useState<string>("rent_roll");
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [periodOverride, setPeriodOverride] = useState<string>("");

  const dataset = registry.find((d) => d.id === datasetId);

  const validateMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("datasetType", datasetId);
      const res = await fetch("/api/data-imports/validate", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).error || "Validation failed");
      return res.json() as Promise<ValidationResponse>;
    },
    onSuccess: (data) => {
      setValidation(data);
      setPeriodOverride(data.detectedPeriod || "");
    },
    onError: (err: Error) => toast({ title: "Validation failed", description: err.message, variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("datasetType", datasetId);
      if (periodOverride) fd.append("period", periodOverride);
      const res = await fetch("/api/data-imports/import", { method: "POST", body: fd, credentials: "include" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Import failed");
      return body as ImportRun;
    },
    onSuccess: (run) => {
      toast({
        title: run.status === "partial" ? "Import completed with errors" : "Import successful",
        description: `${run.insertedRows} rows imported for ${run.period}${run.deletedRows ? ` (replaced ${run.deletedRows} existing rows)` : ""}${run.errorRows ? `; ${run.errorRows} rows skipped` : ""}`,
      });
      setValidation(null);
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/data-imports/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/data-imports/notifications"] });
    },
    onError: (err: Error) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Upload a file</CardTitle>
          <CardDescription>Pick a dataset, choose your .csv or .xlsx file, then validate before importing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Dataset</Label>
              <Select value={datasetId} onValueChange={(v) => { setDatasetId(v); setValidation(null); }}>
                <SelectTrigger data-testid="select-dataset"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {registry.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>File (.csv / .xlsx)</Label>
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                data-testid="input-file"
                onChange={(e) => { setFile(e.target.files?.[0] || null); setValidation(null); }}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button
                onClick={() => validateMutation.mutate()}
                disabled={!file || validateMutation.isPending}
                data-testid="button-validate"
              >
                {validateMutation.isPending ? "Validating..." : "Validate"}
              </Button>
            </div>
          </div>
          {dataset && (
            <p className="text-sm text-muted-foreground">
              {dataset.description}
            </p>
          )}
        </CardContent>
      </Card>

      {validation && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Validation results
              {validation.canImport
                ? <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" />Ready to import</Badge>
                : <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Cannot import</Badge>}
            </CardTitle>
            <CardDescription>
              {validation.totalRows} rows · {validation.validRows} valid · {validation.errorRows} with errors
              {validation.detectedPeriod && ` · period ${validation.detectedPeriod} (from ${validation.periodSource})`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {validation.columnIssues.length > 0 && (
              <Alert variant={validation.columnIssues.some((c) => c.issue === "missing_required") ? "destructive" : "default"}>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Column issues</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 space-y-1">
                    {validation.columnIssues.map((c, i) => <li key={i}>{c.message}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {validation.warnings.map((w, i) => (
              <Alert key={i}>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{w}</AlertDescription>
              </Alert>
            ))}
            {validation.rowErrors.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Row errors {validation.rowErrors.length >= 200 && "(first 200 shown)"}</h4>
                <div className="max-h-64 overflow-y-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Field</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead>Problem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {validation.rowErrors.map((e, i) => (
                        <TableRow key={i}>
                          <TableCell>{e.row}</TableCell>
                          <TableCell>{e.field}</TableCell>
                          <TableCell className="max-w-32 truncate">{e.value}</TableCell>
                          <TableCell>{e.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            <div className="flex items-end gap-4 flex-wrap">
              {dataset?.periodField && (
                <div>
                  <Label>Reporting period (YYYY-MM)</Label>
                  <Input
                    type="month"
                    value={periodOverride}
                    onChange={(e) => setPeriodOverride(e.target.value)}
                    className="w-44"
                    data-testid="input-period"
                  />
                </div>
              )}
              <Button
                onClick={() => importMutation.mutate()}
                disabled={!validation.canImport || (!!dataset?.periodField && !periodOverride) || importMutation.isPending}
                data-testid="button-import"
              >
                {importMutation.isPending ? "Importing..." : `Import ${validation.validRows} rows`}
              </Button>
              {dataset?.replacesPeriod && (
                <p className="text-sm text-muted-foreground">
                  Importing replaces all existing {dataset.name} data for the selected period.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Templates & registry tab ────────────────────────────────────────

interface ConsolidatedField {
  key: string;
  labels: string[];
  sources: string[];
  types: string[];
  hasConflict: boolean;
  conflictReason?: string;
}

function TemplatesTab({ registry }: { registry: DatasetDefinition[] }) {
  const { data: consolidated } = useQuery<{ fields: ConsolidatedField[]; labelConflicts: string[] }>({
    queryKey: ["/api/data-imports/registry/consolidated"],
  });
  const sharedFields = consolidated?.fields.filter((f) => f.sources.length > 1) || [];
  const conflicts = consolidated?.fields.filter((f) => f.hasConflict) || [];

  return (
    <div className="space-y-4 mt-4">
      {consolidated && (
        <Card>
          <CardHeader>
            <CardTitle>Consolidated field registry</CardTitle>
            <CardDescription>
              {consolidated.fields.length} unique fields across {registry.length} dataset types — {sharedFields.length} shared (duplicates merged)
              {conflicts.length + (consolidated.labelConflicts?.length || 0) > 0
                ? `, ${conflicts.length + (consolidated.labelConflicts?.length || 0)} naming conflict(s) flagged`
                : ", no naming conflicts"}
            </CardDescription>
          </CardHeader>
          {(conflicts.length > 0 || (consolidated.labelConflicts?.length || 0) > 0 || sharedFields.length > 0) && (
            <CardContent className="space-y-3">
              {conflicts.map((f) => (
                <div key={f.key} className="text-sm border border-amber-500/40 bg-amber-500/10 rounded-md p-2" data-testid={`conflict-${f.key}`}>
                  <Badge variant="destructive" className="mr-2">conflict</Badge>
                  <span className="font-medium">{f.key}</span>: {f.conflictReason} (used in {f.sources.join(", ")})
                </div>
              ))}
              {consolidated.labelConflicts?.map((msg, i) => (
                <div key={i} className="text-sm border border-amber-500/40 bg-amber-500/10 rounded-md p-2" data-testid={`label-conflict-${i}`}>
                  <Badge variant="destructive" className="mr-2">conflict</Badge>{msg}
                </div>
              ))}
              {sharedFields.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {sharedFields.map((f) => (
                    <Badge key={f.key} variant="secondary" title={`Used in: ${f.sources.join(", ")}`}>
                      {f.labels[0]} × {f.sources.length}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}
      {registry.map((d) => (
        <Card key={d.id}>
          <CardHeader>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardTitle>{d.name}</CardTitle>
                <CardDescription>{d.description}</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild data-testid={`button-template-xlsx-${d.id}`}>
                  <a href={`/api/data-imports/template/${d.id}?format=xlsx`}>
                    <FileSpreadsheet className="h-4 w-4 mr-1" />Excel template
                  </a>
                </Button>
                <Button variant="outline" size="sm" asChild data-testid={`button-template-csv-${d.id}`}>
                  <a href={`/api/data-imports/template/${d.id}?format=csv`}>
                    <FileText className="h-4 w-4 mr-1" />CSV template
                  </a>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-y-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Column</TableHead>
                    <TableHead>Required</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Format / Allowed values</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.fields.map((f) => (
                    <TableRow key={f.key}>
                      <TableCell className="font-medium whitespace-nowrap">{f.label}</TableCell>
                      <TableCell>{f.required ? <Badge>required</Badge> : <span className="text-muted-foreground">optional</span>}</TableCell>
                      <TableCell>{f.type}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{f.allowedValues?.join(", ") || f.format || "—"}</TableCell>
                      <TableCell className="text-sm">{f.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Schedules tab ───────────────────────────────────────────────────

function SchedulesTab({ registry }: { registry: DatasetDefinition[] }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [form, setForm] = useState<any>(emptySchedule);

  const { data: schedules = [], isLoading } = useQuery<Schedule[]>({ queryKey: ["/api/data-imports/schedules"] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { ...form, port: Number(form.port) || 22 };
      if (!payload.password) delete payload.password;
      if (!payload.runDate) payload.runDate = null;
      if (editing) {
        return apiRequest(`/api/data-imports/schedules/${editing.id}`, "PATCH", payload);
      }
      return apiRequest("/api/data-imports/schedules", "POST", payload);
    },
    onSuccess: () => {
      toast({ title: editing ? "Schedule updated" : "Schedule created" });
      queryClient.invalidateQueries({ queryKey: ["/api/data-imports/schedules"] });
      setDialogOpen(false);
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/data-imports/schedules/${id}`, "DELETE"),
    onSuccess: () => {
      toast({ title: "Schedule deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/data-imports/schedules"] });
    },
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/data-imports/schedules/${id}/run`, "POST"),
    onSuccess: async (res: Response) => {
      const body = await res.json();
      toast({
        title: `Run ${body.status}`,
        description: body.message?.substring(0, 300) || "",
        variant: body.status === "failed" ? "destructive" : "default",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/data-imports/schedules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/data-imports/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/data-imports/notifications"] });
    },
    onError: (err: Error) => toast({ title: "Run failed", description: err.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiRequest(`/api/data-imports/schedules/${id}`, "PATCH", { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/data-imports/schedules"] }),
  });

  const openCreate = () => { setEditing(null); setForm(emptySchedule); setDialogOpen(true); };
  const openEdit = (s: Schedule) => {
    setEditing(s);
    setForm({
      name: s.name, datasetType: s.datasetType, host: s.host, port: s.port, username: s.username,
      password: "", remotePath: s.remotePath, filePattern: s.filePattern, scheduleTime: s.scheduleTime,
      frequency: s.frequency, runDate: (s as any).runDate ?? "", dayOfWeek: s.dayOfWeek ?? 1, dayOfMonth: s.dayOfMonth ?? 1,
      deleteAfterImport: s.deleteAfterImport, enabled: s.enabled,
    });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Files are picked up automatically from your SFTP server at the scheduled time. Duplicate files (same content) are skipped.
        </p>
        <Button onClick={openCreate} data-testid="button-add-schedule"><Server className="h-4 w-4 mr-1" />Add schedule</Button>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : schedules.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No scheduled imports yet.</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {schedules.map((s) => (
            <Card key={s.id} data-testid={`card-schedule-${s.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  <Switch checked={s.enabled} onCheckedChange={(v) => toggleMutation.mutate({ id: s.id, enabled: v })} data-testid={`switch-enabled-${s.id}`} />
                </div>
                <CardDescription>
                  {registry.find((d) => d.id === s.datasetType)?.name || s.datasetType} · {s.frequency} at {s.scheduleTime}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-muted-foreground">{s.username}@{s.host}:{s.port}{s.remotePath} · {s.filePattern}</p>
                {s.lastRunAt && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {statusBadge(s.lastRunStatus || "pending")}
                    <span className="text-muted-foreground text-xs">
                      {new Date(s.lastRunAt).toLocaleString()} {s.lastRunMessage && `— ${s.lastRunMessage.substring(0, 120)}`}
                    </span>
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => runMutation.mutate(s.id)} disabled={runMutation.isPending} data-testid={`button-run-${s.id}`}>
                    <Play className="h-3 w-3 mr-1" />{runMutation.isPending ? "Running…" : "Run now"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(s)} data-testid={`button-edit-${s.id}`}><Pencil className="h-3 w-3 mr-1" />Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => deleteMutation.mutate(s.id)} data-testid={`button-delete-${s.id}`}><Trash2 className="h-3 w-3 mr-1" />Delete</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit schedule" : "New scheduled import"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nightly rent roll pickup" data-testid="input-schedule-name" />
            </div>
            <div>
              <Label>Dataset</Label>
              <Select value={form.datasetType} onValueChange={(v) => setForm({ ...form, datasetType: v })}>
                <SelectTrigger data-testid="select-schedule-dataset"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {registry.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label>SFTP Host</Label>
                <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="sftp.example.com" data-testid="input-schedule-host" />
              </div>
              <div>
                <Label>Port</Label>
                <Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} data-testid="input-schedule-port" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Username</Label>
                <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} data-testid="input-schedule-username" />
              </div>
              <div>
                <Label>Password {editing && <span className="text-muted-foreground text-xs">(leave blank to keep)</span>}</Label>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="input-schedule-password" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Remote folder</Label>
                <Input value={form.remotePath} onChange={(e) => setForm({ ...form, remotePath: e.target.value })} placeholder="/exports" data-testid="input-schedule-path" />
              </div>
              <div>
                <Label>File pattern</Label>
                <Input value={form.filePattern} onChange={(e) => setForm({ ...form, filePattern: e.target.value })} placeholder="rentroll_*.csv" data-testid="input-schedule-pattern" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Frequency</Label>
                <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                  <SelectTrigger data-testid="select-schedule-frequency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_time">One-time</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Time (24h)</Label>
                <Input type="time" value={form.scheduleTime} onChange={(e) => setForm({ ...form, scheduleTime: e.target.value })} data-testid="input-schedule-time" />
              </div>
              {form.frequency === "one_time" && (
                <div>
                  <Label>Run date</Label>
                  <Input type="date" value={form.runDate} onChange={(e) => setForm({ ...form, runDate: e.target.value })} data-testid="input-run-date" />
                </div>
              )}
              {form.frequency === "weekly" && (
                <div>
                  <Label>Day of week</Label>
                  <Select value={String(form.dayOfWeek)} onValueChange={(v) => setForm({ ...form, dayOfWeek: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
                        <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {form.frequency === "monthly" && (
                <div>
                  <Label>Day of month</Label>
                  <Input type="number" min={1} max={28} value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: Number(e.target.value) })} />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.deleteAfterImport} onCheckedChange={(v) => setForm({ ...form, deleteAfterImport: v })} data-testid="switch-delete-after" />
              <Label>Delete file from server after successful import</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.name || !form.host || !form.username || (!editing && !form.password)}
              data-testid="button-save-schedule"
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── History tab ─────────────────────────────────────────────────────

function HistoryTab() {
  const { data: runs = [], isLoading } = useQuery<ImportRun[]>({ queryKey: ["/api/data-imports/runs"] });
  const { data: notifications = [] } = useQuery<Notification[]>({ queryKey: ["/api/data-imports/notifications"] });

  const markRead = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/data-imports/notifications/${id}/read`, "POST"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/data-imports/notifications"] }),
  });

  const unread = notifications.filter((n) => !n.read);

  return (
    <div className="space-y-4 mt-4">
      {unread.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Bell className="h-4 w-4" />Notifications ({unread.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {unread.slice(0, 10).map((n) => (
              <Alert key={n.id} variant={n.severity === "error" ? "destructive" : "default"}>
                <AlertTitle className="flex items-center justify-between">
                  {n.title}
                  <Button size="sm" variant="ghost" onClick={() => markRead.mutate(n.id)} data-testid={`button-dismiss-${n.id}`}>Dismiss</Button>
                </AlertTitle>
                <AlertDescription>{n.message}</AlertDescription>
              </Alert>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Import history</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : runs.length === 0 ? (
            <p className="text-muted-foreground">No imports yet.</p>
          ) : (
            <div className="max-h-[32rem] overflow-y-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Dataset</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow key={r.id} data-testid={`row-run-${r.id}`}>
                      <TableCell className="whitespace-nowrap text-sm">{new Date(r.startedAt).toLocaleString()}</TableCell>
                      <TableCell>{r.datasetType}</TableCell>
                      <TableCell className="max-w-48 truncate" title={r.fileName}>{r.fileName}</TableCell>
                      <TableCell>{r.source}</TableCell>
                      <TableCell>{r.period || "—"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {r.insertedRows ?? 0} in{r.deletedRows ? ` / ${r.deletedRows} replaced` : ""}{r.errorRows ? ` / ${r.errorRows} err` : ""}
                      </TableCell>
                      <TableCell>
                        {statusBadge(r.status)}
                        {r.errorMessage && <p className="text-xs text-destructive mt-1 max-w-56 truncate" title={r.errorMessage}>{r.errorMessage}</p>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
