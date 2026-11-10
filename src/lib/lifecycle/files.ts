import type { ExportMember, TripExport } from '../../../shared/api/export.ts'
import {
  MAX_IMPORT_BYTES,
  TRIP_EXPORT_FORMAT,
  TRIP_EXPORT_VERSION,
  TRIP_RESTORE_DAYS,
} from '../../../shared/api/export.ts'

// Pure helpers for the trip lifecycle screens (e1-t07, e8-t03, e8-t05): the file name a download
// carries, the calendar subscription URL, a quick look at an export file before it is imported,
// and the purge countdown. The server validates an import fully (422 with the path); the summary
// here only checks enough to show what is in the file and to refuse obvious mistakes early.

/**
 * The file name in a Content-Disposition header (RFC 6266): the UTF-8 `filename*` when present,
 * then the plain `filename`, else `fallback`. Path separators are stripped.
 */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback
  let name: string | null = null
  const star = /filename\*\s*=\s*([^;]+)/i.exec(header)
  if (star) {
    const value = star[1].trim().replace(/^"(.*)"$/, '$1')
    const match = /^[\w-]+'[^']*'(.*)$/.exec(value)
    try {
      name = decodeURIComponent(match ? match[1] : value)
    } catch {
      name = null
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*("((?:[^"\\]|\\.)*)"|[^;]+)/i.exec(header)
    if (plain) name = (plain[2] ?? plain[1]).replace(/\\(.)/g, '$1').trim()
  }
  const clean = name?.replace(/[/\\]/g, '').trim()
  return clean ? clean : fallback
}

/** GET /api/share/:token/calendar.ics on this origin, as https (for "From URL" in Google Calendar) */
export function calendarFeedUrl(shareToken: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/api/share/${encodeURIComponent(shareToken)}/calendar.ics`
}

/** The same feed as webcal:// (Apple Calendar and most phones subscribe on a tap) */
export function webcalUrl(shareToken: string, origin: string): string {
  return calendarFeedUrl(shareToken, origin).replace(/^https?:\/\//i, 'webcal://')
}

/** Saves a blob through a temporary link (the browser's download) */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export interface ImportSummary {
  name: string
  destination: string
  startDate: string
  endDate: string
  days: number
  stops: number
  places: number
  lodgings: number
  bookings: number
  wishlist: number
  /** null when the file was exported without expenses */
  expenses: number | null
  /** null when the file was exported without photo metadata */
  photos: number | null
  /** The file's members still on the trip (the ones a person can say they are) */
  members: Pick<ExportMember, 'id' | 'name' | 'role'>[]
}

export type ImportProblem = 'tooLarge' | 'json' | 'format' | 'version'

export type ImportParse =
  | { ok: true; file: TripExport; summary: ImportSummary }
  | { ok: false; problem: ImportProblem }

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0)
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Reads an export file's text: what it holds, or why it is not one */
export function parseImportFile(text: string, bytes = new Blob([text]).size): ImportParse {
  if (bytes > MAX_IMPORT_BYTES) return { ok: false, problem: 'tooLarge' }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, problem: 'json' }
  }
  if (!isObject(value) || value.format !== TRIP_EXPORT_FORMAT) return { ok: false, problem: 'format' }
  if (value.version !== TRIP_EXPORT_VERSION) return { ok: false, problem: 'version' }
  const trip = value.trip
  if (
    !isObject(trip) ||
    typeof trip.name !== 'string' ||
    !isDate(trip.startDate) ||
    !isDate(trip.endDate) ||
    !Array.isArray(value.days) ||
    !Array.isArray(value.members)
  )
    return { ok: false, problem: 'format' }
  const members = (value.members as unknown[]).flatMap((m) =>
    isObject(m) && typeof m.id === 'number' && typeof m.name === 'string' && m.removed !== true
      ? [{ id: m.id, name: m.name, role: (m.role as ExportMember['role']) ?? 'editor' }]
      : [],
  )
  const days = (value.days as unknown[]).filter((d) => isObject(d) && d.idx !== null).length
  return {
    ok: true,
    file: value as unknown as TripExport,
    summary: {
      name: trip.name,
      destination: typeof trip.destination === 'string' ? trip.destination : '',
      startDate: trip.startDate,
      endDate: trip.endDate,
      days,
      stops: count(value.stops),
      places: count(value.places),
      lodgings: count(value.lodgings),
      bookings: count(value.bookings),
      wishlist: count(value.wishlist),
      expenses: Array.isArray(value.expenses) ? value.expenses.length : null,
      photos: Array.isArray(value.attachments) ? value.attachments.length : null,
      members,
    },
  }
}

const DAY_MS = 86_400_000
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS
const fromDayNumber = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10)

/** The end date after moving a trip to `newStart` (same length); `end` when newStart is not a date */
export function shiftedEndDate(start: string, end: string, newStart: string): string {
  if (!isDate(newStart) || !isDate(start) || !isDate(end)) return end
  return fromDayNumber(dayNumber(end) + dayNumber(newStart) - dayNumber(start))
}

/** Whole days left until a soft-deleted trip is purged (rounded up; 0 when due) */
export function daysUntilPurge(purgeAt: string, nowMs: number): number {
  const left = Date.parse(purgeAt) - nowMs
  return left <= 0 ? 0 : Math.min(TRIP_RESTORE_DAYS, Math.ceil(left / DAY_MS))
}
