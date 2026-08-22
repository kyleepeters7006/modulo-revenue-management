/**
 * Date and quarter helpers for in-house rate planning.
 *
 * Everything here works in UTC. The rent roll stores dates as text in two
 * different shapes (M/D/YYYY on 506k rows, ISO on 59k), so parsing is
 * deliberately tolerant of both; a value that matches neither is treated as
 * absent rather than guessed at.
 */
import type { QuarterRef } from "@shared/inhousePlanning";
import { quarterLabel } from "@shared/inhousePlanning";

const MDY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

/** Normalize a rent-roll date string to `YYYY-MM-DD`, or null if unusable. */
export function parseFlexibleDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const iso = ISO.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const mdy = MDY.exec(raw);
  if (mdy) {
    const m = Number(mdy[1]);
    const d = Number(mdy[2]);
    const y = Number(mdy[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

/** Milliseconds at UTC midnight for an ISO `YYYY-MM-DD`. NaN when unparseable. */
export function isoToMs(iso: string): number {
  const m = ISO.exec(iso);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function msToIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

export const MS_PER_DAY = 86_400_000;

export function quarterOfMonth(month1Based: number): number {
  return Math.floor((month1Based - 1) / 3) + 1;
}

export function makeQuarterRef(year: number, quarter: number): QuarterRef {
  return { year, quarter, label: quarterLabel(year, quarter) };
}

/** Quarter containing an ISO date. */
export function quarterOfDate(iso: string): QuarterRef {
  const m = ISO.exec(iso);
  if (!m) throw new Error(`quarterOfDate: not an ISO date: ${iso}`);
  return makeQuarterRef(Number(m[1]), quarterOfMonth(Number(m[2])));
}

/** Quarter containing a `YYYY-MM` upload month. */
export function quarterOfMonthKey(monthKey: string): QuarterRef {
  const [y, m] = monthKey.split("-").map(Number);
  return makeQuarterRef(y, quarterOfMonth(m));
}

export function addQuarters(ref: QuarterRef, n: number): QuarterRef {
  const zeroBased = ref.year * 4 + (ref.quarter - 1) + n;
  return makeQuarterRef(Math.floor(zeroBased / 4), (zeroBased % 4) + 1);
}

/** Signed distance in quarters from `a` to `b`. */
export function quarterDiff(a: QuarterRef, b: QuarterRef): number {
  return b.year * 4 + (b.quarter - 1) - (a.year * 4 + (a.quarter - 1));
}

/** UTC ms at the first instant of the quarter. */
export function quarterStartMs(ref: QuarterRef): number {
  return Date.UTC(ref.year, (ref.quarter - 1) * 3, 1);
}

/** UTC ms at the first instant of the FOLLOWING quarter (exclusive end). */
export function quarterEndMs(ref: QuarterRef): number {
  return quarterStartMs(addQuarters(ref, 1));
}

/** The three `YYYY-MM` keys inside a quarter. */
export function quarterMonths(ref: QuarterRef): string[] {
  const first = (ref.quarter - 1) * 3 + 1;
  return [0, 1, 2].map((i) => `${ref.year}-${String(first + i).padStart(2, "0")}`);
}

/** Number of days in a `YYYY-MM` month. */
export function daysInMonthKey(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** First and last-inclusive UTC ms of a `YYYY-MM` month. */
export function monthBoundsMs(monthKey: string): { startMs: number; endMs: number } {
  const [y, m] = monthKey.split("-").map(Number);
  return {
    startMs: Date.UTC(y, m - 1, 1),
    endMs: Date.UTC(y, m, 0) + (MS_PER_DAY - 1),
  };
}

/** The `YYYY-MM` key `n` months after `monthKey`. */
export function addMonths(monthKey: string, n: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const zero = y * 12 + (m - 1) + n;
  return `${Math.floor(zero / 12)}-${String((zero % 12) + 1).padStart(2, "0")}`;
}

/**
 * Days of a stay that fall inside `[periodStartMs, periodEndMs)`.
 *
 * A stay with no move-out date is treated as still running. A stay with no
 * move-in date cannot be intersected at all — the caller decides what to do
 * with that (we fall back to counting occupied monthly snapshots).
 */
export function stayDaysInPeriod(
  moveInIso: string | null,
  moveOutIso: string | null,
  periodStartMs: number,
  periodEndMs: number,
): number {
  const inMs = moveInIso ? isoToMs(moveInIso) : NaN;
  const start = Number.isNaN(inMs) ? periodStartMs : Math.max(inMs, periodStartMs);
  const outMs = moveOutIso ? isoToMs(moveOutIso) : NaN;
  // move_out_date is the day the resident left, so it is billed through that day.
  const end = Number.isNaN(outMs) ? periodEndMs : Math.min(outMs + MS_PER_DAY, periodEndMs);
  if (end <= start) return 0;
  return (end - start) / MS_PER_DAY;
}
