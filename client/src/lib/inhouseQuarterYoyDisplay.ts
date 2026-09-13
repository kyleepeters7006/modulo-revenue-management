import { formatPct } from "@shared/inhousePlanning";

export interface QuarterYoyDisplayInput {
  priorRate: number | null;
  yoyGrowthPct: number;
  basis: string;
  monthsAvailable: number;
  priorYearLabel: string;
}

export interface QuarterYoyDisplay {
  /** Null when the prior-year quarter has no complete realized comparison. */
  yoyPct: number | null;
  unavailableLabel?: string;
  unavailableExplanation?: string;
}

export interface QuarterLabelInput {
  quarter: number;
  year: number;
}

/**
 * Keep quarter labels compact for a single-year plan, but include the year
 * whenever the plan crosses a year boundary so adjacent labels stay distinct.
 */
export function formatQuarterLabels(
  quarters: ReadonlyArray<QuarterLabelInput>,
): string[] {
  const singleYear = new Set(quarters.map(({ year }) => year)).size <= 1;
  return quarters.map(({ quarter, year }) =>
    singleYear ? `Q${quarter}` : `Q${quarter} '${String(year).slice(-2)}`,
  );
}

/**
 * Convert a quarter's prior-year baseline into the value the summary displays.
 *
 * A partial baseline may have a finite ratio, but it is not a complete
 * quarter-over-quarter comparison and must remain labelled as partial.
 */
export function getQuarterYoyDisplay(
  input: QuarterYoyDisplayInput,
): QuarterYoyDisplay {
  const measurable =
    input.priorRate != null &&
    input.priorRate > 0 &&
    Number.isFinite(input.yoyGrowthPct);
  const partial = input.basis === "partial";

  return {
    yoyPct: measurable && !partial ? input.yoyGrowthPct : null,
    unavailableLabel: partial
      ? `Partial (${input.monthsAvailable}/3)`
      : undefined,
    unavailableExplanation: partial
      ? `${input.priorYearLabel} has ${input.monthsAvailable} of 3 months available, so it is excluded from measured quarterly YoY.`
      : "No usable prior-year comparison is available.",
  };
}

/** The exact text used for an unavailable quarterly YoY value. */
export function formatQuarterYoyDisplay(display: QuarterYoyDisplay): string {
  return display.yoyPct == null
    ? display.unavailableLabel ?? "n/a"
    : formatPct(display.yoyPct, 1);
}