import type { Booking, Lodging } from '../../../shared/api/bookings.ts'
import type { BookingPatch, BookingType } from '../../../shared/schema/booking.ts'
import type { CampType, LodgingPatch, PayStatus } from '../../../shared/schema/lodging.ts'
import { utcToZoned, zonedTimeToUtc, type ZonedTime } from '../../../shared/time/tz.ts'
import type { BookingCreateBody, LodgingCreateBody } from './api.ts'

// Pure helpers behind the lodging and booking forms (e4-t02, e4-t03): local wall-clock ↔ UTC in a
// given IANA zone (a flight's two airports each have their own), form state ↔ request bodies per
// booking type, and the relative label of a deadline. No React, no zod (the sheets validate the
// body with the shared schema).

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** `date` + `HH:mm` read in `tz` as a UTC ISO string (…Z); null when either is empty or malformed */
export function localToUtc(date: string, time: string, tz: string): string | null {
  if (!DATE.test(date) || !HM.test(time)) return null
  return new Date(zonedTimeToUtc(`${date}T${time}`, tz)).toISOString().replace('.000Z', 'Z')
}

/** The local date and time of a stored instant in `tz` ('' / '' for none) */
export function utcToLocal(iso: string | null, tz: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return { date: '', time: '' }
  const zoned = utcToZoned(ms, tz)
  return { date: zoned.date, time: zoned.time }
}

/** `YYYY-MM-DDTHH:mm` for the API's *Local fields; null without a date. No time = end of day */
export function localDateTime(date: string, time: string, fallbackTime = '23:59'): string | null {
  if (!DATE.test(date)) return null
  return `${date}T${HM.test(time) ? time : fallbackTime}`
}

/** Whole days between two YYYY-MM-DD dates (b − a) */
export function daysBetween(a: string, b: string): number {
  const parse = (d: string) => {
    const [y, m, day] = d.split('-').map(Number) as [number, number, number]
    return Date.UTC(y, m - 1, day)
  }
  return Math.round((parse(b) - parse(a)) / 86_400_000)
}

export interface DualTimes {
  start: ZonedTime
  end: ZonedTime | null
  /** The arrival's local date minus the departure's local date (+1 for an overnight flight) */
  dayShift: number
}

/**
 * A booking's start and end, each in its own zone (a flight: departure airport → arrival airport);
 * null without a start. `startTz` / `endTz` null fall back like the Worker: start → trip zone,
 * end → the start's zone.
 */
export function dualTimes(
  booking: Pick<Booking, 'startAt' | 'endAt' | 'startTz' | 'endTz'>,
  tripTz: string,
): DualTimes | null {
  if (!booking.startAt) return null
  const startTz = booking.startTz ?? tripTz
  const endTz = booking.endTz ?? startTz
  const start = utcToZoned(Date.parse(booking.startAt), startTz)
  const end = booking.endAt ? utcToZoned(Date.parse(booking.endAt), endTz) : null
  return { start, end, dayShift: end ? daysBetween(start.date, end.date) : 0 }
}

// ---- lodging ----

export interface LodgingForm {
  name: string
  placeId: string | null
  checkIn: string
  checkOut: string
  checkInTime: string
  checkOutTime: string
  roomType: string
  guests: string
  platform: string
  ref: string
  priceMinor: number | null
  currency: string
  payStatus: PayStatus
  cancelDate: string
  cancelTime: string
  phone: string
  campType: CampType | ''
  power: boolean
  water: boolean
  dump: boolean
  note: string
}

/** A new lodging for the night of `date` (one night; check-out the next morning) */
export function emptyLodgingForm(date: string, currency: string): LodgingForm {
  return {
    name: '',
    placeId: null,
    checkIn: date,
    checkOut: date ? addDays(date, 1) : '',
    checkInTime: '',
    checkOutTime: '',
    roomType: '',
    guests: '',
    platform: '',
    ref: '',
    priceMinor: null,
    currency,
    payStatus: 'unpaid',
    cancelDate: '',
    cancelTime: '',
    phone: '',
    campType: '',
    power: false,
    water: false,
    dump: false,
    note: '',
  }
}

export function lodgingToForm(lodging: Lodging, tripTz: string, fallbackCurrency: string): LodgingForm {
  const cancel = utcToLocal(lodging.cancelBy, tripTz)
  return {
    name: lodging.name,
    placeId: lodging.placeId,
    checkIn: lodging.checkIn,
    checkOut: lodging.checkOut,
    checkInTime: lodging.checkInTime ?? '',
    checkOutTime: lodging.checkOutTime ?? '',
    roomType: lodging.roomType ?? '',
    guests: lodging.guests === null ? '' : String(lodging.guests),
    platform: lodging.platform ?? '',
    ref: lodging.ref ?? '',
    priceMinor: lodging.priceMinor,
    currency: lodging.currency ?? fallbackCurrency,
    payStatus: lodging.payStatus,
    cancelDate: cancel.date,
    cancelTime: cancel.time,
    phone: lodging.phone ?? '',
    campType: lodging.campType ?? '',
    power: lodging.campFacilities?.power ?? false,
    water: lodging.campFacilities?.water ?? false,
    dump: lodging.campFacilities?.dump ?? false,
    note: lodging.note,
  }
}

const orNull = (value: string): string | null => (value.trim() ? value.trim() : null)

/**
 * The lodging body (create, or the full PATCH when editing). `campervan` adds the site type and
 * facilities; the cancel-by is sent as local time in the trip's zone (`cancelByLocal`).
 */
export function lodgingBody(form: LodgingForm, campervan: boolean): LodgingCreateBody {
  const guests = Number.parseInt(form.guests, 10)
  const cancelByLocal = localDateTime(form.cancelDate, form.cancelTime)
  return {
    name: form.name.trim(),
    placeId: form.placeId,
    checkIn: form.checkIn,
    checkOut: form.checkOut,
    checkInTime: HM.test(form.checkInTime) ? form.checkInTime : null,
    checkOutTime: HM.test(form.checkOutTime) ? form.checkOutTime : null,
    roomType: orNull(form.roomType),
    guests: Number.isFinite(guests) && guests > 0 ? guests : null,
    platform: orNull(form.platform),
    ref: orNull(form.ref),
    priceMinor: form.priceMinor,
    currency: form.priceMinor === null ? null : form.currency,
    payStatus: form.payStatus,
    ...(cancelByLocal ? { cancelByLocal } : { cancelBy: null }),
    phone: orNull(form.phone),
    campType: campervan && form.campType ? form.campType : null,
    campFacilities:
      campervan && (form.campType || form.power || form.water || form.dump)
        ? { power: form.power, water: form.water, dump: form.dump }
        : null,
    note: form.note.trim(),
  }
}

/** The same body as a PATCH (every field is sent; the Worker re-links the nights) */
export function lodgingPatch(form: LodgingForm, campervan: boolean): LodgingPatch {
  return lodgingBody(form, campervan) as LodgingPatch
}

/** Adds whole days to a YYYY-MM-DD date */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

// ---- bookings ----

/** Which fields each type shows (beyond the common ones) */
export const BOOKING_TEXT_FIELDS = {
  flight: ['airline', 'flightNo', 'fromAirport', 'fromTerminal', 'toAirport', 'toTerminal', 'baggage'],
  rental: ['company', 'vehicle', 'pickupText', 'dropoffText', 'insurance', 'mileageLimit'],
  driver: ['driverName', 'phone', 'messenger', 'vehicle', 'pickupText'],
  ferry: ['operator', 'fromText', 'toText', 'vehicleLength'],
  rail: ['operator', 'fromText', 'toText'],
  bus: ['operator', 'fromText', 'toText'],
  activity: ['operator', 'meetingText', 'weatherPolicy'],
} as const satisfies Record<BookingType, readonly string[]>

export type BookingTextField = (typeof BOOKING_TEXT_FIELDS)[BookingType][number]

/** Required text fields per type (mirrors shared/schema/booking.ts) */
export const BOOKING_REQUIRED: Record<BookingType, readonly BookingTextField[]> = {
  flight: ['airline', 'flightNo', 'fromAirport', 'toAirport'],
  rental: ['company', 'vehicle'],
  driver: ['driverName'],
  ferry: ['fromText', 'toText'],
  rail: ['fromText', 'toText'],
  bus: ['fromText', 'toText'],
  activity: [],
}

/** What a driver's daily rate can include */
export const DRIVER_INCLUDES = ['fuel', 'parking', 'tolls', 'meals'] as const

export interface BookingForm {
  type: BookingType
  title: string
  startDate: string
  startTime: string
  /** Departure zone (flights); other types use the trip's zone */
  startTz: string
  endDate: string
  endTime: string
  endTz: string
  priceMinor: number | null
  currency: string
  payStatus: PayStatus
  /** '' = nobody yet */
  payerMemberId: string
  cancelDate: string
  cancelTime: string
  ref: string
  note: string
  text: Partial<Record<BookingTextField, string>>
  pickupPlaceId: string | null
  dropoffPlaceId: string | null
  meetingPlaceId: string | null
  excessMinor: number | null
  depositMinor: number | null
  dailyRateMinor: number | null
  selfContained: boolean
  includes: string[]
  /** Driver: the daily pickup time (HH:mm) */
  pickupTime: string
  /** Activity: minutes before the start to check in ('' = none) */
  checkInMinutes: string
}

export function emptyBookingForm(
  type: BookingType,
  tripTz: string,
  currency: string,
  date = '',
): BookingForm {
  return {
    type,
    title: '',
    startDate: date,
    startTime: '',
    startTz: tripTz,
    endDate: '',
    endTime: '',
    endTz: tripTz,
    priceMinor: null,
    currency,
    payStatus: 'unpaid',
    payerMemberId: '',
    cancelDate: '',
    cancelTime: '',
    ref: '',
    note: '',
    text: {},
    pickupPlaceId: null,
    dropoffPlaceId: null,
    meetingPlaceId: null,
    excessMinor: null,
    depositMinor: null,
    dailyRateMinor: null,
    selfContained: false,
    includes: [],
    pickupTime: '',
    checkInMinutes: '',
  }
}

const textOf = (form: BookingForm, key: BookingTextField): string => (form.text[key] ?? '').trim()

/** The title used when the form's title is left empty */
export function suggestedTitle(form: BookingForm): string {
  const s = (key: BookingTextField) => textOf(form, key)
  const join = (...parts: string[]) => parts.filter(Boolean).join(' ')
  switch (form.type) {
    case 'flight': {
      const route = s('fromAirport') && s('toAirport') ? `${s('fromAirport')}→${s('toAirport')}` : ''
      return join(s('flightNo') || s('airline'), route)
    }
    case 'rental':
      return join(s('company'), s('vehicle'))
    case 'driver':
      return s('driverName')
    case 'ferry':
    case 'rail':
    case 'bus':
      return s('fromText') && s('toText')
        ? join(s('operator'), `${s('fromText')}→${s('toText')}`)
        : s('operator')
    case 'activity':
      return s('operator')
  }
}

/** The type's `details` from the form: trimmed text, empty optional fields left out */
export function bookingDetails(form: BookingForm): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of BOOKING_TEXT_FIELDS[form.type] as readonly BookingTextField[]) {
    const value = textOf(form, key)
    if (value || BOOKING_REQUIRED[form.type].includes(key)) out[key] = value
  }
  switch (form.type) {
    case 'rental':
      if (form.pickupPlaceId) out.pickupPlaceId = form.pickupPlaceId
      if (form.dropoffPlaceId) out.dropoffPlaceId = form.dropoffPlaceId
      if (form.excessMinor !== null) out.excessMinor = form.excessMinor
      if (form.depositMinor !== null) out.depositMinor = form.depositMinor
      if (form.selfContained) out.selfContained = true
      break
    case 'driver':
      if (form.dailyRateMinor !== null) out.dailyRateMinor = form.dailyRateMinor
      if (form.includes.length > 0) out.includes = [...form.includes]
      if (HM.test(form.pickupTime)) out.pickupTime = form.pickupTime
      break
    case 'activity': {
      if (form.meetingPlaceId) out.meetingPlaceId = form.meetingPlaceId
      const minutes = Number.parseInt(form.checkInMinutes, 10)
      if (Number.isFinite(minutes) && minutes >= 0) out.checkInMinutesBefore = minutes
      break
    }
    default:
      break
  }
  return out
}

/**
 * The booking's instants. Flights read each end in its own airport's zone; every other type in the
 * trip's zone. A driver runs from the start date to the end date at the daily pickup time. An end
 * time without an end date is on the start date (the next day when it is not after the start; same
 * zone only).
 */
export function bookingInstants(
  form: BookingForm,
  tripTz: string,
): { startAt: string | null; endAt: string | null; startTz: string | null; endTz: string | null } {
  const flight = form.type === 'flight'
  const startTz = flight ? form.startTz || tripTz : tripTz
  const endTz = flight ? form.endTz || startTz : startTz
  const time =
    form.type === 'driver'
      ? form.pickupTime || form.startTime || '00:00'
      : form.startTime || '00:00'
  const startAt = localToUtc(form.startDate, time, startTz)
  let endAt: string | null = null
  if (form.type === 'driver') {
    endAt = form.endDate ? localToUtc(form.endDate, time, endTz) : null
  } else if (form.endDate || form.endTime) {
    let endDate = form.endDate || form.startDate
    if (!form.endDate && startTz === endTz && form.startTime && form.endTime <= form.startTime) {
      endDate = form.startDate ? addDays(form.startDate, 1) : ''
    }
    endAt = localToUtc(endDate, form.endTime || '00:00', endTz)
  }
  return { startAt, endAt, startTz: flight ? startTz : null, endTz: flight ? endTz : null }
}

/** The POST body (validate it with bookingCreateSchema before sending) */
export function bookingBody(form: BookingForm, tripTz: string): BookingCreateBody {
  const cancelByLocal = localDateTime(form.cancelDate, form.cancelTime)
  return {
    type: form.type,
    title: form.title.trim() || suggestedTitle(form),
    details: bookingDetails(form),
    ...bookingInstants(form, tripTz),
    priceMinor: form.priceMinor,
    currency: form.priceMinor === null ? null : form.currency,
    payStatus: form.payStatus,
    payerMemberId: form.payerMemberId || null,
    ...(cancelByLocal ? { cancelByLocal } : { cancelBy: null }),
    ref: orNull(form.ref),
    note: form.note.trim(),
  } as BookingCreateBody
}

/**
 * The PATCH for an edited booking: everything from the form, with every key the stored details had
 * and the form no longer does set to null (the Worker merges `details` over the stored ones).
 */
export function bookingPatch(booking: Booking, form: BookingForm, tripTz: string): BookingPatch {
  const body = bookingBody(form, tripTz) as Record<string, unknown>
  const { type: _type, details, ...rest } = body
  const merged: Record<string, unknown> = { ...(details as Record<string, unknown>) }
  for (const key of Object.keys(booking.details)) if (!(key in merged)) merged[key] = null
  return { ...rest, details: merged } as BookingPatch
}

/** A stored booking back into the form */
export function bookingToForm(
  booking: Booking,
  tripTz: string,
  fallbackCurrency: string,
): BookingForm {
  const startTz = booking.startTz ?? tripTz
  const endTz = booking.endTz ?? startTz
  const start = utcToLocal(booking.startAt, startTz)
  const end = utcToLocal(booking.endAt, endTz)
  const cancel = utcToLocal(booking.cancelBy, tripTz)
  const details = booking.details as Record<string, unknown>
  const text: Partial<Record<BookingTextField, string>> = {}
  for (const key of BOOKING_TEXT_FIELDS[booking.type] as readonly BookingTextField[]) {
    const value = details[key]
    if (typeof value === 'string') text[key] = value
  }
  const str = (key: string) => (typeof details[key] === 'string' ? (details[key] as string) : null)
  const num = (key: string) => (typeof details[key] === 'number' ? (details[key] as number) : null)
  const checkIn = num('checkInMinutesBefore')
  return {
    ...emptyBookingForm(booking.type, tripTz, booking.currency ?? fallbackCurrency),
    title: booking.title,
    startDate: start.date,
    startTime: start.time,
    startTz,
    endDate: end.date,
    endTime: end.time,
    endTz,
    priceMinor: booking.priceMinor,
    payStatus: booking.payStatus,
    payerMemberId: booking.payerMemberId ?? '',
    cancelDate: cancel.date,
    cancelTime: cancel.time,
    ref: booking.ref ?? '',
    note: booking.note,
    text,
    pickupPlaceId: str('pickupPlaceId'),
    dropoffPlaceId: str('dropoffPlaceId'),
    meetingPlaceId: str('meetingPlaceId'),
    excessMinor: num('excessMinor'),
    depositMinor: num('depositMinor'),
    dailyRateMinor: num('dailyRateMinor'),
    selfContained: details.selfContained === true,
    includes: Array.isArray(details.includes) ? (details.includes as string[]) : [],
    pickupTime: str('pickupTime') ?? (booking.type === 'driver' ? start.time : ''),
    checkInMinutes: checkIn === null ? '' : String(checkIn),
  }
}

/** The bookings page's three groups */
export type BookingGroup = 'lodging' | 'transport' | 'activity'
export const groupOf = (type: BookingType): BookingGroup =>
  type === 'activity' ? 'activity' : 'transport'

// ---- deadlines ----

export interface RelativeDue {
  past: boolean
  /** Ahead: "3 天後" / "in 3 days"; past: the amount alone ("2 天" / "2 days") */
  text: string
}

/**
 * How far a deadline is from now, through Intl: minutes under an hour, hours under a day, else
 * whole days (rounded). A past one gives the bare amount for 「已過 {amount}」.
 */
export function relativeDue(dueMs: number, nowMs: number, locale: string): RelativeDue {
  const diff = dueMs - nowMs
  const past = diff < 0
  const abs = Math.abs(diff)
  let unit: 'minute' | 'hour' | 'day'
  let value: number
  if (abs < 3_600_000) {
    unit = 'minute'
    value = Math.max(1, Math.round(abs / 60_000))
  } else if (abs < 86_400_000) {
    unit = 'hour'
    value = Math.round(abs / 3_600_000)
  } else {
    unit = 'day'
    value = Math.round(abs / 86_400_000)
  }
  if (past) {
    return {
      past,
      text: new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(value),
    }
  }
  return {
    past,
    text: new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(value, unit),
  }
}
