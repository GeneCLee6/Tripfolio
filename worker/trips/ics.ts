// Calendar export (e8-t05): an iCalendar (RFC 5545) file of the trip.
//
//   GET /api/trips/:id/calendar.ics   any member (Bearer memberToken): a one-off download
//   GET /api/share/:token/calendar.ics the share token: the subscription URL ("訂閱 URL"); Google
//                                      Calendar / Apple Calendar poll it (webcal://… or "From URL"),
//                                      so it must work without headers. It applies the share's
//                                      options like GET /api/share/:token does: hideAddresses drops
//                                      LOCATION/GEO, addresses, booking references and phone
//                                      numbers; hideMoney drops every price. Lodging and booking
//                                      notes never reach a share calendar.
//
// Events: stops with a start time (UTC DTSTART/DTEND, or DURATION from durationMin); one all-day
// "Day N · title" event per day listing its stops without a time; lodgings as an all-day span from
// check-in to check-out day; bookings (flights, rentals as pickup + drop-off, ferries, rail, bus,
// drivers, activities) with a summary of their details. Stops generated from a booking or lodging
// are left out (the booking/lodging event covers them), and so are backup stops. All times are UTC
// (…Z), so no VTIMEZONE is needed; X-WR-TIMEZONE tells clients the trip's zone. UIDs are stable
// (`<entity>-<id>@tripfolio`) so a re-import or a subscription refresh updates instead of
// duplicating; SEQUENCE is the row's rev.

import type { ShareOptions } from '../../shared/schema/share.ts'
import { isCurrencyCode, minorUnitsOf } from '../../shared/money/currencies.ts'
import type { Trip } from '../../shared/api/types.ts'
import { authTrip, hashToken, isTokenShaped } from '../auth.ts'
import { toShare, toTrip, type Row } from '../db.ts'
import { nowIso } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { SHARE_HEADERS } from '../share.ts'
import { addDays } from './day-plan.ts'
import { attachmentDisposition, fileSlug } from './export.ts'

// ---- RFC 5545 text ------------------------------------------------------------------------------

/** TEXT value escaping (RFC 5545 §3.3.11): backslash, semicolon, comma, newlines */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

const encoder = new TextEncoder()

/**
 * Content-line folding (RFC 5545 §3.1): lines longer than 75 octets are split, continuation lines
 * start with one space. Splits fall between characters, never inside a UTF-8 sequence.
 */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line
  const out: string[] = []
  let current = ''
  let octets = 0
  let limit = 75
  for (const ch of line) {
    const size = encoder.encode(ch).length
    if (octets + size > limit) {
      out.push(current)
      current = ''
      octets = 0
      limit = 74 // the leading space counts
    }
    current += ch
    octets += size
  }
  out.push(current)
  return out.join('\r\n ')
}

/** 2026-12-20T01:00:00.000Z → 20261220T010000Z */
export function icsUtc(iso: string): string {
  const d = new Date(iso)
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/** 2026-12-20 → 20261220 */
export const icsDate = (date: string) => date.replace(/-/g, '')

export interface IcsEvent {
  uid: string
  summary: string
  /** A UTC instant (DATE-TIME …Z) or an all-day date (VALUE=DATE) */
  start: { utc: string } | { date: string }
  /** Exclusive end; for all-day events the day after the last day */
  end?: { utc: string } | { date: string }
  durationMin?: number
  location?: string
  geo?: { lat: number; lng: number }
  description?: string
  lastModified?: string
  sequence?: number
  categories?: string
}

function dateProp(name: string, value: { utc: string } | { date: string }): string {
  return 'utc' in value
    ? `${name}:${icsUtc(value.utc)}`
    : `${name};VALUE=DATE:${icsDate(value.date)}`
}

export interface CalendarInput {
  name: string
  tz: string
  events: IcsEvent[]
  /** DTSTAMP of every event */
  now: string
}

/** The whole VCALENDAR, CRLF line endings, folded */
export function buildCalendar({ name, tz, events, now }: CalendarInput): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tripfolio//Trip calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${tz}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ]
  const stamp = icsUtc(now)
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`, dateProp('DTSTART', e.start))
    if (e.end) lines.push(dateProp('DTEND', e.end))
    else if (e.durationMin !== undefined) lines.push(`DURATION:PT${e.durationMin}M`)
    lines.push(`SUMMARY:${escapeText(e.summary)}`)
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`)
    if (e.geo) lines.push(`GEO:${e.geo.lat.toFixed(6)};${e.geo.lng.toFixed(6)}`)
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`)
    if (e.categories) lines.push(`CATEGORIES:${escapeText(e.categories)}`)
    if (e.lastModified) lines.push(`LAST-MODIFIED:${icsUtc(e.lastModified)}`)
    if (e.sequence !== undefined) lines.push(`SEQUENCE:${e.sequence}`)
    lines.push('TRANSP:TRANSPARENT', 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

// ---- the trip's events --------------------------------------------------------------------------

const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''))
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : str(v))

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

/** 12345 AUD → "123.45 AUD" (decimals per shared/money/currencies.ts); no locale on purpose */
export function moneyText(minor: number, currency: string): string {
  const decimals = isCurrencyCode(currency) ? minorUnitsOf(currency) : 2
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  if (decimals === 0) return `${sign}${abs} ${currency}`
  const factor = 10 ** decimals
  const whole = Math.floor(abs / factor)
  const frac = String(abs % factor).padStart(decimals, '0')
  return `${sign}${whole}.${frac} ${currency}`
}

const BOOKING_LABEL: Record<string, string> = {
  flight: 'Flight',
  rental: 'Rental',
  driver: 'Driver',
  ferry: 'Ferry',
  rail: 'Rail',
  bus: 'Bus',
  activity: 'Activity',
}

export interface CalendarOptions {
  hideAddresses: boolean
  hideMoney: boolean
  /** A share calendar: never lodging/booking notes */
  share: boolean
}

interface Place {
  name: string
  address: string
  lat: number
  lng: number
}

/** The trip's events, filtered by `options` */
export async function tripEvents(
  db: D1Database,
  trip: Trip,
  options: CalendarOptions,
): Promise<IcsEvent[]> {
  const all = async (sql: string) => (await db.prepare(sql).bind(trip.id).all<Row>()).results
  const [dayRows, stopRows, placeRows, lodgingRows, bookingRows] = await Promise.all([
    all('SELECT * FROM days WHERE tripId = ? AND idx IS NOT NULL ORDER BY idx'),
    all('SELECT * FROM stops WHERE tripId = ? ORDER BY dayId, "order", id'),
    all('SELECT * FROM places WHERE tripId = ?'),
    all('SELECT * FROM lodgings WHERE tripId = ? AND deletedAt IS NULL ORDER BY checkIn, id'),
    all('SELECT * FROM bookings WHERE tripId = ? AND deletedAt IS NULL ORDER BY startAt, id'),
  ])
  const places = new Map<string, Place>(
    placeRows.map((r) => [
      str(r.id),
      {
        name: str(r.nameLocal) || str(r.nameEn),
        address: str(r.address),
        lat: Number(r.lat),
        lng: Number(r.lng),
      },
    ]),
  )
  const bookingIds = new Set(bookingRows.map((r) => str(r.id)))
  const lodgingIds = new Set(lodgingRows.map((r) => str(r.id)))

  const where = (placeId: unknown, fallback?: string | null) => {
    const place = placeId ? places.get(str(placeId)) : undefined
    if (options.hideAddresses) return {}
    const parts = place ? [place.name, place.address].filter(Boolean) : [fallback ?? '']
    const location = parts.filter(Boolean).join(', ')
    return {
      ...(location ? { location } : {}),
      ...(place ? { geo: { lat: place.lat, lng: place.lng } } : {}),
    }
  }
  const money = (minor: unknown, currency: unknown): string | null =>
    options.hideMoney || minor === null || minor === undefined || !currency
      ? null
      : moneyText(Number(minor), str(currency))
  const meta = (r: Row) => ({ lastModified: str(r.updatedAt), sequence: Number(r.rev ?? 0) })
  const lines = (...parts: unknown[]) =>
    parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join('\n')

  const events: IcsEvent[] = []

  // Stops: timed ones are events; the rest are listed on their day's all-day event
  const stopsByDay = new Map<string, Row[]>()
  for (const r of stopRows) {
    if (Number(r.isBackup) === 1) continue
    if (r.bookingId && bookingIds.has(str(r.bookingId))) continue
    if (r.lodgingId && lodgingIds.has(str(r.lodgingId))) continue
    const list = stopsByDay.get(str(r.dayId)) ?? []
    list.push(r)
    stopsByDay.set(str(r.dayId), list)
  }
  const stopName = (r: Row) => {
    const place = r.placeId ? places.get(str(r.placeId)) : undefined
    return str(r.title) || place?.name || str(r.type)
  }
  for (const day of dayRows) {
    const stops = stopsByDay.get(str(day.id)) ?? []
    const untimed = stops.filter((s) => !s.startAt)
    const date = strOrNull(day.date)
    if (date && (untimed.length > 0 || str(day.title))) {
      const title = str(day.title)
      events.push({
        uid: `day-${str(day.id)}@tripfolio`,
        summary: title ? `Day ${Number(day.idx)} · ${title}` : `Day ${Number(day.idx)}`,
        start: { date },
        end: { date: addDays(date, 1) },
        description: lines(untimed.map((s) => `• ${stopName(s)}`).join('\n'), str(day.note)),
        ...meta(day),
      })
    }
    for (const s of stops) {
      if (!s.startAt) continue
      const links = parseJson<{ url: string }[]>(s.links, []).map((l) => l.url)
      const cost = money(s.costMinor, s.currency)
      const event: IcsEvent = {
        uid: `stop-${str(s.id)}@tripfolio`,
        summary: stopName(s),
        start: { utc: str(s.startAt) },
        description: lines(str(s.note), cost && `Cost: ${cost}`, ...links),
        categories: str(s.type),
        ...where(s.placeId),
        ...meta(s),
      }
      if (s.endAt && str(s.endAt) > str(s.startAt)) event.end = { utc: str(s.endAt) }
      else if (s.durationMin !== null && s.durationMin !== undefined)
        event.durationMin = Number(s.durationMin)
      events.push(event)
    }
  }

  for (const r of lodgingRows) {
    const price = money(r.priceMinor, r.currency)
    events.push({
      uid: `lodging-${str(r.id)}@tripfolio`,
      summary: str(r.name),
      start: { date: str(r.checkIn) },
      // All-day span covering the check-in and the check-out day
      end: { date: addDays(str(r.checkOut), 1) },
      description: lines(
        r.checkInTime && `Check-in ${str(r.checkInTime)} (${str(r.checkIn)})`,
        r.checkOutTime
          ? `Check-out ${str(r.checkOutTime)} (${str(r.checkOut)})`
          : `Check-out ${str(r.checkOut)}`,
        strOrNull(r.platform),
        !options.hideAddresses && r.ref && `Ref: ${str(r.ref)}`,
        !options.hideAddresses && r.phone && `Phone: ${str(r.phone)}`,
        price && `Price: ${price}`,
        !options.share && str(r.note),
      ),
      categories: 'lodging',
      ...where(r.placeId),
      ...meta(r),
    })
  }

  for (const r of bookingRows) {
    if (!r.startAt) continue
    const type = str(r.type)
    const d = parseJson<Record<string, unknown>>(r.details, {})
    const text = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : null)
    const price = money(r.priceMinor, r.currency)
    const common = lines(
      BOOKING_LABEL[type] ?? type,
      !options.hideAddresses && r.ref && `Ref: ${str(r.ref)}`,
      price && `Price: ${price}`,
      !options.share && str(r.note),
    )
    const base = { categories: type, ...meta(r) }
    const start = str(r.startAt)
    const end = r.endAt && str(r.endAt) > start ? str(r.endAt) : null
    switch (type) {
      case 'flight': {
        events.push({
          ...base,
          uid: `booking-${str(r.id)}@tripfolio`,
          summary: str(r.title),
          start: { utc: start },
          ...(end ? { end: { utc: end } } : {}),
          ...(options.hideAddresses || !text('fromAirport')
            ? {}
            : { location: text('fromAirport') ?? '' }),
          description: lines(
            [text('airline'), text('flightNo')].filter(Boolean).join(' '),
            `${text('fromAirport') ?? ''}${text('fromTerminal') ? ` T${text('fromTerminal')}` : ''} → ${text('toAirport') ?? ''}${text('toTerminal') ? ` T${text('toTerminal')}` : ''}`,
            text('baggage') && `Baggage: ${text('baggage')}`,
            common,
          ),
        })
        break
      }
      case 'rental': {
        const summary = lines(
          [text('company'), text('vehicle')].filter(Boolean).join(' · '),
          text('insurance') && `Insurance: ${text('insurance')}`,
          !options.hideMoney &&
            typeof d.excessMinor === 'number' &&
            r.currency &&
            `Excess: ${moneyText(d.excessMinor, str(r.currency))}`,
          !options.hideMoney &&
            typeof d.depositMinor === 'number' &&
            r.currency &&
            `Deposit: ${moneyText(d.depositMinor, str(r.currency))}`,
          text('mileageLimit') && `Mileage: ${text('mileageLimit')}`,
          common,
        )
        events.push({
          ...base,
          uid: `booking-${str(r.id)}-pickup@tripfolio`,
          summary: `${str(r.title)} · pick-up`,
          start: { utc: start },
          durationMin: 30,
          description: summary,
          ...where(d.pickupPlaceId, text('pickupText')),
        })
        if (end)
          events.push({
            ...base,
            uid: `booking-${str(r.id)}-dropoff@tripfolio`,
            summary: `${str(r.title)} · drop-off`,
            start: { utc: end },
            durationMin: 30,
            description: summary,
            ...where(d.dropoffPlaceId, text('dropoffText')),
          })
        break
      }
      case 'driver': {
        const includes = Array.isArray(d.includes) ? (d.includes as string[]).join(', ') : null
        events.push({
          ...base,
          uid: `booking-${str(r.id)}@tripfolio`,
          summary: str(r.title),
          start: { utc: start },
          ...(end ? { end: { utc: end } } : {}),
          description: lines(
            text('driverName'),
            !options.hideAddresses && text('phone') && `Phone: ${text('phone')}`,
            !options.hideAddresses && text('messenger') && `Messenger: ${text('messenger')}`,
            text('vehicle'),
            text('pickupTime') && `Daily pick-up ${text('pickupTime')}`,
            !options.hideAddresses && text('pickupText') && `Pick-up: ${text('pickupText')}`,
            !options.hideMoney &&
              typeof d.dailyRateMinor === 'number' &&
              r.currency &&
              `Daily rate: ${moneyText(d.dailyRateMinor, str(r.currency))}`,
            includes && `Includes: ${includes}`,
            common,
          ),
        })
        break
      }
      case 'activity': {
        const checkIn = typeof d.checkInMinutesBefore === 'number' ? d.checkInMinutesBefore : null
        events.push({
          ...base,
          uid: `booking-${str(r.id)}@tripfolio`,
          summary: str(r.title),
          start: { utc: start },
          ...(end ? { end: { utc: end } } : {}),
          description: lines(
            text('operator'),
            checkIn !== null && `Check in ${checkIn} min before`,
            text('weatherPolicy') && `Weather: ${text('weatherPolicy')}`,
            common,
          ),
          ...where(d.meetingPlaceId, text('meetingText')),
        })
        break
      }
      default: {
        // ferry, rail, bus
        events.push({
          ...base,
          uid: `booking-${str(r.id)}@tripfolio`,
          summary: str(r.title),
          start: { utc: start },
          ...(end ? { end: { utc: end } } : {}),
          description: lines(
            text('operator'),
            `${text('fromText') ?? ''} → ${text('toText') ?? ''}`,
            text('vehicleLength') && `Vehicle: ${text('vehicleLength')}`,
            common,
          ),
          ...(options.hideAddresses || !text('fromText')
            ? {}
            : { location: text('fromText') ?? '' }),
        })
      }
    }
  }
  return events
}

const CALENDAR_HEADERS = {
  'content-type': 'text/calendar; charset=utf-8',
  'cache-control': 'private, no-store',
}

function calendarResponse(trip: Trip, body: string, extra: Record<string, string> = {}) {
  const name = `${fileSlug(trip.name)}.ics`
  return new Response(body, {
    headers: {
      ...CALENDAR_HEADERS,
      'content-disposition': attachmentDisposition(name, 'ics'),
      ...extra,
    },
  })
}

/** GET /api/trips/:id/calendar.ics (viewer): everything the members see */
export async function memberCalendar(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'viewer')
  const events = await tripEvents(c.env.DB, auth.trip, {
    hideAddresses: false,
    hideMoney: false,
    share: false,
  })
  const body = buildCalendar({ name: auth.trip.name, tz: auth.trip.tz, events, now: nowIso() })
  return calendarResponse(auth.trip, body)
}

/** GET /api/share/:token/calendar.ics: the subscription URL, filtered by the share's options */
export async function shareCalendar(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const token = c.params.token
  const row = isTokenShaped(token)
    ? await db
        .prepare(
          `SELECT s.options AS shareOptions, t.* FROM shares s JOIN trips t ON t.id = s.tripId
            WHERE s.tokenHash = ? AND s.revokedAt IS NULL AND t.deletedAt IS NULL`,
        )
        .bind(await hashToken(token))
        .first<Row>()
    : null
  if (!row)
    return Response.json(
      { error: { code: 'not_found', message: 'share not found' } },
      { status: 404, headers: SHARE_HEADERS },
    )
  const trip = toTrip(row)
  const stored: Partial<ShareOptions> = toShare({ options: row.shareOptions }).options
  const options = {
    hideMoney: stored.hideMoney ?? false,
    hideAddresses: stored.hideAddresses ?? false,
  }
  const events = await tripEvents(db, trip, { ...options, share: true })
  const body = buildCalendar({ name: trip.name, tz: trip.tz, events, now: nowIso() })
  return calendarResponse(trip, body, { 'x-robots-tag': 'noindex' })
}
