import type { RentRollData } from "@shared/schema";
import {
  analyticsCache,
  recordLatestRentRollCacheHit,
  recordLatestRentRollCoalescedRequest,
} from "./commentaryCache";

export interface LatestRentRollSnapshot {
  uploadMonth: string | null;
  rows: RentRollData[];
  generation: number;
}

interface CacheEntry {
  snapshot: LatestRentRollSnapshot;
  cachedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<LatestRentRollSnapshot>>();
const generations = new Map<string, number>();

function purgeRentRollAnalyticsCaches(clientId?: string): void {
  const prefixes = clientId
    ? [
        `campus-metrics:${clientId}:`,
        `vacancy-scatter:${clientId}:`,
        `overview_${clientId}`,
      ]
    : ["campus-metrics:", "vacancy-scatter:", "overview_"];
  for (const key of Array.from(analyticsCache.keys())) {
    if (prefixes.some(prefix => key.startsWith(prefix))) analyticsCache.delete(key);
  }
}

export function getLatestRentRollCacheGeneration(clientId: string): number {
  return generations.get(clientId) ?? 0;
}

export function getLatestRentRollSnapshot(clientId: string): LatestRentRollSnapshot | null {
  const entry = cache.get(clientId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt >= CACHE_TTL_MS) {
    cache.delete(clientId);
    return null;
  }
  recordLatestRentRollCacheHit(clientId);
  return entry.snapshot;
}

export function getLatestRentRollSnapshotInFlight(clientId: string): Promise<LatestRentRollSnapshot> | null {
  const promise = inFlight.get(clientId) ?? null;
  if (promise) recordLatestRentRollCoalescedRequest(clientId);
  return promise;
}

export function setLatestRentRollSnapshot(
  clientId: string,
  snapshot: Omit<LatestRentRollSnapshot, "generation">,
  generation: number,
): void {
  if (getLatestRentRollCacheGeneration(clientId) !== generation) return;
  cache.set(clientId, { snapshot: { ...snapshot, generation }, cachedAt: Date.now() });
}

export function setLatestRentRollSnapshotInFlight(
  clientId: string,
  promise: Promise<LatestRentRollSnapshot>,
): void {
  inFlight.set(clientId, promise);
  promise.finally(() => {
    if (inFlight.get(clientId) === promise) inFlight.delete(clientId);
  }).catch(() => {
    // The original request owns the error; this cleanup must not create
    // an unhandled rejection.
  });
}

export function invalidateLatestRentRollCache(clientId?: string): void {
  if (clientId) {
    cache.delete(clientId);
    generations.set(clientId, getLatestRentRollCacheGeneration(clientId) + 1);
    inFlight.delete(clientId);
    purgeRentRollAnalyticsCaches(clientId);
    return;
  }
  cache.clear();
  for (const clientId of new Set([...generations.keys(), ...inFlight.keys()])) {
    generations.set(clientId, getLatestRentRollCacheGeneration(clientId) + 1);
  }
  inFlight.clear();
  purgeRentRollAnalyticsCaches();
}