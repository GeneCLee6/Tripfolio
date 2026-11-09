/**
 * Day checks for the itinerary (E2 AC-2.4). Warnings only, never blocking.
 * Pure and deterministic: warnings are grouped by kind (in the order of
 * {@link WARNING_KINDS}) and, within a kind, follow stop order.
 */
import { localSunTimes } from '../time/sun';
import { parseHm, weekdayKey } from '../time/tz';
import type { Leg } from './legs';
import { stopCoords } from './legs';
import type { ItineraryStop, OpeningHours, WeekdayKey } from './types';

/** Kinds of warnings, in output order. */
export const WARNING_KINDS = ['closed-on-arrival', 'booking-overlap', 'after-sunset', 'no-buffer'] as const;

/** A warning kind. */
export type WarningKind = (typeof WARNING_KINDS)[number];

/** A warning; `data` carries values for the i18n message (times as `HH:mm`). */
export interface Warning {
  kind: WarningKind;
  stopIds: string[];
  data?: Record<string, string | number>;
}

/** Categories treated as outdoor for the after-sunset check. */
export const OUTDOOR_CATEGORIES: readonly string[] = ['viewpoint', 'hike', 'beach', 'park'];

/** Default minimum free time before the end of the day, in minutes. */
export const DEFAULT_BUFFER_MINUTES = 30;

/** Context of {@link checkDay}. */
export interface CheckContext {
  /** Local date of the day, `YYYY-MM-DD`. */
  date: string;
  /** IANA time zone of the destination. */
  tz: string;
  /** Fallback coordinates for the sunset check when a stop has none (e.g. the trip centre). */
  lat?: number;
  lng?: number;
  /** Local `HH:mm` the day starts; defaults to the earliest stop start. */
  dayStart?: string;
  /** Local `HH:mm` the day should end; the no-buffer check is skipped without it. */
  dayEnd?: string;
  /** Minimum free minutes before `dayEnd` (default {@link DEFAULT_BUFFER_MINUTES}). */
  bufferMinutes?: number;
  /** Legs of the day (counted in the scheduled time). */
  legs?: readonly Leg[];
  /** Override of {@link OUTDOOR_CATEGORIES}. */
  outdoorCategories?: readonly string[];
}

const pad = (n: number): string => String(n).padStart(2, '0');
const hm = (min: number): string => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

/** Local `[start, end)` of a stop in minutes after midnight, or `null` without a start time. */
export function stopRange(s: ItineraryStop): { start: number; end: number } | null {
  const start = s.startTime ? parseHm(s.startTime) : null;
  if (start === null) return null;
  let end = s.endTime ? parseHm(s.endTime) : null;
  if (end !== null && end < start) end += 1440;
  if (end === null) end = start + Math.max(0, s.durationMin ?? 0);
  return { start, end };
}

/** Scheduled length of a stop in minutes (from its range, else `durationMin`, else 0). */
function stopMinutes(s: ItineraryStop): number {
  const r = stopRange(s);
  if (r) return r.end - r.start;
  return Math.max(0, s.durationMin ?? 0);
}

/**
 * True when a place with `hours` is open at local minute `at` on `date`.
 * Returns `true` when the hours give no information for that day.
 */
export function isOpenAt(hours: OpeningHours, date: string, at: number): boolean {
  if (hours.closed?.includes(date)) return false;
  const days: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  if (!days.some((d) => hours[d] !== undefined)) return true;
  const key = weekdayKey(date);
  const ranges = hours[key] ?? [];
  // Ranges that ran past midnight from the previous day.
  const prevKey = days[(days.indexOf(key) + 6) % 7]!;
  for (const [o, c] of ranges) {
    const open = parseHm(o);
    const close = parseHm(c);
    if (open === null || close === null) continue;
    if (close > open ? at >= open && at < close : at >= open) return true;
  }
  for (const [o, c] of hours[prevKey] ?? []) {
    const open = parseHm(o);
    const close = parseHm(c);
    if (open === null || close === null) continue;
    if (close <= open && at < close) return true;
  }
  return false;
}

/** True when the booking flag means the stop has a booked / to-book slot. */
function isBooked(s: ItineraryStop): boolean {
  return s.booking === true || s.booking === 'todo' || s.booking === 'booked';
}

/** Run all day checks and return the warnings (see module doc for ordering). Backup stops are ignored. */
export function checkDay(stops: readonly ItineraryStop[], context: CheckContext): Warning[] {
  const active = stops.filter((s) => !s.isBackup);
  const out: Warning[] = [];

  // closed-on-arrival
  for (const s of active) {
    const r = stopRange(s);
    if (!r || !s.hours) continue;
    if (!isOpenAt(s.hours, context.date, r.start)) {
      out.push({ kind: 'closed-on-arrival', stopIds: [s.id], data: { arrival: hm(r.start) } });
    }
  }

  // booking-overlap
  const booked = active.filter(isBooked).map((s) => ({ s, r: stopRange(s) }));
  for (let i = 0; i < booked.length; i++) {
    for (let j = i + 1; j < booked.length; j++) {
      const a = booked[i]!;
      const b = booked[j]!;
      if (!a.r || !b.r) continue;
      if (a.r.start < b.r.end && b.r.start < a.r.end) {
        out.push({ kind: 'booking-overlap', stopIds: [a.s.id, b.s.id] });
      }
    }
  }

  // after-sunset
  const outdoor = context.outdoorCategories ?? OUTDOOR_CATEGORIES;
  for (const s of active) {
    if (!s.category || !outdoor.includes(s.category)) continue;
    const r = stopRange(s);
    if (!r) continue;
    const c = stopCoords(s) ?? (context.lat !== undefined && context.lng !== undefined ? { lat: context.lat, lng: context.lng } : null);
    if (!c) continue;
    const sun = localSunTimes(context.date, c.lat, c.lng, context.tz);
    if (sun.polar === 'night' || (sun.sunset !== null && r.start > parseHm(sun.sunset)!)) {
      out.push({ kind: 'after-sunset', stopIds: [s.id], data: { start: hm(r.start), sunset: sun.sunset ?? '' } });
    }
  }

  // no-buffer
  const dayEnd = context.dayEnd ? parseHm(context.dayEnd) : null;
  if (dayEnd !== null) {
    const ranges = active.map(stopRange).filter((r): r is { start: number; end: number } => r !== null);
    const start = context.dayStart ? parseHm(context.dayStart) : ranges.length ? Math.min(...ranges.map((r) => r.start)) : null;
    if (start !== null) {
      const legMinutes = (context.legs ?? []).reduce((a, l) => a + l.durationS / 60, 0);
      const scheduled = active.reduce((a, s) => a + stopMinutes(s), 0) + legMinutes;
      const finish = Math.max(start + scheduled, ...ranges.map((r) => r.end));
      const free = Math.floor(dayEnd - finish);
      const buffer = context.bufferMinutes ?? DEFAULT_BUFFER_MINUTES;
      if (free < buffer) {
        out.push({
          kind: 'no-buffer',
          stopIds: active.map((s) => s.id),
          data: { freeMinutes: free, bufferMinutes: buffer, finish: hm(Math.ceil(finish)) },
        });
      }
    }
  }

  return out;
}
