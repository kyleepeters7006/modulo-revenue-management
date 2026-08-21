import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  MapPin,
  Building2,
  BedDouble,
  Info,
  ExternalLink,
} from "lucide-react";

/**
 * Row shape served by /api/competitor-rate-comparison. Every dollar figure on
 * this payload is MONTHLY — HC/HC-MC daily survey rates are converted upstream
 * — so this view never has to reason about mixed bases.
 */
export interface CompetitorRateRow {
  id: string | number;
  competitorName: string;
  competitorType?: string | null;
  serviceLine?: string | null;
  roomType?: string | null;
  distanceMiles?: number | null;
  baseRate?: number | null;
  careLevel2Adjustment?: number | null;
  medMgmtAdjustment?: number | null;
  adjustedRate?: number | null;
  trilogyRate?: number | null;
  marketPosition?: number | null;
  occupancyRate?: number | null;
  careApplies?: boolean;
  theirCareLevel2?: number | null;
  ourCareLevel2?: number | null;
}

interface Props {
  row: CompetitorRateRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientShortName: string;
  onOpenRateCard?: (row: CompetitorRateRow) => void;
}

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

const signedMoney = (n: number | null | undefined) => {
  if (n == null) return "—";
  const v = Math.round(n);
  if (v === 0) return "$0";
  return v > 0 ? `+$${v.toLocaleString()}` : `−$${Math.abs(v).toLocaleString()}`;
};

/** Positive = competitor is more expensive than us. */
const deltaTone = (n: number | null | undefined) => {
  if (n == null || Math.round(n) === 0) return "text-gray-500";
  return n > 0 ? "text-green-600" : "text-red-600";
};

export function CompetitorDetailDialog({
  row,
  open,
  onOpenChange,
  clientShortName,
  onOpenRateCard,
}: Props) {
  if (!row) return null;

  const base = row.baseRate ?? 0;
  const careAdj = row.careLevel2Adjustment ?? 0;
  const medMgmt = row.medMgmtAdjustment ?? 0;
  const adjusted = row.adjustedRate ?? 0;
  const ours = row.trilogyRate ?? 0;
  const position = row.marketPosition ?? 0;

  // Gap is stated from our point of view: positive means we price above them.
  const gap = ours && adjusted ? ours - adjusted : null;

  const positionColor =
    position >= 100 ? "text-green-600" : position >= 90 ? "text-yellow-600" : "text-red-600";
  const PositionIcon = position > 100 ? TrendingUp : position >= 90 ? Minus : TrendingDown;

  // Care has three distinct states and they must not collapse into one another:
  // not applicable to the service line, applicable but missing our reference
  // rate, or a real differential.
  const careApplies = row.careApplies ?? true;
  const haveOurCare = row.ourCareLevel2 != null;
  const haveTheirCare = row.theirCareLevel2 != null;
  // Their care rate was never surveyed, yet the comparison still subtracted our
  // care rate as if they charge nothing. Say so rather than implying a $0 fee.
  const careAssumedZero = careApplies && haveOurCare && !haveTheirCare && careAdj !== 0;

  const waterfall = [
    { label: "Base rent", value: base, signed: false, strong: true },
    { label: "Care level 2 adjustment", value: careAdj, signed: true, strong: false },
    { label: "Medication management", value: medMgmt, signed: true, strong: false },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto"
        data-testid="dialog-competitor-detail"
      >
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 pr-6 text-left">
            <Building2 className="h-5 w-5 mt-0.5 flex-shrink-0 text-gray-400" />
            <span data-testid="text-detail-competitor-name">{row.competitorName}</span>
          </DialogTitle>
          {/* Screen-reader summary. The same facts are shown visually in the
              identity row below, which cannot be used here because it contains
              block elements and DialogDescription renders a <p>. */}
          <DialogDescription className="sr-only">
            Monthly rate detail for {row.competitorName}
            {row.serviceLine ? `, ${row.serviceLine}` : ""}
            {row.roomType ? `, ${row.roomType}` : ""}: base rent {money(base)}, adjusted rent{" "}
            {money(adjusted)}, compared against the {clientShortName} rate of {money(ours)}.
          </DialogDescription>
        </DialogHeader>

        {/* Identity */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {row.serviceLine && <Badge variant="outline">{row.serviceLine}</Badge>}
          {row.roomType && (
            <span className="inline-flex items-center gap-1 text-gray-600">
              <BedDouble className="h-3.5 w-3.5" />
              {row.roomType}
            </span>
          )}
          {row.distanceMiles != null && (
            <span className="inline-flex items-center gap-1 text-gray-600">
              <MapPin className="h-3.5 w-3.5" />
              {row.distanceMiles.toFixed(1)} mi away
            </span>
          )}
          {/* Competitor occupancy is deliberately not shown: the stored column
              mixes fractions (0.69) and percentages (69), so it cannot be
              rendered truthfully without a scale fix upstream. */}
        </div>

        {/* Headline rents — the three numbers this view exists to show */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-1">
          <div className="rounded-lg border bg-gray-50 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Base rent</div>
            <div className="text-2xl font-semibold mt-1" data-testid="text-detail-base-rate">
              {money(base)}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">As surveyed</div>
          </div>
          <div className="rounded-lg border-2 border-teal-500 bg-teal-50 p-3">
            <div className="text-xs uppercase tracking-wide text-teal-700">Adjusted rent</div>
            <div
              className="text-2xl font-semibold mt-1 text-teal-900"
              data-testid="text-detail-adjusted-rate"
            >
              {money(adjusted)}
            </div>
            <div className="text-xs text-teal-700 mt-0.5">Comparable to ours</div>
          </div>
          <div className="rounded-lg border bg-gray-50 p-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              {clientShortName} rate
            </div>
            <div className="text-2xl font-semibold mt-1 inline-flex items-center gap-1.5">
              {onOpenRateCard ? (
                <button
                  className="text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1.5"
                  onClick={() => onOpenRateCard(row)}
                  title="Open in Rate Card filtered to this service line & room type"
                  data-testid="button-detail-rate-card"
                >
                  {money(ours)}
                  <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                </button>
              ) : (
                money(ours)
              )}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">Street rate</div>
          </div>
        </div>

        {/* How the adjusted rent is built */}
        <div className="mt-2">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            How the adjusted rent is built
          </h3>
          <div className="rounded-lg border divide-y">
            {waterfall.map((step) => (
              <div key={step.label} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className={step.strong ? "font-medium text-gray-800" : "text-gray-600"}>
                  {step.label}
                </span>
                <span
                  className={`tabular-nums ${
                    step.signed ? deltaTone(step.value) : "font-medium text-gray-900"
                  }`}
                >
                  {step.signed ? signedMoney(step.value) : money(step.value)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2.5 bg-teal-50">
              <span className="font-semibold text-teal-900">Adjusted rent</span>
              <span className="font-semibold tabular-nums text-teal-900">{money(adjusted)}</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-1.5">
            Adjustments put this competitor on the same footing as {clientShortName} before the
            rates are compared.
          </p>
        </div>

        {/* Care rates — the reason the adjustment exists */}
        <div className="mt-1">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Care level 2 rates</h3>
          {!careApplies ? (
            <div className="rounded-lg border bg-gray-50 px-3 py-2.5 text-sm text-gray-600 flex items-start gap-2">
              <Info className="h-4 w-4 mt-0.5 flex-shrink-0 text-gray-400" />
              <span>
                Care level 2 pricing does not apply to {row.serviceLine}, so no care adjustment is
                made.
              </span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-gray-500">They charge</div>
                  <div
                    className={`font-semibold mt-0.5 ${
                      haveTheirCare ? "text-lg" : "text-sm text-amber-600"
                    }`}
                    data-testid="text-detail-their-care"
                  >
                    {haveTheirCare ? money(row.theirCareLevel2) : "Not surveyed"}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-gray-500">{clientShortName} charges</div>
                  <div className="text-lg font-semibold mt-0.5" data-testid="text-detail-our-care">
                    {money(row.ourCareLevel2)}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-gray-500">Difference</div>
                  <div
                    className={`text-lg font-semibold mt-0.5 ${deltaTone(careAdj)}`}
                    data-testid="text-detail-care-adj"
                  >
                    {haveOurCare ? signedMoney(careAdj) : "—"}
                  </div>
                </div>
              </div>
              <p
                className={`text-xs mt-1.5 ${
                  careAssumedZero ? "text-amber-600" : "text-gray-500"
                }`}
                data-testid="text-detail-care-note"
              >
                {!haveOurCare ? (
                  <>
                    No {clientShortName} care level 2 rate is on file for {row.serviceLine}, so no
                    care adjustment is applied.
                  </>
                ) : careAssumedZero ? (
                  <>
                    This competitor's care rate was never surveyed. The comparison still subtracts
                    the {clientShortName} care rate as if they charge nothing, so their adjusted
                    rent may be understated.
                  </>
                ) : !haveTheirCare ? (
                  <>
                    This competitor's care rate was never surveyed, so no care adjustment is
                    applied.
                  </>
                ) : row.theirCareLevel2 === 0 ? (
                  <>
                    This competitor charges no separate care fee, so their rent is reduced by the{" "}
                    {clientShortName} care rate to compare like for like.
                  </>
                ) : (
                  <>Monthly care level 2 charge on each side; the difference adjusts their rent.</>
                )}
              </p>
            </>
          )}
        </div>

        <Separator />

        {/* Where we land */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Market position</h3>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className={`flex items-center gap-1.5 ${positionColor}`}>
                <PositionIcon className="h-5 w-5" />
                <span className="text-2xl font-semibold" data-testid="text-detail-position">
                  {position.toFixed(1)}%
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {clientShortName} rate as a share of their adjusted rent
              </div>
            </div>
            <div className="text-right">
              <div className={`text-lg font-semibold ${deltaTone(gap == null ? null : -gap)}`}>
                {signedMoney(gap)}
              </div>
              <div className="text-xs text-gray-500">
                {gap == null
                  ? "No comparison available"
                  : gap > 0
                  ? `${clientShortName} prices above them`
                  : gap < 0
                  ? `${clientShortName} prices below them`
                  : "Priced level"}
              </div>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-400">
          All figures are monthly. Competitor type: {row.competitorType || "N/A"}.
        </p>
      </DialogContent>
    </Dialog>
  );
}

export default CompetitorDetailDialog;
