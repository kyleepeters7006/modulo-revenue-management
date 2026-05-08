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
import { eq, isNotNull } from "drizzle-orm";

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
        .onConflictDoNothing();
    } catch (err) {
      console.warn("[geocode] DB cache write failed:", err);
    }
  }

  return coords;
}

async function fetchNominatim(address: string): Promise<LatLng | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
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
  // Rows that already have coordinates are skipped; the rest are geocoded and
  // written back so subsequent map requests read from the DB column directly.
  const surveyRows = await db
    .select({
      id: competitiveSurveyData.id,
      competitorAddress: competitiveSurveyData.competitorAddress,
      lat: competitiveSurveyData.lat,
      lng: competitiveSurveyData.lng,
    })
    .from(competitiveSurveyData);

  for (const row of surveyRows) {
    if (row.lat != null && row.lng != null) {
      surveyAddressesCached++;
      continue;
    }
    if (!row.competitorAddress) continue;

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
