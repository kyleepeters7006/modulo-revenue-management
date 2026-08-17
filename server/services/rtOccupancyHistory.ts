/**
 * RT Occupancy History helpers
 *
 * Exported so both routes.ts and tests can call the same implementation.
 * The critical export is `lookupRtPhysMap` / `lookupRtOccWindow`: they perform
 * the two-key lookup that guards against branded group names (e.g.
 * "Legacy Lane - Studio") silently missing the rtoRTMap (which is keyed by
 * normalized_room_type, e.g. "Studio") and falling through to the SL roll-up.
 */

export interface RtoEntry { occ: number; avail: number }

/**
 * Resolve the per-room-type physical history map for a (campus, sl, roomType)
 * triple where roomType may be a branded group name.
 *
 * rtoRTMap is keyed  campus||sl||normalizedRoomType  (canonical, e.g. "Studio").
 * c.roomType may be the branded display name (e.g. "Legacy Lane - Studio").
 * c.modeRoomType is the canonical raw rr.room_type from mode() WITHIN GROUP.
 *
 * Try the branded key first so explicit canonical overrides (where group_name
 * happens to equal normalizedRoomType) still work; fall back to the canonical
 * key so that branded group names don't silently miss the map.
 */
export function lookupRtPhysMap(
  rtoRTMap: Map<string, Map<string, RtoEntry>>,
  campus: string,
  sl: string,
  roomType: string,
  modeRoomType: string,
): Map<string, RtoEntry> | undefined {
  return rtoRTMap.get(`${campus}||${sl}||${roomType}`)
      ?? rtoRTMap.get(`${campus}||${sl}||${modeRoomType}`);
}

/**
 * RTO-based occupancy % (0–100) over a window of months.
 * Uses SUM occ / SUM avail (not an average of per-month rates) to give a
 * correctly weighted figure when availability differs across months.
 * Returns null when the map is absent or has no data for any window month.
 */
export function rtoOccWindow(
  map: Map<string, RtoEntry> | undefined,
  window: string[],
): number | null {
  if (!map) return null;
  let totalOcc = 0, totalAvail = 0;
  for (const mm of window) {
    const e = map.get(mm);
    if (e) { totalOcc += e.occ; totalAvail += e.avail; }
  }
  return totalAvail > 0 ? (totalOcc / totalAvail) * 100 : null;
}

/**
 * Two-key RT occupancy lookup with branded-to-canonical fallback.
 * Exactly mirrors the inline pattern in routes.ts:
 *
 *   rtoOccWindow(rtoRTMap.get(`${campus}||${sl}||${roomType}`), window)
 *   ?? rtoOccWindow(rtoRTMap.get(`${campus}||${sl}||${modeRoomType}`), window)
 *
 * Evaluated at the WINDOW level — if the branded map exists but has no data
 * for the requested months, rtoOccWindow returns null and the expression
 * falls through to try the canonical map.  This is the key semantic: we
 * never short-circuit after resolving the map by presence alone.
 *
 * Returns null when neither key yields occupancy data for the window;
 * callers then fall through to the SL-level or rent-roll fallback.
 */
export function lookupRtOccWindow(
  rtoRTMap: Map<string, Map<string, RtoEntry>>,
  campus: string,
  sl: string,
  roomType: string,
  modeRoomType: string,
  window: string[],
): number | null {
  return rtoOccWindow(rtoRTMap.get(`${campus}||${sl}||${roomType}`), window)
      ?? rtoOccWindow(rtoRTMap.get(`${campus}||${sl}||${modeRoomType}`), window);
}

/**
 * Physical vacancy (avail − occ) averaged over a window, rounded to one
 * decimal place. Returns null when the map is absent or has no data.
 */
export function physVacWindow(
  map: Map<string, RtoEntry> | undefined,
  window: string[],
): number | null {
  if (!map) return null;
  const vals: number[] = [];
  for (const mm of window) {
    const e = map.get(mm);
    if (e) vals.push(e.avail - e.occ);
  }
  if (!vals.length) return null;
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  return Math.round(avg * 10) / 10;
}
