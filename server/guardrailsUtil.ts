import { db } from "./db";
import { guardrails } from "@shared/schema";
import type { Guardrails } from "@shared/schema";

export interface GuardrailClampResult {
  finalRate: number;
  minAllowed: number;
  maxAllowed: number;
  wasAdjusted: boolean;
}

/**
 * Clamp a proposed rate using guardrails.
 * Percentage limits are relative to the unit's current street rate:
 *   minAllowed = baseRate * (1 + minPriceChangePct/100)   (minPriceChangePct is negative, e.g. -5)
 *   maxAllowed = baseRate * (1 + maxPriceChangePct/100)
 * Absolute price limits (if set) are applied last and take precedence.
 */
export function clampRateWithGuardrails(
  rate: number,
  baseRate: number,
  g: Partial<Guardrails> | null | undefined
): GuardrailClampResult {
  let finalRate = rate;
  let minAllowed = 0;
  let maxAllowed = Infinity;
  let wasAdjusted = false;

  if (g) {
    const minPct = g.minPriceChangePct ?? -5;
    const maxPct = g.maxPriceChangePct ?? 15;

    if (baseRate > 0) {
      minAllowed = baseRate * (1 + minPct / 100);
      maxAllowed = baseRate * (1 + maxPct / 100);

      if (finalRate < minAllowed) {
        finalRate = minAllowed;
        wasAdjusted = true;
      } else if (finalRate > maxAllowed) {
        finalRate = maxAllowed;
        wasAdjusted = true;
      }
    }

    // Absolute limits override percentage limits
    if (g.minAbsolutePrice != null && g.minAbsolutePrice > 0 && finalRate < g.minAbsolutePrice) {
      finalRate = g.minAbsolutePrice;
      minAllowed = g.minAbsolutePrice;
      wasAdjusted = true;
    }
    if (g.maxAbsolutePrice != null && g.maxAbsolutePrice > 0 && finalRate > g.maxAbsolutePrice) {
      finalRate = g.maxAbsolutePrice;
      maxAllowed = g.maxAbsolutePrice;
      wasAdjusted = true;
    }

    if (finalRate < 0) {
      finalRate = Math.max(0, minAllowed);
      wasAdjusted = true;
    }
  }

  return { finalRate, minAllowed, maxAllowed, wasAdjusted };
}

/**
 * Load all guardrail rows once and return a resolver that applies the
 * 3-tier fallback: location+serviceLine → location-only → global default.
 */
export async function buildGuardrailResolver(): Promise<
  (locationId: string | null | undefined, serviceLine: string | null | undefined) => Guardrails | undefined
> {
  const rows = await db.select().from(guardrails);
  const bySpecific = new Map<string, Guardrails>();
  const byLocation = new Map<string, Guardrails>();
  let global: Guardrails | undefined;

  for (const row of rows) {
    if (row.locationId && row.serviceLine) {
      bySpecific.set(`${row.locationId}|${row.serviceLine}`, row);
    } else if (row.locationId) {
      byLocation.set(row.locationId, row);
    } else if (!row.serviceLine) {
      global = row;
    }
  }

  return (locationId, serviceLine) => {
    if (locationId && serviceLine) {
      const specific = bySpecific.get(`${locationId}|${serviceLine}`);
      if (specific) return specific;
    }
    if (locationId) {
      const loc = byLocation.get(locationId);
      if (loc) return loc;
    }
    return global;
  };
}
