import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Info, Loader2, Scale } from "lucide-react";

interface DriftRow {
  census: number;
  ours: number;
  drift: number;
}
interface ServiceLineRow extends DriftRow { serviceLine: string }
interface DivisionRow extends DriftRow { division: string }

interface ReconciliationResponse {
  available: boolean;
  reason?: string;
  period?: { year: number; month: number; asOfDate: string | null; sourceFile: string | null };
  total?: DriftRow & { driftPercent: number };
  byServiceLine?: ServiceLineRow[];
  byDivision?: DivisionRow[];
  unmatchedCensusDivisions?: { division: string; census: number }[];
  unmatchedOurDivisions?: { division: string; ours: number }[];
}

const fmt = (n: number) => n.toLocaleString();
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

/** Green when clean, amber for small drift, red once it's material. */
function driftTone(drift: number, base: number) {
  if (drift === 0) return "text-gray-500";
  const pct = base ? Math.abs(drift / base) * 100 : 100;
  return pct >= 1 ? "text-red-600" : "text-amber-600";
}

function DriftTable({
  label, rows, keyOf,
}: {
  label: string;
  rows: (DriftRow & Record<string, any>)[];
  keyOf: (r: any) => string;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{label}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
              <th className="text-left font-medium py-1.5 pr-3">{label.includes("Division") ? "Division" : "Service line"}</th>
              <th className="text-right font-medium py-1.5 px-3">Census</th>
              <th className="text-right font-medium py-1.5 px-3">Ours</th>
              <th className="text-right font-medium py-1.5 pl-3">Drift</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={keyOf(r)} className="border-b border-gray-100 last:border-0" data-testid={`row-recon-${keyOf(r)}`}>
                <td className="py-1.5 pr-3 text-gray-900">{keyOf(r)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums text-gray-700">{fmt(r.census)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums text-gray-700">{fmt(r.ours)}</td>
                <td className={`py-1.5 pl-3 text-right tabular-nums font-medium ${driftTone(r.drift, r.census)}`}>
                  {r.drift === 0 ? "—" : signed(r.drift)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Ties our derived unit counts against the client's own census report.
 *
 * The census is a reference source only — occupancy history remains what the
 * app actually computes and prices on. This panel exists to surface drift, not
 * to correct it.
 */
export default function CensusReconciliation() {
  const { data, isLoading } = useQuery<ReconciliationResponse>({
    queryKey: ["/api/census-reconciliation"],
  });

  if (isLoading) {
    return (
      <Card data-testid="card-census-reconciliation">
        <CardContent className="py-8 flex items-center justify-center text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading reconciliation…
        </CardContent>
      </Card>
    );
  }

  if (!data?.available) {
    return (
      <Card data-testid="card-census-reconciliation">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Scale className="h-4 w-4" /> Census Reconciliation
          </CardTitle>
          <CardDescription>{data?.reason ?? "No census report has been loaded."}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { period, total, byServiceLine = [], byDivision = [], unmatchedCensusDivisions = [], unmatchedOurDivisions = [] } = data;
  const clean = total!.drift === 0;

  return (
    <Card data-testid="card-census-reconciliation">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4" /> Census Reconciliation
            </CardTitle>
            <CardDescription>
              Our unit counts checked against the census report as of {period?.asOfDate ?? "—"}.
              Occupancy history stays the source of truth; this is a tie-out only.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className={clean ? "border-green-300 text-green-700 bg-green-50" : "border-amber-300 text-amber-700 bg-amber-50"}
            data-testid="badge-recon-status"
          >
            {clean ? <CheckCircle2 className="h-3 w-3 mr-1" /> : null}
            {clean ? "In balance" : `${signed(total!.drift)} units`}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Headline */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Census reports", value: fmt(total!.census), tone: "text-gray-900" },
            { label: "We report", value: fmt(total!.ours), tone: "text-gray-900" },
            { label: "Drift", value: `${signed(total!.drift)} (${total!.driftPercent.toFixed(2)}%)`, tone: driftTone(total!.drift, total!.census) },
          ].map((s) => (
            <div key={s.label} className="rounded-md border border-gray-200 p-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">{s.label}</div>
              <div className={`text-xl font-semibold tabular-nums mt-1 ${s.tone}`} data-testid={`text-recon-${s.label.replace(/\s+/g, "-").toLowerCase()}`}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        <DriftTable label="By service line" rows={byServiceLine} keyOf={(r) => r.serviceLine} />

        {byDivision.length > 0 && (
          <DriftTable label="By division" rows={byDivision} keyOf={(r) => r.division} />
        )}

        {(unmatchedCensusDivisions.length > 0 || unmatchedOurDivisions.length > 0) && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-xs space-y-1">
              <div>
                Some divisions can't be compared because the two systems group campuses differently —
                the census carries "… With Kingston" variants that our data doesn't. They're listed
                rather than force-matched, since equating them would report drift that isn't real.
                Their capacity is still included in the totals above.
              </div>
              {unmatchedCensusDivisions.length > 0 && (
                <div><span className="font-medium">Census only:</span>{" "}
                  {unmatchedCensusDivisions.map((d) => `${d.division} (${fmt(d.census)})`).join(", ")}
                </div>
              )}
              {unmatchedOurDivisions.length > 0 && (
                <div><span className="font-medium">Ours only:</span>{" "}
                  {unmatchedOurDivisions.map((d) => `${d.division} (${fmt(d.ours)})`).join(", ")}
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
