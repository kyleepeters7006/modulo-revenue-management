import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Info } from "lucide-react";

interface SuspectRow {
  id: string;
  location: string;
  roomNumber: string;
  serviceLine: string;
  roomType: string | null;
  streetRate: number;
  prevMonthRate: number | null;
  siblingMedianRate: number | null;
  moveInDate: string | null;
  moveOutDate: string | null;
  payorType: string | null;
  classification: "prorated_move_in" | "suspect";
}

interface QualityReport {
  month: string;
  previousMonth: string;
  campuses: { location: string; suspectCount: number; proratedCount: number; rows: SuspectRow[] }[];
  medianShifts: { location: string; serviceLine: string; currentMedian: number; previousMedian: number; ratio: number }[];
  totals: { suspect: number; proratedMoveIn: number; campusesAffected: number };
}

function defaultMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function StreetRateQuality() {
  const [month, setMonth] = useState(defaultMonth());

  const { data: report, isLoading, error } = useQuery<QualityReport>({
    queryKey: [`/api/street-rate-quality?month=${month}`],
    enabled: /^20\d{2}-\d{2}$/.test(month),
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Street Rate Data Quality</h1>
          <p className="text-sm text-muted-foreground">
            Suspect street-rate rows for a month, grouped by campus. Second-occupant (companion
            surcharge) rows are excluded; prorated move-ins are shown for context but expected.
          </p>
        </div>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm"
          data-testid="input-month"
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-red-600">Failed to load report.</p>}

      {report && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Suspect rows</CardTitle></CardHeader>
              <CardContent><span className="text-2xl font-bold" data-testid="text-suspect-count">{report.totals.suspect}</span></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Prorated move-ins (expected)</CardTitle></CardHeader>
              <CardContent><span className="text-2xl font-bold">{report.totals.proratedMoveIn}</span></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Campuses with suspect rows</CardTitle></CardHeader>
              <CardContent><span className="text-2xl font-bold">{report.totals.campusesAffected}</span></CardContent>
            </Card>
          </div>

          {report.medianShifts.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Campus-level median shifts vs {report.previousMonth}</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5 space-y-1 mt-1">
                  {report.medianShifts.map((s) => (
                    <li key={`${s.location}-${s.serviceLine}`}>
                      <strong>{s.location} ({s.serviceLine})</strong>: median ${s.previousMedian.toLocaleString()} → ${s.currentMedian.toLocaleString()}{" "}
                      ({s.ratio < 1 ? `${Math.round(1 / s.ratio)}x drop` : `${Math.round(s.ratio)}x jump`}) — usually a daily/monthly unit
                      change in the export. Re-upload the month with corrected rates.
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Rows tagged <Badge variant="outline" className="mx-1">Prorated move-in</Badge> have a move-in or move-out inside {report.month}:
              the source export replaces the street rate with the resident's prorated first-month charge. This is expected source behavior,
              not corruption. HC / HC/MC rates are daily by design and are only flagged on relative movement.
            </AlertDescription>
          </Alert>

          {report.campuses.length === 0 && (
            <p className="text-sm text-muted-foreground">No suspect street-rate rows found for {report.month}.</p>
          )}

          {report.campuses.map((c) => (
            <Card key={c.location}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  {c.location}
                  {c.suspectCount > 0 && <Badge variant="destructive">{c.suspectCount} suspect</Badge>}
                  {c.proratedCount > 0 && <Badge variant="secondary">{c.proratedCount} prorated</Badge>}
                </CardTitle>
                <CardDescription>Compared against {report.previousMonth}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b">
                        <th className="py-1 pr-3">Room</th>
                        <th className="py-1 pr-3">Service line</th>
                        <th className="py-1 pr-3">Room type</th>
                        <th className="py-1 pr-3 text-right">Rate ({report.month})</th>
                        <th className="py-1 pr-3 text-right">Prior month</th>
                        <th className="py-1 pr-3 text-right">Sibling median</th>
                        <th className="py-1 pr-3">Move-in</th>
                        <th className="py-1">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.rows.map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="py-1 pr-3 font-mono">{r.roomNumber}</td>
                          <td className="py-1 pr-3">{r.serviceLine}</td>
                          <td className="py-1 pr-3">{r.roomType || "—"}</td>
                          <td className="py-1 pr-3 text-right font-mono">${r.streetRate.toLocaleString()}</td>
                          <td className="py-1 pr-3 text-right font-mono">{r.prevMonthRate != null ? `$${r.prevMonthRate.toLocaleString()}` : "—"}</td>
                          <td className="py-1 pr-3 text-right font-mono">{r.siblingMedianRate != null ? `$${r.siblingMedianRate.toLocaleString()}` : "—"}</td>
                          <td className="py-1 pr-3">{r.moveInDate || "—"}</td>
                          <td className="py-1">
                            {r.classification === "prorated_move_in"
                              ? <Badge variant="secondary">Prorated move-in</Badge>
                              : <Badge variant="destructive">Suspect</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
