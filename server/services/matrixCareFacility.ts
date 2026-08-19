/**
 * Resolves a rent-roll location + service line to the facility identity MatrixCare
 * expects on an export row.
 *
 * Shared by the Corporate Room Charges and Special Room Rate exports so the two files
 * can never disagree about which facility record a service line belongs to.
 *
 * Not every tenant has a MatrixCare facility mapping (the mapping tables are populated
 * per-client). When a mapping is absent the resolver falls back to a deterministic name
 * and customer id derived from the location, and reports `mapped: false` so the caller
 * can warn instead of silently dropping the rows — the previous behaviour skipped
 * unmapped facilities entirely, which made the export look empty for those clients.
 */

import { db } from "../db";
import { locations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getMatrixCareNameFromKeyStats, getCustomerFacilityId } from "../campusMapping";

/** MatrixCare groups several service lines onto one facility record. */
export type FacilityGroup = 'HC' | 'AL' | 'IL' | 'VIL';

export function serviceLineToFacilityGroup(serviceLine: string): FacilityGroup {
  const sl = (serviceLine || '').toUpperCase();
  if (sl === 'HC' || sl === 'HC/MC' || sl === 'SNF') return 'HC';
  if (sl === 'AL' || sl === 'AL/MC' || sl === 'MC') return 'AL';
  if (sl === 'VIL') return 'VIL';
  return 'IL'; // SL and anything unrecognised bill under the independent-living record
}

export type BillingFrequency = 'Daily' | 'Monthly';

/**
 * How a service line's stored rate is denominated.
 *
 * Health-campus lines are per diem; senior housing is monthly. Unrecognised service lines
 * follow the independent-living group and are therefore treated as monthly. Every exporter
 * must classify through here — previously each file kept its own service-line list, so an
 * unrecognised line was converted in one export and left raw in another.
 */
export function billingFrequencyFor(serviceLine: string): BillingFrequency {
  return serviceLineToFacilityGroup(serviceLine) === 'HC' ? 'Daily' : 'Monthly';
}

/** Days per month used to convert between monthly and per-diem rates. */
export { DAYS_PER_MONTH } from "@shared/careRates";

/** Minimal shape needed from a locations row. */
export interface FacilityLocation {
  name: string;
  matrixCareNameHC?: string | null;
  matrixCareNameAL?: string | null;
  matrixCareNameIL?: string | null;
  customerFacilityIdHC?: string | null;
  customerFacilityIdAL?: string | null;
  customerFacilityIdIL?: string | null;
}

export interface ResolvedFacility {
  name: string;
  /** Bare id — callers add the MatrixCare `~` prefix where the format requires it. */
  customerId: string;
  /** False when this came from the fallback rather than a real MatrixCare mapping. */
  mapped: boolean;
}

/**
 * Locations for a single client, indexed by id and by name.
 *
 * Scoped by client_id deliberately: location names are only unique within a tenant, so a
 * name-based fallback over an unscoped set could resolve to another tenant's facility
 * mapping when a rent-roll row carries a stale or missing location id.
 */
export async function loadFacilityLookup(clientId: string): Promise<{
  byId: Map<string, typeof locations.$inferSelect>;
  byName: Map<string, typeof locations.$inferSelect>;
}> {
  const rows = await db.select().from(locations).where(eq(locations.clientId, clientId));
  return {
    byId: new Map(rows.map(l => [l.id, l])),
    byName: new Map(rows.map(l => [l.name, l])),
  };
}

export function resolveMatrixCareFacility(
  location: FacilityLocation,
  serviceLine: string
): ResolvedFacility {
  const group = serviceLineToFacilityGroup(serviceLine);
  // Village units bill under the assisted-living facility record.
  const lookupGroup: 'HC' | 'AL' | 'IL' = group === 'VIL' ? 'AL' : group;

  let name: string | null | undefined;
  let customerId: string | null | undefined;

  if (lookupGroup === 'HC') {
    name       = location.matrixCareNameHC     || getMatrixCareNameFromKeyStats(location.name, 'HC');
    customerId = location.customerFacilityIdHC || getCustomerFacilityId(location.name, 'HC');
  } else if (lookupGroup === 'AL') {
    name       = location.matrixCareNameAL     || getMatrixCareNameFromKeyStats(location.name, 'AL');
    customerId = location.customerFacilityIdAL || getCustomerFacilityId(location.name, 'AL');
  } else {
    name       = location.matrixCareNameIL     || getMatrixCareNameFromKeyStats(location.name, 'IL');
    customerId = location.customerFacilityIdIL || getCustomerFacilityId(location.name, 'IL');
  }

  if (name && customerId) {
    return { name, customerId, mapped: true };
  }

  const locCode = location.name.replace(/[^A-Z0-9]/gi, '').substring(0, 6).toUpperCase();
  // Use lookupGroup (never 'VIL') so that unmapped VIL rows get the same fallback
  // facility identity as AL rows — VIL always bills under the AL facility record,
  // and using the raw group here would create a spurious "… VIL" facility entry.
  return {
    name:       name       || `${location.name} ${lookupGroup}`,
    customerId: customerId || `14-${locCode}-${lookupGroup}`,
    mapped:     false,
  };
}
