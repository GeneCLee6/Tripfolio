/**
 * Time-zone helpers on top of UTC milliseconds and IANA zone names, using only
 * `Intl.DateTimeFormat` (no tz database bundled).
 */

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** Cached `en-US` formatter that yields numeric parts in 24-hour form for `tz`. */
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

interface WallClock {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  ss: number;
}

/** Wall-clock fields of `utcMs` in `tz`. */
function wallClock(utcMs: number, tz: string): WallClock {
  const p: Record<string, number> = {};
  for (const part of partsFormatter(tz).formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { y: p.year!, m: p.month!, d: p.day!, hh: p.hour! % 24, mm: p.minute!, ss: p.second! };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** UTC offset of `tz` at instant `utcMs`, in minutes east of UTC (NZDT = +780). */
export function offsetMinutesAt(utcMs: number, tz: string): number {
  const w = wallClock(utcMs, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** Thrown for a malformed local date-time string. */
export class TimeFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeFormatError';
  }
}

/**
 * Convert a local wall-clock time (`YYYY-MM-DDTHH:mm`) in `tz` to UTC ms.
 * Times inside a spring-forward gap are moved forward by the gap; ambiguous
 * times in a fall-back overlap resolve to the earlier (daylight) instant.
 */
export function zonedTimeToUtc(localIso: string, tz: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localIso);
  if (!m) throw new TimeFormatError(`Expected YYYY-MM-DDTHH:mm, got ${localIso}`);
  const naive = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  // Candidates from the offsets just before and after the naive instant.
  const offA = offsetMinutesAt(naive - 2 * 864e5, tz);
  const offB = offsetMinutesAt(naive + 2 * 864e5, tz);
  const candidates = [naive - offA * 60000, naive - offB * 60000]
    .filter((u) => u - naive + offsetMinutesAt(u, tz) * 60000 === 0)
    .sort((a, b) => a - b);
  if (candidates.length > 0) return candidates[0]!;
  // Gap: no instant shows this wall time; use the pre-transition offset (moves forward).
  return naive - offA * 60000;
}

/** Local view of an instant, returned by {@link utcToZoned}. */
export interface ZonedTime {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:mm` */
  time: string;
  /** Minutes east of UTC. */
  offsetMinutes: number;
  /** Short zone name as provided by `Intl` (e.g. `GMT+13`, `PST`); platform dependent. */
  abbrev: string;
}

/** Local date, time, offset and short zone name of `utcMs` in `tz`. */
export function utcToZoned(utcMs: number, tz: string): ZonedTime {
  const w = wallClock(utcMs, tz);
  const abbrev =
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date(utcMs))
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  return {
    date: `${w.y}-${pad(w.m)}-${pad(w.d)}`,
    time: `${pad(w.hh)}:${pad(w.mm)}`,
    offsetMinutes: offsetMinutesAt(utcMs, tz),
    abbrev,
  };
}

/** Local `HH:mm` (24-hour) of `utcMs` in `tz`. */
export function formatHm(utcMs: number, tz: string): string {
  const w = wallClock(utcMs, tz);
  return `${pad(w.hh)}:${pad(w.mm)}`;
}

/** Format `utcMs` in `tz` for display with `Intl.DateTimeFormat` (`timeZone` is forced to `tz`). */
export function formatInZone(
  utcMs: number,
  tz: string,
  locale: string = 'zh-TW',
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: tz }).format(new Date(utcMs));
}

/** Whole minutes from instant `fromUtcMs` to `toUtcMs` (positive when `to` is later). */
export function diffMinutes(fromUtcMs: number, toUtcMs: number): number {
  return Math.round((toUtcMs - fromUtcMs) / 60000);
}

/** ISO weekday key (`mon`…`sun`) of a `YYYY-MM-DD` calendar date. */
export function weekdayKey(dateIso: string): 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  return (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** Parse `HH:mm` into minutes after midnight; returns `null` if malformed. */
export function parseHm(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) return null;
  const h = +m[1]!;
  const min = +m[2]!;
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}
