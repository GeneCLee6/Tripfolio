// Time helpers for lodgings and bookings (e4-t01) on top of shared/time/tz.ts: incoming local
// wall-clock times become UTC ISO, UTC instants are placed on a trip day by the trip's zone.

import { utcToZoned, zonedTimeToUtc } from '../../shared/time/tz.ts'

/** 'YYYY-MM-DDTHH:mm' in `tz` → UTC ISO ('…:00.000Z') */
export function localToUtcIso(local: string, tz: string): string {
  return new Date(zonedTimeToUtc(local, tz)).toISOString()
}

/** The local calendar date (YYYY-MM-DD) of a UTC ISO instant in `tz` */
export function localDate(utcIso: string, tz: string): string {
  return utcToZoned(Date.parse(utcIso), tz).date
}

/** The local HH:mm of a UTC ISO instant in `tz` */
export function localTime(utcIso: string, tz: string): string {
  return utcToZoned(Date.parse(utcIso), tz).time
}

/**
 * Picks the UTC value for a field that may come as UTC (`utc`) or local (`local`, read in `tz`).
 * `local` wins when both are sent; undefined means "not in the request".
 */
export function resolveInstant(
  utc: string | null | undefined,
  local: string | null | undefined,
  tz: string,
): string | null | undefined {
  if (local !== undefined && local !== null) return localToUtcIso(local, tz)
  if (local === null && utc === undefined) return null
  return utc
}
