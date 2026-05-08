/**
 * Geocoding utility — converts address strings to lat/lng via OpenStreetMap Nominatim.
 *
 * Caching strategy (two layers):
 *   L1 – in-process Map<string, LatLng | null>  (instant, lost on restart)
 *   L2 – geocode_cache DB table                 (persistent across restarts)
 *
 * Rate limiting:
 *   A module-level promise chain ensures at most one Nominatim HTTP request
 *   per 1.1 seconds, regardless of how many callers invoke geocodeAddress
 *   concurrently. This satisfies Nominatim's 1 request/second usage policy.
 */

import { db } from "./db";
import { geocodeCache, locations, competitiveSurveyData, competitors } from "@shared/schema";
import { eq, isNotNull, isNull, or } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

// ── US state centroid lookup (last-resort fallback) ───────────────────────────
// Approximate geographic centroids for each US state/territory.
// Used when Nominatim fails for both the full address and the city name so that
// competitor pins are still placed in the correct state rather than nowhere.

const US_STATE_CENTROIDS: Record<string, LatLng> = {
  AL: { lat: 32.806671, lng: -86.791130 },
  AK: { lat: 61.370716, lng: -152.404419 },
  AZ: { lat: 33.729759, lng: -111.431221 },
  AR: { lat: 34.969704, lng: -92.373123 },
  CA: { lat: 36.116203, lng: -119.681564 },
  CO: { lat: 39.059811, lng: -105.311104 },
  CT: { lat: 41.597782, lng: -72.755371 },
  DE: { lat: 39.318523, lng: -75.507141 },
  FL: { lat: 27.766279, lng: -81.686783 },
  GA: { lat: 33.040619, lng: -83.643074 },
  HI: { lat: 21.094318, lng: -157.498337 },
  ID: { lat: 44.240459, lng: -114.478828 },
  IL: { lat: 40.349457, lng: -88.986137 },
  IN: { lat: 39.849426, lng: -86.258278 },
  IA: { lat: 42.011539, lng: -93.210526 },
  KS: { lat: 38.526600, lng: -96.726486 },
  KY: { lat: 37.668140, lng: -84.670067 },
  LA: { lat: 31.169960, lng: -91.867805 },
  ME: { lat: 44.693947, lng: -69.381927 },
  MD: { lat: 39.063946, lng: -76.802101 },
  MA: { lat: 42.230171, lng: -71.530106 },
  MI: { lat: 43.326618, lng: -84.536095 },
  MN: { lat: 45.694454, lng: -93.900192 },
  MS: { lat: 32.741646, lng: -89.678696 },
  MO: { lat: 38.456085, lng: -92.288368 },
  MT: { lat: 46.921925, lng: -110.454353 },
  NE: { lat: 41.125370, lng: -98.268082 },
  NV: { lat: 38.313515, lng: -117.055374 },
  NH: { lat: 43.452492, lng: -71.563896 },
  NJ: { lat: 40.298904, lng: -74.521011 },
  NM: { lat: 34.840515, lng: -106.248482 },
  NY: { lat: 42.165726, lng: -74.948051 },
  NC: { lat: 35.630066, lng: -79.806419 },
  ND: { lat: 47.528912, lng: -99.784012 },
  OH: { lat: 40.388783, lng: -82.764915 },
  OK: { lat: 35.565342, lng: -96.928917 },
  OR: { lat: 44.572021, lng: -122.070938 },
  PA: { lat: 40.590752, lng: -77.209755 },
  RI: { lat: 41.680893, lng: -71.511780 },
  SC: { lat: 33.856892, lng: -80.945007 },
  SD: { lat: 44.299782, lng: -99.438828 },
  TN: { lat: 35.747845, lng: -86.692345 },
  TX: { lat: 31.054487, lng: -97.563461 },
  UT: { lat: 40.150032, lng: -111.862434 },
  VT: { lat: 44.045876, lng: -72.710686 },
  VA: { lat: 37.769337, lng: -78.169968 },
  WA: { lat: 47.400902, lng: -121.490494 },
  WV: { lat: 38.491226, lng: -80.954453 },
  WI: { lat: 44.268543, lng: -89.616508 },
  WY: { lat: 42.755966, lng: -107.302490 },
  DC: { lat: 38.897438, lng: -77.026817 },
};

/**
 * Extract a two-letter US state abbreviation from any string.
 * Handles patterns like "Byron Center, MI 49315", "MI", "Michigan", etc.
 */
function extractStateAbbr(str: string): string | null {
  if (!str) return null;
  // Match two-letter uppercase abbreviation preceded by comma/space and optionally followed by a zip or end
  const m = str.match(/\b([A-Z]{2})\b(?:\s+\d{5})?/);
  if (m && US_STATE_CENTROIDS[m[1]]) return m[1];
  // Try case-insensitive version
  const upper = str.toUpperCase();
  const m2 = upper.match(/[,\s]([A-Z]{2})(?:\s+\d{5}|\s*$|[,\s])/);
  if (m2 && US_STATE_CENTROIDS[m2[1]]) return m2[1];
  return null;
}

// ── L1 in-memory cache ────────────────────────────────────────────────────────

const memCache = new Map<string, LatLng | null>();

// ── Global rate-limiter ───────────────────────────────────────────────────────
// We chain every Nominatim HTTP call onto this promise so they execute serially
// with a 1.1 s gap between them.

const NOMINATIM_DELAY_MS = 1100;
let nominatimQueue: Promise<void> = Promise.resolve();

function enqueueNominatimCall<T>(fn: () => Promise<T>): Promise<T> {
  const result = nominatimQueue.then(fn);
  // After fn completes (or fails), wait 1.1 s before the next request.
  nominatimQueue = result
    .then(() => sleep(NOMINATIM_DELAY_MS))
    .catch(() => sleep(NOMINATIM_DELAY_MS));
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Core geocoder ─────────────────────────────────────────────────────────────

/**
 * Convert an address string to lat/lng coordinates.
 *
 * Check order: L1 memory → L2 DB → Nominatim API (rate-limited).
 * Results (including null for "not found") are written to both caches.
 */
export async function geocodeAddress(address: string | null): Promise<LatLng | null> {
  if (!address) return null;

  const key = address.trim().toLowerCase();

  // L1 hit
  if (memCache.has(key)) return memCache.get(key) ?? null;

  // L2 hit (DB)
  try {
    const [row] = await db
      .select({ lat: geocodeCache.lat, lng: geocodeCache.lng })
      .from(geocodeCache)
      .where(eq(geocodeCache.address, key));

    if (row) {
      const coords: LatLng = { lat: row.lat, lng: row.lng };
      memCache.set(key, coords);
      return coords;
    }
  } catch (err) {
    // DB unavailable — continue to live lookup
    console.warn("[geocode] DB cache read failed:", err);
  }

  // Nominatim live lookup (rate-limited)
  const coords = await enqueueNominatimCall(() => fetchNominatim(address));

  // Write to both caches
  memCache.set(key, coords);
  if (coords) {
    try {
      await db
        .insert(geocodeCache)
        .values({ address: key, lat: coords.lat, lng: coords.lng })
        .onConflictDoUpdate({
          target: geocodeCache.address,
          set: { lat: coords.lat, lng: coords.lng },
        });
    } catch (err) {
      console.warn("[geocode] DB cache write failed:", err);
    }
  }

  return coords;
}

async function fetchNominatim(address: string): Promise<LatLng | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=us`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Modulo-RevenueManagement/1.0 (contact@modulo.app)",
        "Accept-Language": "en",
      },
    });

    if (!response.ok) {
      console.warn(`[geocode] Nominatim HTTP ${response.status} for: ${address}`);
      return null;
    }

    const data: Array<{ lat: string; lon: string }> = await response.json();

    if (Array.isArray(data) && data.length > 0) {
      return {
        lat: Number(parseFloat(data[0].lat).toFixed(6)),
        lng: Number(parseFloat(data[0].lon).toFixed(6)),
      };
    }

    return null;
  } catch (err) {
    console.error(`[geocode] Nominatim error for "${address}":`, err);
    return null;
  }
}

// ── Near-location geocoder ────────────────────────────────────────────────────

/**
 * Geocode an address, using a nearby base location as a context hint.
 *
 * Tries real geocoding first. If Nominatim can't resolve the address and a
 * base location is provided, falls back to a deterministic offset so the
 * marker at least appears in the right region (useful for demo/fake addresses).
 */
export async function geocodeAddressNearLocation(
  address: string | null,
  baseLocation: LatLng | null,
  distanceMiles: number = 10,
): Promise<LatLng | null> {
  if (!address) return null;

  const real = await geocodeAddress(address);
  if (real) return real;

  if (!baseLocation) return null;

  // Deterministic offset fallback
  const hash = simpleHash(address);
  const angle = (hash % 360) * (Math.PI / 180);
  const latOffset = (distanceMiles / 69) * Math.cos(angle);
  const lngOffset = (distanceMiles / 54) * Math.sin(angle);
  const variation = ((hash % 30) - 15) / 100;

  return {
    lat: Number((baseLocation.lat + latOffset + variation).toFixed(6)),
    lng: Number((baseLocation.lng + lngOffset + variation).toFixed(6)),
  };
}

// ── Geocode locations missing coordinates ─────────────────────────────────────

export interface GeocodeMissingResult {
  updated: number;
  failed: number;
  skipped: number;
}

/**
 * Geocode only locations that have null lat or lng values.
 * Locations that already have both coordinates are skipped entirely.
 * Runs in the background — callers should not await unless they need the result.
 */
export async function geocodeMissingLocations(): Promise<GeocodeMissingResult> {
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  const missing = await db
    .select({
      id: locations.id,
      name: locations.name,
      address: locations.address,
      city: locations.city,
      state: locations.state,
    })
    .from(locations)
    .where(or(isNull(locations.lat), isNull(locations.lng)));

  if (missing.length === 0) {
    console.log("[geocode-missing] All locations already have coordinates.");
    return { updated, failed, skipped };
  }

  console.log(`[geocode-missing] ${missing.length} location(s) need geocoding…`);

  for (const loc of missing) {
    const parts = [loc.address, loc.city, loc.state].filter(Boolean);
    if (parts.length === 0) {
      skipped++;
      console.warn(`[geocode-missing] Skipping "${loc.name}" — no address info.`);
      continue;
    }

    const addressStr = parts.join(", ");
    const coords = await geocodeAddress(addressStr);

    if (coords) {
      await db
        .update(locations)
        .set({ lat: coords.lat, lng: coords.lng })
        .where(eq(locations.id, loc.id));
      updated++;
      console.log(`[geocode-missing] "${loc.name}" → ${coords.lat}, ${coords.lng}`);
    } else {
      failed++;
      console.warn(`[geocode-missing] Could not geocode "${loc.name}" (${addressStr})`);
    }
  }

  console.log(`[geocode-missing] Done: ${updated} updated, ${failed} failed, ${skipped} skipped.`);
  return { updated, failed, skipped };
}

// ── Geocode competitor survey rows missing coordinates ────────────────────────

export interface GeocodeMissingSurveysResult {
  updated: number;
  failed: number;
  skipped: number;
}

/**
 * Geocode competitive_survey_data rows that have null lat or lng.
 *
 * Strategy per row:
 *   1. If the notes column contains JSON with latitude/longitude fields, use those.
 *   2. Otherwise try geocodeAddressNearLocation(competitorAddress, baseLocation):
 *      a. Nominatim resolves the real address → uses real coords.
 *      b. Nominatim fails (e.g. fake demo address) → deterministic offset
 *         near the associated portfolio location so the pin appears in the
 *         right region even for synthetic data.
 *
 * Rows that already have both coordinates are skipped (idempotent).
 * Unique addresses are geocoded only once and the result is reused for every
 * row that shares the same address, reducing Nominatim calls significantly.
 */
export async function geocodeMissingCompetitorSurveys(): Promise<GeocodeMissingSurveysResult> {
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  const missing = await db
    .select({
      id: competitiveSurveyData.id,
      notes: competitiveSurveyData.notes,
      competitorAddress: competitiveSurveyData.competitorAddress,
      keyStatsLocation: competitiveSurveyData.keyStatsLocation,
    })
    .from(competitiveSurveyData)
    .where(or(isNull(competitiveSurveyData.lat), isNull(competitiveSurveyData.lng)));

  if (missing.length === 0) {
    console.log("[geocode-survey] All competitive_survey_data rows already have coordinates.");
    return { updated, failed, skipped };
  }

  console.log(`[geocode-survey] ${missing.length} survey row(s) need geocoding…`);

  // Pre-load all location lat/lng + state so we can use them as base points for
  // the near-location fallback without an extra DB query per row.
  const locationRows = await db
    .select({ name: locations.name, lat: locations.lat, lng: locations.lng, state: locations.state, city: locations.city })
    .from(locations);

  const locationCoords = new Map<string, LatLng>();
  const locationState = new Map<string, string>(); // locationName → state abbr
  // Cache for city-level geocode fallbacks (e.g. "Louisville" from "Louisville - 101")
  const cityFallbackCache = new Map<string, LatLng | null>();

  for (const loc of locationRows) {
    if (loc.lat != null && loc.lng != null) {
      locationCoords.set(loc.name, { lat: loc.lat, lng: loc.lng });
    }
    if (loc.state) {
      const abbr = extractStateAbbr(loc.state) ?? (loc.state.length === 2 ? loc.state.toUpperCase() : null);
      if (abbr && US_STATE_CENTROIDS[abbr]) {
        locationState.set(loc.name, abbr);
      }
    }
  }

  // Helper: return base coords for a location, falling back to city-level
  // geocode, then state centroid as a last resort.
  const getBaseLocation = async (locationName: string | null, competitorAddress?: string | null): Promise<LatLng | null> => {
    if (!locationName) {
      // No location name — try extracting state from the competitor address directly
      if (competitorAddress) {
        const abbr = extractStateAbbr(competitorAddress);
        if (abbr) return US_STATE_CENTROIDS[abbr] ?? null;
      }
      return null;
    }

    const direct = locationCoords.get(locationName);
    if (direct) return direct;

    // Extract city from "City - Code" pattern (e.g. "Louisville - 101" → "Louisville")
    const cityPart = locationName.includes(' - ')
      ? locationName.split(' - ')[0].trim()
      : locationName.trim();

    if (cityPart) {
      if (cityFallbackCache.has(cityPart)) {
        const cached = cityFallbackCache.get(cityPart) ?? null;
        if (cached) return cached;
      } else {
        const coords = await geocodeAddress(cityPart);
        cityFallbackCache.set(cityPart, coords);
        if (coords) {
          locationCoords.set(locationName, coords);
          return coords;
        }
      }
    }

    // State centroid fallback — use stored state from the location row
    const stateAbbr = locationState.get(locationName);
    if (stateAbbr && US_STATE_CENTROIDS[stateAbbr]) {
      const centroid = US_STATE_CENTROIDS[stateAbbr];
      console.log(`[geocode-survey] Using state centroid for "${locationName}" (${stateAbbr}) → ${centroid.lat}, ${centroid.lng}`);
      locationCoords.set(locationName, centroid);
      return centroid;
    }

    // Last resort: try extracting state from the competitor address
    if (competitorAddress) {
      const abbr = extractStateAbbr(competitorAddress);
      if (abbr && US_STATE_CENTROIDS[abbr]) {
        const centroid = US_STATE_CENTROIDS[abbr];
        console.log(`[geocode-survey] Using state centroid from competitor address (${abbr}) for "${locationName}" → ${centroid.lat}, ${centroid.lng}`);
        locationCoords.set(locationName, centroid);
        return centroid;
      }
    }

    return null;
  };

  // Cache geocode results per address to avoid redundant Nominatim calls
  const addressCache = new Map<string, LatLng | null>();

  for (const row of missing) {
    // 1. Try coordinates embedded in notes JSON (imported from CSV Latitude/Longitude columns)
    let coords: LatLng | null = null;
    try {
      const notes = typeof row.notes === 'string' ? JSON.parse(row.notes) : (row.notes ?? {});
      const lat = parseFloat(notes.latitude);
      const lng = parseFloat(notes.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        coords = { lat, lng };
      }
    } catch {
      // notes not valid JSON — ignore
    }

    // 2. Geocode the address, using the associated portfolio location as a
    //    context hint for the deterministic-offset fallback.
    if (!coords) {
      if (!row.competitorAddress) {
        skipped++;
        console.warn(`[geocode-survey] Skipping row ${row.id} — no address.`);
        continue;
      }

      // Key by (address, location) so that unresolved/fake addresses that are
      // identical across different locations each get their own deterministic
      // offset near the correct city rather than reusing the first computed one.
      const addrNorm = row.competitorAddress.trim().toLowerCase();
      const cacheKey = `${addrNorm}||${(row.keyStatsLocation ?? '').toLowerCase()}`;
      if (addressCache.has(cacheKey)) {
        coords = addressCache.get(cacheKey) ?? null;
      } else {
        const baseLocation = await getBaseLocation(row.keyStatsLocation ?? null, row.competitorAddress);
        coords = await geocodeAddressNearLocation(row.competitorAddress, baseLocation, 8);
        addressCache.set(cacheKey, coords);
      }
    }

    if (coords) {
      await db
        .update(competitiveSurveyData)
        .set({ lat: coords.lat, lng: coords.lng })
        .where(eq(competitiveSurveyData.id, row.id));
      updated++;
    } else {
      failed++;
      console.warn(`[geocode-survey] Could not geocode "${row.competitorAddress}" (row ${row.id})`);
    }
  }

  console.log(`[geocode-survey] Done: ${updated} updated, ${failed} failed, ${skipped} skipped (no address).`);
  return { updated, failed, skipped };
}

// ── Batch re-geocode ──────────────────────────────────────────────────────────

export interface ReGeocodeResult {
  locationsUpdated: number;
  locationsFailed: number;
  competitorsUpdated: number;
  competitorsFailed: number;
  surveyAddressesCached: number;
}

/**
 * Re-geocode all portfolio locations and competitor records using Nominatim.
 *
 * - Updates lat/lng on the `locations` table rows.
 * - Updates lat/lng on the `competitors` table rows that have an address.
 * - Geocodes all unique competitor addresses from `competitive_survey_data`
 *   and writes them to the persistent `geocode_cache` table so subsequent
 *   map requests use the DB cache rather than calling Nominatim live.
 * - All requests are queued through the global rate-limiter (1.1 s apart).
 */
export async function reGeocodeAll(): Promise<ReGeocodeResult> {
  let locationsUpdated = 0;
  let locationsFailed = 0;
  let competitorsUpdated = 0;
  let competitorsFailed = 0;
  let surveyAddressesCached = 0;

  // ── Portfolio locations ────────────────────────────────────────────────────
  const allLocations = await db
    .select({
      id: locations.id,
      name: locations.name,
      address: locations.address,
      city: locations.city,
      state: locations.state,
    })
    .from(locations);

  for (const loc of allLocations) {
    const parts = [loc.address, loc.city, loc.state].filter(Boolean);
    if (parts.length === 0) continue;

    const addressStr = parts.join(", ");
    const key = addressStr.trim().toLowerCase();

    // Clear stale cache so fresh Nominatim result is always persisted
    memCache.delete(key);
    try {
      await db.delete(geocodeCache).where(eq(geocodeCache.address, key));
    } catch (err) {
      console.warn(`[regeocode] Could not clear DB cache for "${addressStr}":`, err);
    }

    const coords = await geocodeAddress(addressStr);

    if (coords) {
      await db
        .update(locations)
        .set({ lat: coords.lat, lng: coords.lng })
        .where(eq(locations.id, loc.id));
      locationsUpdated++;
      console.log(`[regeocode] location "${loc.name}" → ${coords.lat}, ${coords.lng}`);
    } else {
      locationsFailed++;
      console.warn(`[regeocode] Could not geocode location "${loc.name}" (${addressStr})`);
    }
  }

  // ── Competitors table (has its own lat/lng columns) ────────────────────────
  const allCompetitors = await db
    .select({
      id: competitors.id,
      name: competitors.name,
      address: competitors.address,
    })
    .from(competitors)
    .where(isNotNull(competitors.address));

  for (const comp of allCompetitors) {
    if (!comp.address) continue;

    const compKey = comp.address.trim().toLowerCase();

    // Clear stale cache so fresh Nominatim result is always persisted
    memCache.delete(compKey);
    try {
      await db.delete(geocodeCache).where(eq(geocodeCache.address, compKey));
    } catch (err) {
      console.warn(`[regeocode] Could not clear DB cache for competitor "${comp.address}":`, err);
    }

    const coords = await geocodeAddress(comp.address);

    if (coords) {
      await db
        .update(competitors)
        .set({ lat: coords.lat, lng: coords.lng })
        .where(eq(competitors.id, comp.id));
      competitorsUpdated++;
      console.log(`[regeocode] competitor "${comp.name}" → ${coords.lat}, ${coords.lng}`);
    } else {
      competitorsFailed++;
      console.warn(`[regeocode] Could not geocode competitor "${comp.name}" (${comp.address})`);
    }
  }

  // ── Competitive survey data — persist lat/lng directly on each row ──────────
  // All rows are re-geocoded (cache cleared first) so stale coordinates stored
  // directly on survey rows are always refreshed. lat/lng are not fetched from
  // the DB because no skip-if-coords-exist guard is used — every row with an
  // address goes through geocodeAddress() after both caches are cleared.
  const surveyRows = await db
    .select({
      id: competitiveSurveyData.id,
      competitorAddress: competitiveSurveyData.competitorAddress,
    })
    .from(competitiveSurveyData);

  for (const row of surveyRows) {
    if (!row.competitorAddress) continue;

    const surveyKey = row.competitorAddress.trim().toLowerCase();

    // Clear stale memCache and DB cache so a fresh Nominatim result is always
    // fetched, even when the row already has coordinates.
    memCache.delete(surveyKey);
    try {
      await db.delete(geocodeCache).where(eq(geocodeCache.address, surveyKey));
    } catch (err) {
      console.warn(`[regeocode] Could not clear DB cache for survey address "${row.competitorAddress}":`, err);
    }

    const coords = await geocodeAddress(row.competitorAddress);
    if (coords) {
      await db
        .update(competitiveSurveyData)
        .set({ lat: coords.lat, lng: coords.lng })
        .where(eq(competitiveSurveyData.id, row.id));
      surveyAddressesCached++;
      console.log(`[regeocode] survey row ${row.id} → ${coords.lat}, ${coords.lng}`);
    }
  }

  return { locationsUpdated, locationsFailed, competitorsUpdated, competitorsFailed, surveyAddressesCached };
}

// ── Distance helpers ──────────────────────────────────────────────────────────

/**
 * Haversine distance between two lat/lng points, in miles.
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3959;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export function findNearestLocation(
  targetLat: number,
  targetLng: number,
  locs: Array<{ name: string; lat: number; lng: number }>,
): { name: string; distance: number } | null {
  if (!locs || locs.length === 0) return null;

  let nearest = locs[0];
  let minDist = calculateDistance(targetLat, targetLng, nearest.lat, nearest.lng);

  for (const loc of locs) {
    const d = calculateDistance(targetLat, targetLng, loc.lat, loc.lng);
    if (d < minDist) {
      minDist = d;
      nearest = loc;
    }
  }

  return { name: nearest.name, distance: minDist };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
