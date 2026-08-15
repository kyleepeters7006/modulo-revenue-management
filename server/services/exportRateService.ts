/**
 * Single source of truth for the rates that leave the system in an export.
 *
 * Every exporter must read through here rather than reaching into rent_roll_data
 * directly. Doing so guarantees three things that were previously inconsistent
 * across the MatrixCare exporters:
 *
 *   1. Tenant scoping   — only the requesting client's rows.
 *   2. Period scoping   — only the newest uploaded month, never a blend of history.
 *   3. Rate precedence  — manual override ?? rule-adjusted ?? Modulo ?? street,
 *                         matching what Reference Data and the Rate Card display.
 *
 * Without (1) and (2) the exports averaged years of rent roll across every tenant;
 * without (3) they emitted a rate no screen in the product ever showed.
 */

import { db } from "../db";
import { rentRollData } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";

export type RateSource = 'override' | 'rule' | 'modulo' | 'street';

export interface EffectiveRateUnit {
  id: string;
  locationId: string | null;
  location: string;
  serviceLine: string;
  roomType: string;
  roomNumber: string | null;
  residentId: string | null;
  residentName: string | null;
  occupied: boolean;
  inHouseRate: number;
  streetRate: number;
  /** First usable rate of: manual override, rule-adjusted, Modulo, street. 0 when none. */
  effectiveRate: number;
  rateSource: RateSource;
  /** False when no candidate rate was finite and positive — exporters must skip these. */
  hasRate: boolean;
}

export interface EffectiveRateResult {
  /** Newest upload month actually used, or null when the client has no rent roll. */
  uploadMonth: string | null;
  units: EffectiveRateUnit[];
}

/** Newest upload month for a client, or null when it has no rent roll at all. */
export async function resolveLatestUploadMonth(clientId: string): Promise<string | null> {
  const rows = await db
    .select({ m: sql<string | null>`MAX(${rentRollData.uploadMonth})` })
    .from(rentRollData)
    .where(eq(rentRollData.clientId, clientId));
  return rows[0]?.m ?? null;
}

/**
 * Manual overrides keyed by location + service line + room type.
 *
 * The table is not part of the Drizzle schema, so it is read with a raw query.
 * Keys are lowercased so lookup is insensitive to casing drift between the
 * override rows and the rent roll.
 */
async function loadOverrides(clientId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const result: any = await db.execute(sql`
      SELECT location_id, location_name, service_line, room_type, override_rate
      FROM manual_rate_overrides
      WHERE client_id = ${clientId} AND override_rate IS NOT NULL
    `);
    const rows: any[] = result?.rows ?? result ?? [];
    for (const r of rows) {
      const rate = Number(r.override_rate);
      if (!Number.isFinite(rate)) continue;
      const sl = String(r.service_line ?? '').toLowerCase();
      const rt = String(r.room_type ?? '').toLowerCase();
      if (r.location_id) map.set(`id:${r.location_id}|${sl}|${rt}`, rate);
      if (r.location_name) map.set(`name:${String(r.location_name).toLowerCase()}|${sl}|${rt}`, rate);
    }
  } catch (err) {
    // A missing or renamed overrides table must not silently drop the export;
    // surface it and continue with rule/Modulo rates.
    console.error('[exportRateService] Could not load manual rate overrides:', err);
  }
  return map;
}

/**
 * Units for the client's newest upload month, each carrying its effective rate.
 *
 * @param campusNames Optional rent-roll location names to restrict the export to.
 */
export async function getEffectiveRateUnits(
  clientId: string,
  opts: { campusNames?: string[] } = {}
): Promise<EffectiveRateResult> {
  const uploadMonth = await resolveLatestUploadMonth(clientId);
  if (!uploadMonth) return { uploadMonth: null, units: [] };

  const [rows, overrides] = await Promise.all([
    db.select().from(rentRollData).where(
      and(
        eq(rentRollData.clientId, clientId),
        eq(rentRollData.uploadMonth, uploadMonth),
      )
    ),
    loadOverrides(clientId),
  ]);

  const campusFilter = opts.campusNames && opts.campusNames.length > 0
    ? new Set(opts.campusNames)
    : null;

  const units: EffectiveRateUnit[] = [];

  for (const r of rows) {
    if (campusFilter && !campusFilter.has(r.location)) continue;

    const sl = String(r.serviceLine ?? '').toLowerCase();
    const rt = String(r.roomType ?? '').toLowerCase();
    const override =
      (r.locationId ? overrides.get(`id:${r.locationId}|${sl}|${rt}`) : undefined) ??
      overrides.get(`name:${String(r.location ?? '').toLowerCase()}|${sl}|${rt}`);

    // Walk the precedence chain and take the first *usable* rate. A stored NaN, null or
    // non-positive value is missing data, not a price — treating it as one would push a
    // zero or NaN into a MatrixCare upload, so we fall through to the next candidate.
    const candidates: Array<[number | null | undefined, RateSource]> = [
      [override,               'override'],
      [r.ruleAdjustedRate,     'rule'],
      [r.moduloSuggestedRate,  'modulo'],
      [r.streetRate,           'street'],
    ];

    let effectiveRate = 0;
    let rateSource: RateSource = 'street';
    for (const [value, source] of candidates) {
      if (value != null && Number.isFinite(value) && value > 0) {
        effectiveRate = value;
        rateSource = source;
        break;
      }
    }

    units.push({
      id: r.id,
      locationId: r.locationId ?? null,
      location: r.location,
      serviceLine: r.serviceLine,
      roomType: r.roomType,
      roomNumber: r.roomNumber ?? null,
      residentId: r.residentId ?? null,
      residentName: r.residentName ?? null,
      occupied: r.occupiedYN === true,
      inHouseRate: r.inHouseRate ?? 0,
      streetRate: r.streetRate ?? 0,
      effectiveRate,
      rateSource,
      hasRate: effectiveRate > 0,
    });
  }

  return { uploadMonth, units };
}
