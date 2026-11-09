import { beforeEach, describe, expect, it } from 'vitest'
import type {
  Booking,
  BookingDeleteResponse,
  BookingsResponse,
  BookingWriteResponse,
  DeadlinesResponse,
} from '../../shared/api/bookings.ts'
import type {
  CreateInviteResponse,
  CreateTripResponse,
  DaysResponse,
  MemberTokenResponse,
  Stop,
} from '../../shared/api/types.ts'
import { handleRequest } from '../../worker/app.ts'
import type { Env } from '../../worker/env.ts'
import { createFakeD1 } from './fake-d1.ts'

let env: Env

beforeEach(() => {
  env = { DB: createFakeD1().db, APP_VERSION: 'test' } as unknown as Env
})

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  { token, body }: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await handleRequest(
    new Request(`https://x.test${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  )
  expect(response.headers.get('cache-control')).toBe('no-store')
  return { status: response.status, body: (await response.json()) as T }
}

// NZ in December is NZDT, UTC+13; Sydney is AEDT, UTC+11
async function createTrip() {
  const res = await call<CreateTripResponse>('POST', '/api/trips', {
    body: {
      name: 'NZ',
      startDate: '2026-12-20',
      endDate: '2026-12-26',
      tz: 'Pacific/Auckland',
      style: 'campervan',
      owner: { name: 'Gene', color: 'teal' },
    },
  })
  expect(res.status).toBe(201)
  return res.body
}

let t: CreateTripResponse
const dayOf = (date: string) => t.days.find((d) => d.date === date)?.id

async function stopsOf(bookingId: string): Promise<Stop[]> {
  const days = await call<DaysResponse>('GET', `/api/trips/${t.trip.id}/days`, {
    token: t.memberToken,
  })
  return days.body.days.flatMap((d) => d.stops).filter((s) => s.bookingId === bookingId)
}

async function dayStops(date: string): Promise<Stop[]> {
  const days = await call<DaysResponse>('GET', `/api/trips/${t.trip.id}/days`, {
    token: t.memberToken,
  })
  return days.body.days.find((d) => d.date === date)?.stops ?? []
}

const book = (body: unknown) =>
  call<BookingWriteResponse>('POST', `/api/trips/${t.trip.id}/bookings`, {
    token: t.memberToken,
    body,
  })
const patch = (id: string, body: unknown) =>
  call<BookingWriteResponse>('PATCH', `/api/trips/${t.trip.id}/bookings/${id}`, {
    token: t.memberToken,
    body,
  })

const flight = {
  type: 'flight',
  title: 'NZ104 SYD → AKL',
  details: { airline: 'Air New Zealand', flightNo: 'NZ104', fromAirport: 'SYD', toAirport: 'AKL' },
}

beforeEach(async () => {
  t = await createTrip()
})

describe('bookings: validation and roles', () => {
  it('validates details per type (422)', async () => {
    const wrong = [
      { ...flight, details: { airline: 'X', fromAirport: 'SYD', toAirport: 'AKL' } },
      { type: 'ferry', title: 'Interislander', details: flight.details },
      { type: 'boat', title: 'X', details: {} },
      { type: 'driver', title: 'Bali driver', details: { driverName: 'Made', pickupTime: '9am' } },
      { ...flight, priceMinor: 100 },
      { ...flight, startAt: '2026-12-21T00:00:00Z', endAt: '2026-12-20T00:00:00Z' },
      {
        type: 'rental',
        title: 'Van',
        details: { company: 'X', vehicle: 'Y', pickupPlaceId: 'no' },
      },
    ]
    for (const body of wrong) expect((await book(body)).status).toBe(422)
    const ok = await book({ ...flight, startAt: '2026-12-20T01:00:00Z' })
    expect(ok.status).toBe(201)
    expect((await patch(ok.body.booking.id, { details: { flightNo: '' } })).status).toBe(422)
    expect((await patch(ok.body.booking.id, { type: 'bus' })).status).toBe(422)
    const merged = await patch(ok.body.booking.id, {
      details: { baggage: '23 kg', airline: 'ANZ' },
    })
    expect(merged.status).toBe(200)
    expect(merged.body.booking.details).toMatchObject({
      airline: 'ANZ',
      flightNo: 'NZ104',
      baggage: '23 kg',
    })
  })

  it('viewers can read but not write', async () => {
    const kid = await call<{ member: { id: string } }>('POST', `/api/trips/${t.trip.id}/members`, {
      token: t.memberToken,
      body: { name: 'Kid', color: 'amber', role: 'viewer' },
    })
    const invite = await call<CreateInviteResponse>('POST', `/api/trips/${t.trip.id}/invites`, {
      token: t.memberToken,
    })
    const joined = await call<MemberTokenResponse>('POST', `/api/join/${invite.body.inviteToken}`, {
      body: { memberId: kid.body.member.id },
    })
    const viewer = joined.body.memberToken
    const path = `/api/trips/${t.trip.id}/bookings`
    expect((await call('POST', path, { token: viewer, body: flight })).status).toBe(403)
    const ok = await book(flight)
    expect((await call('GET', path, { token: viewer })).status).toBe(200)
    expect((await call('GET', `/api/trips/${t.trip.id}/deadlines`, { token: viewer })).status).toBe(
      200,
    )
    const one = `${path}/${ok.body.booking.id}`
    expect((await call('PATCH', one, { token: viewer, body: { title: 'x' } })).status).toBe(403)
    expect((await call('DELETE', one, { token: viewer })).status).toBe(403)
  })
})

describe('bookings: auto-stops', () => {
  it('an overnight flight gets a stop on the departure and on the arrival day', async () => {
    // 21:30 Sydney = 10:30Z = 23:30 NZ on the 20th; lands 03:00 NZ on the 21st
    const res = await book({
      ...flight,
      startLocal: '2026-12-20T21:30',
      startTz: 'Australia/Sydney',
      endLocal: '2026-12-21T03:00',
      endTz: 'Pacific/Auckland',
      priceMinor: 54000,
      currency: 'AUD',
    })
    expect(res.status).toBe(201)
    expect(res.body.booking).toMatchObject({
      type: 'flight',
      startAt: '2026-12-20T10:30:00.000Z',
      endAt: '2026-12-20T14:00:00.000Z',
      startTz: 'Australia/Sydney',
      endTz: 'Pacific/Auckland',
    })
    expect(res.body.booking.stops.map((s) => [s.slot, s.dayId])).toEqual([
      ['depart', dayOf('2026-12-20')],
      ['arrive', dayOf('2026-12-21')],
    ])
    const stops = await stopsOf(res.body.booking.id)
    expect(stops.every((s) => s.type === 'transport' && s.booking === 'booked')).toBe(true)
    expect(stops.every((s) => s.title === 'NZ104 SYD → AKL')).toBe(true)

    // Same-day arrival: the arrival stop goes, the departure stop carries endAt
    const same = await patch(res.body.booking.id, { endLocal: '2026-12-20T23:55' })
    expect(same.body.booking.stops.map((s) => s.slot)).toEqual(['depart'])
    const [dep] = await stopsOf(res.body.booking.id)
    expect(dep.endAt).toBe('2026-12-20T10:55:00.000Z')
  })

  it('a driver booking gets one pickup stop per day, titled by the driver', async () => {
    const res = await book({
      type: 'driver',
      title: 'Charter',
      startLocal: '2026-12-22T08:00',
      endLocal: '2026-12-24T18:00',
      details: { driverName: 'Made', pickupTime: '09:00', includes: ['fuel', 'parking'] },
    })
    expect(res.status).toBe(201)
    const stops = await stopsOf(res.body.booking.id)
    expect(stops.map((s) => [s.dayId, s.startAt, s.title])).toEqual([
      [dayOf('2026-12-22'), '2026-12-21T20:00:00.000Z', 'Made'],
      [dayOf('2026-12-23'), '2026-12-22T20:00:00.000Z', 'Made'],
      [dayOf('2026-12-24'), '2026-12-23T20:00:00.000Z', 'Made'],
    ])
    // The user deletes one daily stop: the booking stays, the stop is not brought back
    const first = stops[0]
    expect(
      (await call('DELETE', `/api/trips/${t.trip.id}/stops/${first.id}`, { token: t.memberToken }))
        .status,
    ).toBe(200)
    // Shorter range and a renamed driver
    const upd = await patch(res.body.booking.id, {
      endLocal: '2026-12-23T18:00',
      details: { driverName: 'Komang' },
    })
    expect(upd.status).toBe(200)
    const after = await stopsOf(res.body.booking.id)
    expect(after.map((s) => [s.dayId, s.title])).toEqual([[dayOf('2026-12-23'), 'Komang']])
    // A longer range adds the new day
    await patch(res.body.booking.id, { endLocal: '2026-12-25T18:00' })
    expect((await stopsOf(res.body.booking.id)).map((s) => s.dayId)).toEqual([
      dayOf('2026-12-23'),
      dayOf('2026-12-24'),
      dayOf('2026-12-25'),
    ])
  })

  it('a rental gets pickup and dropoff stops, placed by time; updates propagate', async () => {
    const place = await call<{ place: { id: string } }>('POST', `/api/trips/${t.trip.id}/places`, {
      token: t.memberToken,
      body: { nameLocal: 'Christchurch Airport', lat: -43.49, lng: 172.53 },
    })
    const placeId = place.body.place.id
    for (const [title, at] of [
      ['Breakfast', '2026-12-19T19:00:00.000Z'],
      ['Lunch', '2026-12-19T23:00:00.000Z'],
    ])
      await call('POST', `/api/trips/${t.trip.id}/stops`, {
        token: t.memberToken,
        body: { dayId: dayOf('2026-12-20'), title, startAt: at },
      })
    const res = await book({
      type: 'rental',
      title: 'Campervan',
      startLocal: '2026-12-20T10:00',
      endLocal: '2026-12-25T15:00',
      details: {
        company: 'Britz',
        vehicle: 'Venturer',
        pickupPlaceId: placeId,
        selfContained: true,
      },
    })
    expect(res.status).toBe(201)
    expect(res.body.booking.stops.map((s) => [s.slot, s.dayId])).toEqual([
      ['pickup', dayOf('2026-12-20')],
      ['dropoff', dayOf('2026-12-25')],
    ])
    expect((await dayStops('2026-12-20')).map((s) => s.title)).toEqual([
      'Breakfast',
      'Campervan',
      'Lunch',
    ])
    const pickup = (await stopsOf(res.body.booking.id))[0]
    expect(pickup.placeId).toBe(placeId)

    // Rename and move the dropoff a day later
    const upd = await patch(res.body.booking.id, {
      title: 'Britz van',
      endLocal: '2026-12-26T09:00',
    })
    expect(upd.status).toBe(200)
    const stops = await stopsOf(res.body.booking.id)
    expect(stops.map((s) => [s.title, s.dayId, s.startAt])).toEqual([
      ['Britz van', dayOf('2026-12-20'), '2026-12-19T21:00:00.000Z'],
      ['Britz van', dayOf('2026-12-26'), '2026-12-25T20:00:00.000Z'],
    ])
    // Pickup kept its place in the day (order not touched)
    expect((await dayStops('2026-12-20')).map((s) => s.title)).toEqual([
      'Breakfast',
      'Britz van',
      'Lunch',
    ])
  })

  it('ferry, rail, bus and activity get one stop; dates outside the trip are reported', async () => {
    const ferry = await book({
      type: 'ferry',
      title: 'Interislander',
      startLocal: '2026-12-21T09:00',
      endLocal: '2026-12-21T12:30',
      details: {
        operator: 'Interislander',
        fromText: 'Wellington',
        toText: 'Picton',
        vehicleLength: '7.5 m',
      },
    })
    expect(ferry.body.booking.stops).toHaveLength(1)
    const act = await book({
      type: 'activity',
      title: 'Milford cruise',
      startLocal: '2026-12-23T10:00',
      details: { checkInMinutesBefore: 30, weatherPolicy: 'Full refund if cancelled' },
    })
    const [stop] = await stopsOf(act.body.booking.id)
    expect(stop).toMatchObject({ type: 'other', booking: 'booked', title: 'Milford cruise' })
    const outside = await book({
      type: 'bus',
      title: 'Airport bus',
      startLocal: '2026-12-28T09:00',
      details: { fromText: 'A', toText: 'B' },
    })
    expect(outside.status).toBe(201)
    expect(outside.body.booking.stops).toEqual([])
    expect(outside.body.skippedDates).toEqual(['2026-12-28'])
    const undated = await book({ ...flight })
    expect(undated.body.booking.stops).toEqual([])
    const list = await call<BookingsResponse>('GET', `/api/trips/${t.trip.id}/bookings`, {
      token: t.memberToken,
    })
    expect(list.body.bookings.map((b: Booking) => b.title)).toEqual([
      'Interislander',
      'Milford cruise',
      'Airport bus',
      'NZ104 SYD → AKL',
    ])
  })

  it('delete removes its stops; keepStops=1 detaches them', async () => {
    const a = await book({ ...flight, startLocal: '2026-12-20T12:00' })
    const b = await book({ ...flight, title: 'Back', startLocal: '2026-12-26T12:00' })
    const aStops = await stopsOf(a.body.booking.id)
    const delA = await call<BookingDeleteResponse>(
      'DELETE',
      `/api/trips/${t.trip.id}/bookings/${a.body.booking.id}`,
      { token: t.memberToken },
    )
    expect(delA.body).toMatchObject({ ok: true, keptStops: false, stopIds: [aStops[0].id] })
    expect(await dayStops('2026-12-20')).toEqual([])
    const delB = await call<BookingDeleteResponse>(
      'DELETE',
      `/api/trips/${t.trip.id}/bookings/${b.body.booking.id}?keepStops=1`,
      { token: t.memberToken },
    )
    expect(delB.body.keptStops).toBe(true)
    const kept = await dayStops('2026-12-26')
    expect(kept.map((s) => [s.title, s.bookingId])).toEqual([['Back', null]])
    const list = await call<BookingsResponse>('GET', `/api/trips/${t.trip.id}/bookings`, {
      token: t.memberToken,
    })
    expect(list.body.bookings).toEqual([])
    expect(
      (
        await call('DELETE', `/api/trips/${t.trip.id}/bookings/${a.body.booking.id}`, {
          token: t.memberToken,
        })
      ).status,
    ).toBe(404)
  })

  it('every write bumps the trip rev', async () => {
    const a = await book({ ...flight, startLocal: '2026-12-20T12:00' })
    expect(a.body.rev).toBe(2)
    const p = await patch(a.body.booking.id, { note: 'window seat' })
    expect(p.body.rev).toBe(3)
  })
})

describe('deadlines', () => {
  it('merges lodgings and bookings within the window, soonest first', async () => {
    const now = Date.now()
    const iso = (days: number) => new Date(now + days * 86_400_000).toISOString()
    const date = (days: number) => iso(days).slice(0, 10)
    const lodging = await call<{ lodging: { id: string } }>(
      'POST',
      `/api/trips/${t.trip.id}/lodgings`,
      {
        token: t.memberToken,
        body: {
          name: 'Hotel',
          checkIn: date(6),
          checkOut: date(8),
          checkInTime: '15:00',
          cancelBy: iso(2),
          payStatus: 'deposit',
        },
      },
    )
    const paid = await book({ ...flight, cancelBy: iso(1), payStatus: 'paid' })
    const later = await book({ ...flight, title: 'Later', cancelBy: iso(20) })
    await book({ ...flight, title: 'Past', cancelBy: iso(-1) })
    const res = await call<DeadlinesResponse>('GET', `/api/trips/${t.trip.id}/deadlines`, {
      token: t.memberToken,
    })
    expect(res.status).toBe(200)
    expect(res.body.withinDays).toBe(14)
    expect(res.body.deadlines.map((d) => [d.kind, d.id, d.type])).toEqual([
      ['booking', paid.body.booking.id, 'cancel'],
      ['lodging', lodging.body.lodging.id, 'payment'],
      ['lodging', lodging.body.lodging.id, 'cancel'],
      ['lodging', lodging.body.lodging.id, 'checkin'],
    ])
    const wide = await call<DeadlinesResponse>(
      'GET',
      `/api/trips/${t.trip.id}/deadlines?withinDays=30`,
      { token: t.memberToken },
    )
    expect(
      wide.body.deadlines.filter((d) => d.id === later.body.booking.id).map((d) => d.type),
    ).toEqual(['payment', 'cancel'])
    expect(
      (
        await call('GET', `/api/trips/${t.trip.id}/deadlines?withinDays=x`, {
          token: t.memberToken,
        })
      ).status,
    ).toBe(422)
  })
})
