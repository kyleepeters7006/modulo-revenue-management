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

  // Pre-load all location lat/lng so we can use them as base points for the
  // near-location fallback without an extra DB query per row.
  const locationRows = await db
    .select({ name: locations.name, lat: locations.lat, lng: locations.lng })
    .from(locations);

  const locationCoords = new Map<string, LatLng>();
  // Cache for city-level geocode fallbacks (e.g. "Louisville" from "Louisville - 101")
  const cityFallbackCache = new Map<string, LatLng | null>();

  for (const loc of locationRows) {
    if (loc.lat != null && loc.lng != null) {
      locationCoords.set(loc.name, { lat: loc.lat, lng: loc.lng });
    }
  }

  // Helper: return base coords for a location, falling back to a city-level
  // geocode if the location row itself has no coordinates.
  const getBaseLocation = async (locationName: string | null): Promise<LatLng | null> => {
    if (!locationName) return null;

    const direct = locationCoords.get(locationName);
    if (direct) return direct;

    // Extract city from "City - Code" pattern (e.g. "Louisville - 101" → "Louisville")
    const cityPart = locationName.includes(' - ')
      ? locationName.split(' - ')[0].trim()
      : locationName.trim();

    if (!cityPart) return null;
    if (cityFallbackCache.has(cityPart)) return cityFallbackCache.get(cityPart) ?? null;

    const coords = await geocodeAddress(cityPart);
    cityFallbackCache.set(cityPart, coords);
    if (coords) {
      // Cache it on the full location name too to avoid duplicate lookups
      locationCoords.set(locationName, coords);
    }
    return coords;
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
        const baseLocation = await getBaseLocation(row.keyStatsLocation ?? null);
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
