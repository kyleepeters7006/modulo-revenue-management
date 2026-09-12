import { useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, ExternalLink, Maximize2, RefreshCw, Upload } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type Metric = {
  id: string;
  category: "senior-housing" | "costs" | "economic";
  label: string;
  value: number | string | null;
  unit: "percent" | "range" | "index";
  comparison: string;
  asOf: string;
  sourceName: string;
  sourceUrl: string;
  method: "live" | "reviewed";
  status: "current" | "stale" | "unavailable";
  note: string;
  updatedAt?: string;
  revisionCount?: number;
  previousValue?: number | null;
};

type IndustryContextRefresh = {
  provider: string;
  schedule: string;
  refreshIntervalHours: number;
  staleAfterHours: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  revisionCount: number;
};

type IndustryContextResponse = {
  metrics: Metric[];
  fetchedAt: string;
  liveSourceStatus: "current" | "partial";
  liveRefresh: IndustryContextRefresh;
};

const categoryCopy = {
  "senior-housing": {
    title: "Senior housing market",
    description: "Occupancy and rent-growth context",
  },
  costs: {
    title: "Cost pressure",
    description: "Inflation, labor, and construction inputs",
  },
  economic: {
    title: "Economic context",
    description: "Affordability and forward-looking signals",
  },
};

function formatValue(metric: Metric) {
  if (metric.value === null) return "Unavailable";
  if (metric.unit === "percent" && typeof metric.value === "number") return `${metric.value.toFixed(1)}%`;
  return String(metric.value);
}

function statusLabel(metric: Metric) {
  if (metric.status === "stale") return "Stale · last known";
  if (metric.status === "unavailable") return "Unavailable";
  if (metric.method === "reviewed") return "Reviewed snapshot";
  return "Live series";
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

/**
 * The label doubles as the methodology tooltip trigger. It truncates to keep
 * the card to one header line, so the full string is also exposed as a native
 * title — the tooltip carries the note, not the label, and a sighted user
 * otherwise has no way to read a clipped label.
 */
function MetricLabel({ metric }: { metric: Metric }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            title={metric.label}
            className="cursor-help truncate border-b border-dotted border-current text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--dashboard-muted-strong)]"
          >
            {metric.label}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] text-xs leading-relaxed">
          {metric.note || "No methodology note provided."}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function StatusPill({ metric }: { metric: Metric }) {
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${
        metric.status === "stale"
          ? "bg-amber-100 text-amber-800"
          : metric.status === "unavailable"
            ? "bg-slate-100 text-slate-700"
            : "bg-[var(--trilogy-teal)]/10 text-[var(--trilogy-teal-dark)]"
      }`}
    >
      {statusLabel(metric)}
    </span>
  );
}

/**
 * As-of date, source link, revision count and the admin edit affordance, on
 * one wrapping line.
 *
 * Shared so every benchmark in the section carries it, the peer graphic
 * included. A card that shows a number with no freshness state is worse than
 * no card at all here — these figures frame pricing decisions, and a stale
 * feed that still looks current is exactly the failure mode to avoid.
 */
function MetricMeta({ metric, canEdit, onEdit }: { metric: Metric; canEdit: boolean; onEdit: (metric: Metric) => void }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-tight text-[var(--dashboard-muted-strong)]">
      <span className="whitespace-nowrap">As of {metric.asOf}</span>
      <span aria-hidden>·</span>
      <a
        href={metric.sourceUrl}
        target="_blank"
        rel="noreferrer"
        title={metric.sourceName}
        className="inline-flex min-w-0 items-center gap-1 text-[var(--trilogy-teal-dark)] hover:underline"
      >
        <span className="truncate">{metric.sourceName}</span>
        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
      </a>
      {metric.revisionCount ? (
        <span
          className="whitespace-nowrap rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-800"
          title={metric.previousValue == null ? undefined : `Previous value: ${metric.previousValue.toFixed(1)}%`}
        >
          Revised {metric.revisionCount}×
        </span>
      ) : null}
      {canEdit && (metric.status === "stale" || metric.status === "unavailable") ? (
        <button
          type="button"
          onClick={() => onEdit(metric)}
          className="whitespace-nowrap font-semibold text-[var(--trilogy-teal-dark)] hover:underline"
        >
          Edit
        </button>
      ) : null}
    </div>
  );
}

/**
 * Three dense lines: label + status, value + comparison, then provenance.
 *
 * Everything the taller card carried is still here. Condensing means
 * collapsing the stacking, not dropping fields.
 */
function ContextCard({ metric, canEdit, onEdit }: { metric: Metric; canEdit: boolean; onEdit: (metric: Metric) => void }) {
  return (
    <div
      className="rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-bg)] px-2.5 py-2"
      data-testid={`industry-metric-${metric.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <MetricLabel metric={metric} />
        <StatusPill metric={metric} />
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <p className="shrink-0 text-lg font-light leading-tight text-[var(--dashboard-text)]">{formatValue(metric)}</p>
        <p className="text-[11px] font-medium leading-snug text-[var(--dashboard-text)]">{metric.comparison}</p>
      </div>
      <MetricMeta metric={metric} canEdit={canEdit} onEdit={onEdit} />
    </div>
  );
}

export default function IndustryContext() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<Metric | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [graphicVersion, setGraphicVersion] = useState(() => Date.now());
  const fileRef = useRef<HTMLInputElement>(null);
  const query = useQuery<IndustryContextResponse>({
    queryKey: ["/api/industry-context"],
    queryFn: async () => {
      const response = await fetch("/api/industry-context", { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load industry context");
      return response.json();
    },
    staleTime: 30 * 60 * 1000,
  });

  const saveMetric = useMutation({
    mutationFn: async (payload: { id: string; value: number | string; asOf: string; comparison: string; sourceName: string; sourceUrl: string; note: string }) => {
      const response = await fetch(`/api/industry-context/metrics/${payload.id}`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: payload.value, asOf: payload.asOf, comparison: payload.comparison, sourceName: payload.sourceName, sourceUrl: payload.sourceUrl, note: payload.note }),
      });
      if (!response.ok) throw new Error("Unable to save metric");
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/industry-context"] });
      setFeedback("Metric updated.");
      setEditing(null);
    },
    onError: () => setFeedback("Metric could not be saved. Try again."),
  });

  async function uploadGraphic(file: File) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024) {
      setFeedback("Choose a PNG, JPEG, or WebP image no larger than 3MB.");
      return;
    }
    setUploading(true); setFeedback(null);
    const formData = new FormData(); formData.append("image", file);
    try {
      const response = await fetch("/api/industry-context/peer-graphic", { method: "PUT", credentials: "include", body: formData });
      if (!response.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: ["/api/industry-context/peer-graphic"] });
      setGraphicVersion(Date.now());
      setFeedback("Peer comparison graphic updated.");
    } catch { setFeedback("Graphic upload failed. Try again."); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  if (query.isLoading) {
    return (
      <Card className="dashboard-card" data-testid="industry-context-loading">
        <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-28 animate-pulse rounded-xl bg-[var(--dashboard-border)]/60" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="dashboard-card" data-testid="industry-context-error">
        <CardContent className="flex items-center justify-between gap-4 p-5">
          <div>
            <p className="font-semibold text-[var(--dashboard-text)]">Industry Context unavailable</p>
            <p className="mt-1 text-sm text-[var(--dashboard-muted)]">
              The dashboard could not load the external benchmark feed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--dashboard-border)] px-3 py-2 text-sm"
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </CardContent>
      </Card>
    );
  }

  const groups = (Object.keys(categoryCopy) as Array<keyof typeof categoryCopy>).map((category) => ({
    category,
    ...categoryCopy[category],
    metrics: query.data.metrics.filter((metric) => metric.category === category),
  }));
  // Older cached responses predate refresh metadata. Expanding the section
  // must still work while React Query replaces that cache entry.
  const liveRefresh = query.data.liveRefresh ?? {
    provider: "U.S. Bureau of Labor Statistics",
    schedule: "Scheduled refresh",
    refreshIntervalHours: 6,
    staleAfterHours: 48,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
    revisionCount: 0,
  };

  return (
    <Card className="dashboard-card" data-testid="industry-context">
      <CardHeader className="gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
           <button
             type="button"
             onClick={() => setExpanded((value) => !value)}
             aria-expanded={expanded}
             aria-controls="industry-context-trends"
              className="group flex items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--trilogy-teal)]"
           >
             <CardTitle className="flex items-center gap-2 text-lg font-semibold text-[var(--dashboard-text)]">
               Industry Context <img src="/industry-context-icon.png" alt="" className="h-8 w-8 object-contain" />
             </CardTitle>
             <ChevronDown className={`h-4 w-4 text-[var(--dashboard-muted)] transition-transform group-hover:text-[var(--dashboard-text)] ${expanded ? "rotate-180" : ""}`} />
           </button>
           <p className="max-w-2xl text-xs text-[var(--dashboard-muted)]">
              Market benchmarks calibrate rate targets.
            </p>
           {feedback && !editing ? <p className={`mt-1 text-xs ${feedback.includes("failed") || feedback.includes("Choose") ? "text-red-700" : "text-[var(--trilogy-teal)]"}`} role="status">{feedback}</p> : null}
        </div>
          <div className="flex items-center gap-2">
         <Link href="/inhouse-increases">
          <span className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-[var(--trilogy-teal)] px-3 py-2 text-sm font-medium text-white hover:opacity-90">
            Set our targets <ArrowRight className="h-4 w-4" />
          </span>
         </Link>
         </div>
      </CardHeader>
       {expanded ? <CardContent id="industry-context-trends" className="space-y-3 pt-0">
        {groups.map((group) => (
           <section key={group.category} aria-labelledby={`industry-${group.category}`} className="mx-auto w-full max-w-6xl">
            {/* Title and description share a line; the description is a gloss,
                not a heading, so it does not need its own row. */}
            <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
              <h3 id={`industry-${group.category}`} className="text-xs font-semibold text-[var(--dashboard-text)]">
                {group.title}
              </h3>
              <p className="text-[11px] text-[var(--dashboard-muted)]">{group.description}</p>
            </div>
             <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
               {group.metrics.map((metric) => (
                 metric.label.toLowerCase().includes("peer") && metric.label.toLowerCase().includes("same-store") ? (
                   <PeerGraphic key={metric.id} metric={metric} isAdmin={isAdmin} onEdit={setEditing} uploading={uploading} fileRef={fileRef} onFile={uploadGraphic} version={graphicVersion} />
                 ) : <ContextCard key={metric.id} metric={metric} canEdit={isAdmin} onEdit={setEditing} />
              ))}
            </div>
          </section>
        ))}
        {/* Refresh health is freshness information, not fine print — it says
            how far the whole section can be trusted, so it uses the readable
            muted token rather than the body-text one. */}
        <div className="mx-auto w-full max-w-6xl border-t border-[var(--dashboard-border)] pt-2 text-[11px] leading-snug text-[var(--dashboard-muted-strong)]">
          <p>
            Last successful source refresh{" "}
             {formatTimestamp(liveRefresh.lastSuccessAt)} ·{" "}
             {liveRefresh.schedule} · {liveRefresh.provider} · Stale after{" "}
             {liveRefresh.staleAfterHours} hours · Reviewed snapshots are dated to their source publication.
             {liveRefresh.revisionCount > 0
               ? ` ${liveRefresh.revisionCount} revision${liveRefresh.revisionCount === 1 ? "" : "s"} recorded.`
              : ""}
          </p>
           {query.data.liveSourceStatus === "partial" || liveRefresh.lastError ? (
            <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-amber-800">
              BLS refresh issue:{" "}
               {liveRefresh.lastError ?? "one or more live series are stale or unavailable."}
               {liveRefresh.lastAttemptAt
                 ? ` Last attempted ${formatTimestamp(liveRefresh.lastAttemptAt)}.`
                : ""}
            </p>
          ) : null}
        </div>
       </CardContent> : null}
       <Dialog open={!!editing} onOpenChange={(open) => { if (!open) setEditing(null); }}>
         <DialogContent className="max-w-lg">
           <DialogHeader>
             <DialogTitle>Edit metric</DialogTitle>
             <DialogDescription>Update the reviewed value and its source. Changes are recorded in Industry Context.</DialogDescription>
           </DialogHeader>
           {editing ? (
             <form className="grid gap-3" onSubmit={(event) => {
               event.preventDefault();
                const rawValue = String(editing.value ?? "").trim();
                saveMetric.mutate({
                  id: editing.id,
                  value: editing.unit === "percent" && rawValue !== "" && Number.isFinite(Number(rawValue))
                    ? Number(rawValue)
                    : rawValue,
                  asOf: editing.asOf,
                  comparison: editing.comparison,
                  sourceName: editing.sourceName,
                  sourceUrl: editing.sourceUrl,
                  note: editing.note,
                });
             }}>
               <p className="text-sm font-semibold text-[var(--dashboard-text)]">{editing.label}</p>
               <div className="grid grid-cols-2 gap-3">
                 {(["value", "asOf"] as const).map((field) => (
                   <label key={field} className="grid gap-1 text-xs font-medium text-[var(--dashboard-muted)]">{field === "value" ? "Value" : "As of"}
                     <input value={String(editing[field] ?? "")} onChange={(event) => setEditing({ ...editing, [field]: field === "value" ? event.target.value : event.target.value })} className="h-9 rounded-md border border-[var(--dashboard-border)] bg-transparent px-2 text-sm text-[var(--dashboard-text)]" />
                   </label>
                 ))}
               </div>
               {(["comparison", "sourceName", "sourceUrl", "note"] as const).map((field) => (
                 <label key={field} className="grid gap-1 text-xs font-medium capitalize text-[var(--dashboard-muted)]">{field === "sourceUrl" ? "Source URL" : field}
                   <input value={editing[field]} onChange={(event) => setEditing({ ...editing, [field]: event.target.value })} className="h-9 rounded-md border border-[var(--dashboard-border)] bg-transparent px-2 text-sm text-[var(--dashboard-text)]" />
                 </label>
               ))}
               <div className="mt-1 flex items-center justify-between gap-3">
                 <span className={`text-xs ${feedback?.includes("could not") ? "text-red-700" : "text-[var(--dashboard-muted)]"}`}>{feedback}</span>
                 <div className="flex gap-2">
                   <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-[var(--dashboard-border)] px-3 py-2 text-sm">Cancel</button>
                   <button type="submit" disabled={saveMetric.isPending} className="rounded-md bg-[var(--trilogy-teal)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saveMetric.isPending ? "Saving…" : "Save metric"}</button>
                 </div>
               </div>
             </form>
           ) : null}
         </DialogContent>
       </Dialog>
    </Card>
  );
}

function PeerGraphic({ metric, isAdmin, onEdit, uploading, fileRef, onFile, version }: { metric: Metric; isAdmin: boolean; onEdit: (metric: Metric) => void; uploading: boolean; fileRef: MutableRefObject<HTMLInputElement | null>; onFile: (file: File) => void; version: number }) {
  const [expanded, setExpanded] = useState(false);
  const imageUrl = `/api/industry-context/peer-graphic?v=${version}`;
  const handleImageError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    event.currentTarget.src = "/industry-peer-comparison.png";
  };

  return (
    <>
      {/* Full width in both grid shapes. The inline image is a preview kept
          small on purpose — Expand is the way to actually read it.

          This is a benchmark like any other, so it carries the same status
          pill and provenance row. Rendering it as a bare picture let a stale
          or unavailable peer snapshot look perfectly current. */}
      <div
        className="rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-bg)] px-2.5 py-2 sm:col-span-2 xl:col-span-3"
        data-testid={`industry-metric-${metric.id}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <MetricLabel metric={metric} />
            <p className="text-[11px] text-[var(--dashboard-muted-strong)]">Quarterly comparison across senior housing operators</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <StatusPill metric={metric} />
            <button type="button" onClick={() => setExpanded(true)} className="inline-flex items-center gap-1 rounded-md border border-[var(--dashboard-border)] px-2 py-1 text-[11px] font-medium hover:bg-white"><Maximize2 className="h-3 w-3" /> Expand</button>
            {isAdmin ? <><input ref={(node) => { fileRef.current = node; }} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); }} /><button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 rounded-md border border-[var(--dashboard-border)] px-2 py-1 text-[11px] font-medium hover:bg-white disabled:opacity-50"><Upload className="h-3 w-3" /> {uploading ? "Uploading…" : "Replace"}</button></> : null}
          </div>
        </div>
        <img key={version} src={imageUrl} alt="Peer same-store revenue growth comparison" className="mt-1.5 max-h-[180px] w-full cursor-zoom-in object-contain object-left" onClick={() => setExpanded(true)} onError={handleImageError} />
        <MetricMeta metric={metric} canEdit={isAdmin} onEdit={onEdit} />
      </div>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col">
          <DialogHeader>
            <DialogTitle>Peer same-store revenue growth</DialogTitle>
            <DialogDescription>Quarterly comparison across senior housing operators</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-white p-4">
            <img key={`expanded-${version}`} src={imageUrl} alt="Expanded peer same-store revenue growth comparison" className="h-full min-h-[520px] w-full object-contain object-center" onError={handleImageError} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}