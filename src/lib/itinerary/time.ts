import { formatHm, zonedTimeToUtc } from '../../../shared/time/tz.ts'

// Stop times are stored as UTC instants (RULES.md §3) but edited as the trip's local wall clock on
// the stop's day. These helpers convert between the two without the browser's own time zone.

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** The local `HH:mm` of a stored instant in `tz`, or '' when there is none */
export function localTime(iso: string | null, tz: string): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? formatHm(ms, tz) : ''
}

/** Adds whole days to a YYYY-MM-DD date */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** `HH:mm` on `date` in `tz` as a UTC ISO string (…Z); null for an empty or malformed time */
export function utcFromLocal(date: string, hm: string, tz: string): string | null {
  if (!HM.test(hm) || !DATE.test(date)) return null
  return new Date(zonedTimeToUtc(`${date}T${hm}`, tz)).toISOString().replace('.000Z', 'Z')
}

export interface TimeDraft {
  /** `HH:mm` or '' */
  start: string
  /** `HH:mm` or ''; an end at or before the start is taken as the next day */
  end: string
}

/** The stored startAt / endAt for a draft on `date` (the day's date) in `tz` */
export function draftToInstants(
  draft: TimeDraft,
  date: string,
  tz: string,
): { startAt: string | null; endAt: string | null } {
  const startAt = utcFromLocal(date, draft.start, tz)
  let endAt: string | null = null
  if (draft.end) {
    const endDate = startAt && draft.end <= draft.start ? addDays(date, 1) : date
    endAt = utcFromLocal(endDate, draft.end, tz)
  }
  return { startAt, endAt }
}

/** Minutes from startAt to endAt, or null */
export function spanMinutes(startAt: string | null, endAt: string | null): number | null {
  if (!startAt || !endAt) return null
  const minutes = Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60000)
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null
}
