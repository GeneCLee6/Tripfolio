// Request and response shapes of the lodgings, bookings and deadlines endpoints (e4-t01).
// Request bodies are the zod schemas in shared/schema/lodging.ts and shared/schema/booking.ts.

import type { BookingDetailsMap, BookingType } from '../schema/booking.ts'
import type { CampFacilities, CampType, PayStatus } from '../schema/lodging.ts'
import type { DaysResponse, DayWithStops, Rev } from './types.ts'

export interface Lodging {
  id: string
  tripId: string
  placeId: string | null
  name: string
  /** YYYY-MM-DD; the nights are [checkIn, checkOut) */
  checkIn: string
  checkOut: string
  /** HH:mm in the trip's zone */
  checkInTime: string | null
  checkOutTime: string | null
  roomType: string | null
  guests: number | null
  platform: string | null
  ref: string | null
  priceMinor: number | null
  currency: string | null
  payStatus: PayStatus
  /** UTC ISO */
  cancelBy: string | null
  phone: string | null
  campType: CampType | null
  campFacilities: CampFacilities | null
  note: string
  rev: number
  createdAt: string
  updatedAt: string
}

/** Which of a booking's auto-created stops a stop is */
export type BookingStopSlot = 'depart' | 'arrive' | 'pickup' | 'dropoff' | 'main' | `day:${string}`

/** A stop created from a booking (stops.bookingId = booking.id) */
export interface BookingStopRef {
  id: string
  dayId: string
  slot: BookingStopSlot | null
}

interface BookingBase {
  id: string
  tripId: string
  title: string
  /** UTC ISO */
  startAt: string | null
  endAt: string | null
  /**
   * The zones the times were entered in (a flight's two airports). startTz null = the trip's
   * zone; endTz null = same as start (so a flight should send both)
   */
  startTz: string | null
  endTz: string | null
  priceMinor: number | null
  currency: string | null
  payStatus: PayStatus
  payerMemberId: string | null
  cancelBy: string | null
  ref: string | null
  note: string
  rev: number
  createdAt: string
  updatedAt: string
  /** Its auto-created stops that still exist */
  stops: BookingStopRef[]
}

/** Discriminated by `type`; `details` is typed per type */
export type Booking = {
  [K in BookingType]: BookingBase & { type: K; details: BookingDetailsMap[K] }
}[BookingType]

/** Per day in GET /days: the night's lodging, else the one checked out of that morning */
export interface DayLodgingSummary {
  id: string
  name: string
  checkOutTime: string | null
  /** The day's date is the lodging's checkOut (only when no lodging follows that night) */
  isCheckoutDay: boolean
  isCheckinDay: boolean
  campType: CampType | null
}

/** Whoever checks out that morning, also on a day that moves to another lodging */
export interface DayCheckout {
  id: string
  name: string
  checkOutTime: string | null
}

export type DayWithLodging = DayWithStops & {
  lodging: DayLodgingSummary | null
  checkout: DayCheckout | null
}

/** GET /api/trips/:id/days with the E4 fields (the base shape is in types.ts) */
export type DaysWithLodgingResponse = Omit<DaysResponse, 'days'> & { days: DayWithLodging[] }

/** GET /api/trips/:id/lodgings: by checkIn */
export interface LodgingsResponse extends Rev {
  lodgings: Lodging[]
}

/** POST (201) / PATCH /api/trips/:id/lodgings/:lid */
export interface LodgingWriteResponse extends Rev {
  lodging: Lodging
  /** Days now linked to it (assigned days whose date is in [checkIn, checkOut)) */
  dayIds: string[]
  /** Of those, the days that pointed at another lodging before (overwritten) */
  conflicts: string[]
}

/** GET /api/trips/:id/bookings: by startAt (no time last) */
export interface BookingsResponse extends Rev {
  bookings: Booking[]
}

/** POST (201) / PATCH /api/trips/:id/bookings/:bid */
export interface BookingWriteResponse extends Rev {
  booking: Booking
  /** Local dates (trip zone) that would have had a stop but have no Day in the trip */
  skippedDates: string[]
}

/** DELETE /api/trips/:id/bookings/:bid[?keepStops=1] */
export interface BookingDeleteResponse extends Rev {
  ok: true
  /** Stops removed (or detached with keepStops=1) */
  stopIds: string[]
  keptStops: boolean
}

export type DeadlineKind = 'lodging' | 'booking'
export type DeadlineType = 'cancel' | 'payment' | 'checkin'

export interface Deadline {
  kind: DeadlineKind
  /** The lodging's or booking's id */
  id: string
  title: string
  /** UTC ISO */
  dueAt: string
  type: DeadlineType
  /** Set when kind = 'booking' */
  bookingType: BookingType | null
}

/** GET /api/trips/:id/deadlines?withinDays=14: due in [now, now + withinDays], soonest first */
export interface DeadlinesResponse {
  deadlines: Deadline[]
  withinDays: number
}
