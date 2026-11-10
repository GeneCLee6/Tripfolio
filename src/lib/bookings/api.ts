import type {
  BookingDeleteResponse,
  BookingsResponse,
  BookingWriteResponse,
  DaysWithLodgingResponse,
  DeadlinesResponse,
  LodgingsResponse,
  LodgingWriteResponse,
} from '../../../shared/api/bookings.ts'
import type { Rev } from '../../../shared/api/types.ts'
import type { BookingPatch, bookingCreateSchema } from '../../../shared/schema/booking.ts'
import type { LodgingCreate, LodgingPatch } from '../../../shared/schema/lodging.ts'
import type { z } from 'zod'
import { ApiError, request } from '../api.ts'
import { getToken } from '../tokens.ts'

// The typed client for lodgings, bookings and deadlines (worker/trips/lodging.ts and bookings.ts,
// e4-t01). Kept apart from src/lib/api.ts like the balances client; only types come from
// shared/schema, so importing this file never pulls zod into a chunk.

function tokenFor(tripId: string): string {
  const token = getToken(tripId)
  if (!token) throw new ApiError(401, 'unauthorized', 'no member token on this device')
  return token
}

const tripPath = (tripId: string) => `/api/trips/${encodeURIComponent(tripId)}`
const id = (value: string) => encodeURIComponent(value)

/** The lodging create body: the schema's input, so the defaults stay optional */
export type LodgingCreateBody = Partial<LodgingCreate> &
  Pick<LodgingCreate, 'name' | 'checkIn' | 'checkOut'>

/** The booking create body (the zod input: defaults optional, details per type) */
export type BookingCreateBody = z.input<typeof bookingCreateSchema>

export interface DeadlineQuery {
  withinDays?: number
  includePast?: boolean
}

export const bookingsApi = {
  /** GET /days with each day's `lodging` and `checkout` */
  listDays(tripId: string, signal?: AbortSignal): Promise<DaysWithLodgingResponse> {
    return request('GET', `${tripPath(tripId)}/days`, { token: tokenFor(tripId), signal })
  },

  listLodgings(tripId: string, signal?: AbortSignal): Promise<LodgingsResponse> {
    return request('GET', `${tripPath(tripId)}/lodgings`, { token: tokenFor(tripId), signal })
  },

  createLodging(tripId: string, body: LodgingCreateBody): Promise<LodgingWriteResponse> {
    return request('POST', `${tripPath(tripId)}/lodgings`, { token: tokenFor(tripId), body })
  },

  patchLodging(tripId: string, lodgingId: string, patch: LodgingPatch): Promise<LodgingWriteResponse> {
    return request('PATCH', `${tripPath(tripId)}/lodgings/${id(lodgingId)}`, {
      token: tokenFor(tripId),
      body: patch,
    })
  },

  deleteLodging(tripId: string, lodgingId: string): Promise<Rev & { ok: true }> {
    return request('DELETE', `${tripPath(tripId)}/lodgings/${id(lodgingId)}`, {
      token: tokenFor(tripId),
    })
  },

  listBookings(tripId: string, signal?: AbortSignal): Promise<BookingsResponse> {
    return request('GET', `${tripPath(tripId)}/bookings`, { token: tokenFor(tripId), signal })
  },

  createBooking(tripId: string, body: BookingCreateBody): Promise<BookingWriteResponse> {
    return request('POST', `${tripPath(tripId)}/bookings`, { token: tokenFor(tripId), body })
  },

  patchBooking(tripId: string, bookingId: string, patch: BookingPatch): Promise<BookingWriteResponse> {
    return request('PATCH', `${tripPath(tripId)}/bookings/${id(bookingId)}`, {
      token: tokenFor(tripId),
      body: patch,
    })
  },

  /** keepStops: leave the auto-created stops in the itinerary, unlinked */
  deleteBooking(tripId: string, bookingId: string, keepStops = false): Promise<BookingDeleteResponse> {
    const query = keepStops ? '?keepStops=1' : ''
    return request('DELETE', `${tripPath(tripId)}/bookings/${id(bookingId)}${query}`, {
      token: tokenFor(tripId),
    })
  },

  deadlines(
    tripId: string,
    { withinDays = 14, includePast = false }: DeadlineQuery = {},
    signal?: AbortSignal,
  ): Promise<DeadlinesResponse> {
    const params = new URLSearchParams({ withinDays: String(withinDays) })
    if (includePast) params.set('includePast', '1')
    return request('GET', `${tripPath(tripId)}/deadlines?${params}`, {
      token: tokenFor(tripId),
      signal,
    })
  },
}
