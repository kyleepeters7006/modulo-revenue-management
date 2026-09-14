/**
 * Background generation helpers for portfolio annual reports.
 *
 * The calculation for each campus is independent. A bounded worker pool keeps
 * a portfolio run from opening one database-heavy calculation per campus, and
 * settled results ensure one bad/slow campus never prevents its siblings from
 * being saved.
 */

export interface CampusReportLine {
  serviceLine: string;
  assumptions: unknown;
  tierPolicy: unknown;
}

export interface CampusReportLocation {
  id: string;
  name: string;
}

export interface CampusReportResult {
  lines: Array<{
    serviceLine: string;
    currentPlan: unknown;
    occupancyPct: number | null;
    occupancyMonth: string | null;
    currentTier: string | null;
    cells: unknown[];
    warnings: string[];
  }>;
  skipped: Array<{ serviceLine: string; message: string }>;
}

export interface CampusReportGenerationOptions {
  locations: CampusReportLocation[];
  lines: CampusReportLine[];
  concurrency?: number;
  calculate: (
    location: CampusReportLocation,
    lines: CampusReportLine[],
  ) => Promise<CampusReportResult>;
  save: (input: {
    location: CampusReportLocation;
    serviceLines: string[];
    result: CampusReportResult;
  }) => Promise<void>;
  onError?: (location: CampusReportLocation, error: unknown) => void;
}

export interface CampusReportGenerationResult {
  saved: string[];
  failed: Array<{ locationId: string; message: string }>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

/**
 * Run one independent annual-report calculation at a time per worker. This is
 * intentionally not Promise.all(locations.map(...)): a large portfolio can
 * otherwise exhaust the database pool, while Promise.all also makes a single
 * rejection obscure which campus reports were already durable.
 */
export async function generateCampusAnnualReports(
  options: CampusReportGenerationOptions,
): Promise<CampusReportGenerationResult> {
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? 2, options.locations.length || 1),
  );
  const saved: string[] = [];
  const failed: Array<{ locationId: string; message: string }> = [];
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      const location = options.locations[index];
      if (!location) return;
      try {
        const result = await options.calculate(location, options.lines);
        await options.save({
          location,
          serviceLines: options.lines.map((line) => line.serviceLine),
          result,
        });
        saved.push(location.id);
      } catch (error) {
        const message = errorMessage(error);
        failed.push({ locationId: location.id, message });
        options.onError?.(location, error);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { saved, failed };
}