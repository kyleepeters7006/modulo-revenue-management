import { History, Loader2 } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type OverrideHistoryEntry = {
  id: string;
  location_name?: string;
  service_line?: string;
  room_type?: string;
  event_type: "create" | "update" | "remove";
  previous_rate: number | null;
  new_rate: number | null;
  notes: string | null;
  changed_by: string | null;
  changed_by_name?: string | null;
  changed_at: string | null;
};

function formatRate(rate: number | null) {
  return rate == null ? "—" : `$${Math.round(Number(rate)).toLocaleString()}`;
}

function formatDate(value: string | null) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function HistoryEntry({ entry, showSegment }: { entry: OverrideHistoryEntry; showSegment?: boolean }) {
  return (
    <div className="rounded border border-border/70 bg-muted/20 p-2">
      {showSegment && (
        <p className="mb-0.5 truncate text-[10px] font-medium text-foreground">
          {entry.location_name ?? "Unknown location"} · {entry.service_line ?? "Unknown service line"} · {entry.room_type ?? "Unknown room type"}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium capitalize">{entry.event_type}</span>
        <span className="text-[10px] text-muted-foreground">
          {formatDate(entry.changed_at)}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {formatRate(entry.previous_rate)} → {formatRate(entry.new_rate)}
      </p>
      <p className="text-[10px] text-muted-foreground">
        By {entry.changed_by_name ?? entry.changed_by ?? "System/import"}
      </p>
      {entry.notes && (
        <p className="mt-0.5 text-[10px] italic text-muted-foreground">
          “{entry.notes}”
        </p>
      )}
    </div>
  );
}

export function ManualOverrideHistory({
  locationName,
  serviceLine,
  roomType,
}: {
  locationName: string;
  serviceLine: string;
  roomType: string;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery<OverrideHistoryEntry[]>({
    queryKey: [
      "/api/manual-rate-override-history",
      locationName,
      serviceLine,
      roomType,
    ],
    queryFn: async () => {
      const response = await fetch(
        `/api/manual-rate-override-history/${encodeURIComponent(locationName)}/${encodeURIComponent(serviceLine)}/${encodeURIComponent(roomType)}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Failed to load override history");
      return response.json();
    },
    enabled: open,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-muted-foreground"
          aria-label={`View manual override history for ${locationName}, ${serviceLine}, ${roomType}`}
          title="View manual override history"
          onClick={(event) => event.stopPropagation()}
        >
          <History className="mr-1 h-3 w-3" />
          History
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-xs font-semibold">Override history</p>
        <p className="mb-2 text-[10px] text-muted-foreground">
          {locationName} · {serviceLine} · {roomType}
        </p>
        {isLoading ? (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading history…
          </div>
        ) : isError ? (
          <p className="py-2 text-xs text-destructive">Could not load history.</p>
        ) : !data?.length ? (
          <p className="py-2 text-xs text-muted-foreground">No recorded changes yet.</p>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {data.map((entry) => <HistoryEntry key={entry.id} entry={entry} />)}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Persistent entry point for the complete client audit trail. Unlike the
 * segment-level control, this remains available after an override is removed.
 */
export function ManualOverrideHistoryList() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery<OverrideHistoryEntry[]>({
    queryKey: ["/api/manual-rate-override-history", "all"],
    queryFn: async () => {
      const response = await fetch("/api/manual-rate-override-history", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load override history");
      return response.json();
    },
    enabled: open,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          aria-label="View all manual override history"
          title="View all manual override history, including removed overrides"
        >
          <History className="mr-1.5 h-3.5 w-3.5" />
          Override history
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-3" onClick={(event) => event.stopPropagation()}>
        <p className="text-sm font-semibold">Manual override history</p>
        <p className="mb-2 text-[10px] text-muted-foreground">
          Includes active and removed overrides for this client.
        </p>
        {isLoading ? (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading history…
          </div>
        ) : isError ? (
          <p className="py-2 text-xs text-destructive">Could not load history.</p>
        ) : !data?.length ? (
          <p className="py-2 text-xs text-muted-foreground">No recorded changes yet.</p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {data.map((entry) => <HistoryEntry key={entry.id} entry={entry} showSegment />)}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
