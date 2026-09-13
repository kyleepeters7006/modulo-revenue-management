import { formatPct } from "@shared/inhousePlanning";

export interface QuarterYoyDisplayInput {
  priorRate: number | null;
  yoyGrowthPct: number;
  basis: string;
  monthsAvailable: number;
  priorYearLabel: string;
}

export interface QuarterYoyDisplay {
  /** Null only when there is no usable prior-year comparison. */
  yoyPct: number | null;
  /** Partial values are shown but excluded from measured-quarter rollups. */
  includedInSummary: boolean;
  qualifierLabel?: string;
  unavailableLabel?: string;
  unavailableExplanation?: string;
}

export interface QuarterYoySummary {
  averagePct: number;
  measuredQuarterCount: number;
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
    yoyPct: measurable ? input.yoyGrowthPct : null,
    includedInSummary: measurable && !partial,
    qualifierLabel: partial ? `Partial (${input.monthsAvailable}/3)` : undefined,
    unavailableExplanation: measurable
      ? undefined
      : "No usable prior-year comparison is available.",
  };
}

/** The exact text used for an unavailable quarterly YoY value. */
export function formatQuarterYoyDisplay(display: QuarterYoyDisplay): string {
  return display.yoyPct == null
    ? display.unavailableLabel ?? "n/a"
    : formatPct(display.yoyPct, 1);
}

/**
 * Summarize only the same quarter values that are shown as numeric in the
 * breakdown. This keeps partial and unavailable prior-year baselines out of
 * both the average and its measured-quarter count.
 */
export function summarizeQuarterYoy(
  inputs: QuarterYoyDisplayInput[],
): QuarterYoySummary {
  const measuredValues = inputs
    .map((input) => getQuarterYoyDisplay(input))
    .filter((display) => display.includedInSummary && display.yoyPct != null)
    .map((display) => display.yoyPct as number);

  return {
    averagePct:
      measuredValues.length > 0
        ? measuredValues.reduce((sum, value) => sum + value, 0) / measuredValues.length
        : 0,
    measuredQuarterCount: measuredValues.length,
  };
}
