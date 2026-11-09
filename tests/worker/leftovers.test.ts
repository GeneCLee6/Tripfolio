// The backend leftovers sweep: trip list counts, cover photo check, lodging re-link on date
// changes, place externalId / refs / delete / merge over lodgings, bookings and attachments,
// Stop.source / bookingSlot, the 'cycle' leg mode, and past-due deadlines.
import { beforeEach, describe, expect, it } from 'vitest'
import type { BookingWriteResponse, DeadlinesResponse } from '../../shared/api/bookings.ts'
import type {
  CreateTripResponse,
  DaysResponse,
  Place,
  PlaceRefsResponse,
  TripListResponse,
} from '../../shared/api/types.ts'
import { handleRequest } from '../../worker/app.ts'
import type { Env } from '../../worker/env.ts'
import { createFakeD1 } from './fake-d1.ts'

let env: Env
let sqlite: ReturnType<typeof createFakeD1>['sqlite']

beforeEach(() => {
  const d1 = createFakeD1()
  sqlite = d1.sqlite
  env = { DB: d1.db, APP_VERSION: 'test' } as unknown as Env
})

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  {
    token,
    body,
    headers = {},
  }: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: T }> {
  const all: Record<string, string> = { ...headers }
  if (token) all.authorization = `Bearer ${token}`
  if (body !== undefined) all['content-type'] = 'application/json'
  const response = await handleRequest(
    new Request(`https://x.test${path}`, {
      method,
      headers: all,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  )
  return { status: response.status, body: (await response.json()) as T }
}

async function createTrip(startDate = '2026-12-20', endDate = '2026-12-24') {
  const res = await call<CreateTripResponse>('POST', '/api/trips', {
    body: {
      name: 'NZ',
      startDate,
      endDate,
      tz: 'Pacific/Auckland',
      owner: { name: 'Gene', color: 'teal' },
    },
  })
  expect(res.status).toBe(201)
  return { t: res.body, base: `/api/trips/${res.body.trip.id}`, token: res.body.memberToken }
}

function addAttachment(
  tripId: string,
  memberId: string,
  id: string,
  { kind = 'photo', status = 'ready', deleted = false } = {},
) {
  sqlite.exec(`INSERT INTO attachments (id, tripId, kind, r2Key, mime, bytes, uploaderMemberId, status, createdAt, updatedAt, deletedAt)
    VALUES ('${id}', '${tripId}', '${kind}', 'k/${id}', 'image/webp', 1, '${memberId}', '${status}', 'x', 'x', ${deleted ? "'x'" : 'NULL'})`)
}

describe('trips', () => {
  it('lists memberCount and dayCount', async () => {
    const a = await createTrip('2026-12-20', '2026-12-24')
    await call('POST', `${a.base}/members`, {
      token: a.token,
      body: { name: 'Kid', color: 'amber', role: 'viewer' },
    })
    const b = await createTrip('2027-01-01', '2027-01-02')
    const list = await call<TripListResponse>('GET', '/api/trips', {
      headers: { 'x-member-tokens': `${a.token},nope,${b.token}` },
    })
    expect(list.body.trips.map((x) => [x.tokenIndex, x.memberCount, x.dayCount])).toEqual([
      [0, 2, 5],
      [2, 1, 2],
    ])
  })

  it('accepts only a ready, not deleted photo of the same trip as cover', async () => {
    const { t, base, token } = await createTrip()
    const other = await createTrip()
    const me = t.member.id
    addAttachment(t.trip.id, me, 'ok')
    addAttachment(t.trip.id, me, 'pending', { status: 'pending' })
    addAttachment(t.trip.id, me, 'doc', { kind: 'document' })
    addAttachment(t.trip.id, me, 'gone', { deleted: true })
    addAttachment(other.t.trip.id, other.t.member.id, 'theirs')
    for (const id of ['pending', 'doc', 'gone', 'theirs', 'missing']) {
      const res = await call('PATCH', base, { token, body: { coverAttachmentId: id } })
      expect(res.status, id).toBe(422)
    }
    const ok = await call<{ trip: { coverAttachmentId: string } }>('PATCH', base, {
      token,
      body: { coverAttachmentId: 'ok' },
    })
    expect(ok.status).toBe(200)
    expect(ok.body.trip.coverAttachmentId).toBe('ok')
    expect((await call('PATCH', base, { token, body: { coverAttachmentId: null } })).status).toBe(
      200,
    )
    // a new trip has no photos to point at
    const created = await call('POST', '/api/trips', {
      body: {
        name: 'X',
        startDate: '2026-12-20',
        endDate: '2026-12-21',
        tz: 'UTC',
        coverAttachmentId: 'ok',
        owner: { name: 'G', color: 'teal' },
      },
    })
    expect(created.status).toBe(422)
  })

  it('re-links days to lodgings when the trip dates change', async () => {
    const { t, base, token } = await createTrip('2026-12-20', '2026-12-24')
    const lodging = await call<{ lodging: { id: string } }>('POST', `${base}/lodgings`, {
      token,
      body: { name: 'Inn', checkIn: '2026-12-22', checkOut: '2026-12-26' },
    })
    expect(lodging.status).toBe(201)
    const linked = () =>
      sqlite
        .prepare(
          `SELECT date FROM days WHERE tripId = '${t.trip.id}' AND lodgingId IS NOT NULL ORDER BY date`,
        )
        .all()
        .map((r) => r.date)
    expect(linked()).toEqual(['2026-12-22', '2026-12-23', '2026-12-24'])

    // Longer: 12-25 is a night of the stay too
    expect((await call('PATCH', base, { token, body: { endDate: '2026-12-27' } })).status).toBe(200)
    expect(linked()).toEqual(['2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25'])

    // Shorter: the days after 12-23 become unassigned and lose the lodging
    expect((await call('PATCH', base, { token, body: { endDate: '2026-12-23' } })).status).toBe(200)
    expect(linked()).toEqual(['2026-12-22', '2026-12-23'])
    const days = await call<DaysResponse>('GET', `${base}/days`, { token })
    const assigned = days.body.days.filter((d) => d.idx !== null)
    expect(assigned.map((d) => [d.date, d.lodgingId])).toEqual([
      ['2026-12-20', null],
      ['2026-12-21', null],
      ['2026-12-22', lodging.body.lodging.id],
      ['2026-12-23', lodging.body.lodging.id],
    ])
  })
})

describe('places', () => {
  it('dedupes POST /places by externalId within the trip', async () => {
    const a = await createTrip()
    const b = await createTrip()
    const body = {
      nameLocal: 'Fergburger',
      lat: -45.03,
      lng: 168.66,
      source: 'photon',
      externalId: 'osm:N1',
    }
    const first = await call<{ place: Place; rev: number }>('POST', `${a.base}/places`, {
      token: a.token,
      body,
    })
    expect(first.status).toBe(201)
    expect(first.body.place.externalId).toBe('osm:N1')
    const again = await call<{ place: Place; rev: number; existing: boolean }>(
      'POST',
      `${a.base}/places`,
      {
        token: a.token,
        body: { ...body, nameLocal: 'Renamed' },
      },
    )
    expect(again.status).toBe(200)
    expect(again.body).toMatchObject({ existing: true, rev: first.body.rev })
    expect(again.body.place).toEqual(first.body.place)
    // another trip gets its own row
    expect((await call('POST', `${b.base}/places`, { token: b.token, body })).status).toBe(201)
    // no externalId: never deduped
    const manual = { nameLocal: 'Pin', lat: 1, lng: 2 }
    expect((await call('POST', `${a.base}/places`, { token: a.token, body: manual })).status).toBe(
      201,
    )
    expect((await call('POST', `${a.base}/places`, { token: a.token, body: manual })).status).toBe(
      201,
    )
  })

  it('refs, merge and delete cover lodgings, bookings and attachments', async () => {
    const { t, base, token } = await createTrip()
    const place = async (nameLocal: string, externalId?: string) =>
      (
        await call<{ place: Place }>('POST', `${base}/places`, {
          token,
          body: { nameLocal, lat: -43.49, lng: 172.53, ...(externalId ? { externalId } : {}) },
        })
      ).body.place
    const dup = await place('CHC airport', 'osm:W9')
    const target = await place('Christchurch Airport')
    const lodging = await call<{ lodging: { id: string } }>('POST', `${base}/lodgings`, {
      token,
      body: {
        name: 'Airport motel',
        checkIn: '2026-12-20',
        checkOut: '2026-12-21',
        placeId: dup.id,
      },
    })
    const booking = await call<BookingWriteResponse>('POST', `${base}/bookings`, {
      token,
      body: {
        type: 'rental',
        title: 'Campervan',
        startLocal: '2026-12-20T10:00',
        endLocal: '2026-12-24T15:00',
        details: {
          company: 'Britz',
          vehicle: 'Venturer',
          pickupPlaceId: dup.id,
          dropoffPlaceId: dup.id,
        },
      },
    })
    expect(booking.status).toBe(201)
    addAttachment(t.trip.id, t.member.id, 'photo1')
    sqlite.exec(`UPDATE attachments SET placeId = '${dup.id}' WHERE id = 'photo1'`)

    const refs = await call<PlaceRefsResponse>('GET', `${base}/places/${dup.id}/refs`, { token })
    expect(refs.body.lodgings).toEqual([
      { id: lodging.body.lodging.id, name: 'Airport motel', checkIn: '2026-12-20' },
    ])
    expect(refs.body.bookings).toEqual([
      {
        id: booking.body.booking.id,
        title: 'Campervan',
        type: 'rental',
        fields: ['pickupPlaceId', 'dropoffPlaceId'],
      },
    ])

    const merged = await call<{ place: Place; repointed: Record<string, number> }>(
      'POST',
      `${base}/places/${dup.id}/merge-into/${target.id}`,
      { token },
    )
    expect(merged.status).toBe(200)
    expect(merged.body.repointed).toEqual({
      // the rental's pickup and dropoff stops carry the place too
      stops: 2,
      wishlistItems: 0,
      lodgings: 1,
      attachments: 1,
      bookings: 1,
    })
    // the target takes over the search id
    expect(merged.body.place.externalId).toBe('osm:W9')
    const details = () =>
      JSON.parse(
        String(
          sqlite
            .prepare(`SELECT details FROM bookings WHERE id = '${booking.body.booking.id}'`)
            .all()[0].details,
        ),
      ) as Record<string, unknown>
    expect(details()).toMatchObject({ pickupPlaceId: target.id, dropoffPlaceId: target.id })
    const placeOf = (table: string) =>
      sqlite.prepare(`SELECT placeId FROM ${table} WHERE tripId = '${t.trip.id}'`).all()[0].placeId
    expect(placeOf('lodgings')).toBe(target.id)
    expect(placeOf('attachments')).toBe(target.id)
    const targetRefs = await call<PlaceRefsResponse>('GET', `${base}/places/${target.id}/refs`, {
      token,
    })
    expect(targetRefs.body.bookings).toHaveLength(1)

    expect((await call('DELETE', `${base}/places/${target.id}`, { token })).status).toBe(200)
    expect(placeOf('lodgings')).toBeNull()
    expect(placeOf('attachments')).toBeNull()
    expect(details()).toEqual({ company: 'Britz', vehicle: 'Venturer' })
    // the booking still reads back
    const list = await call<{ bookings: unknown[] }>('GET', `${base}/bookings`, { token })
    expect(list.status).toBe(200)
  })
})

describe('stops and legs', () => {
  it('returns source and bookingSlot, and accepts the cycle leg mode', async () => {
    const { t, base, token } = await createTrip()
    const day = t.days[0].id
    const manual = await call<{ stop: { id: string; source: string; bookingSlot: string | null } }>(
      'POST',
      `${base}/stops`,
      { token, body: { dayId: day, title: 'Walk' } },
    )
    expect(manual.body.stop).toMatchObject({ source: 'manual', bookingSlot: null })
    await call('POST', `${base}/bookings`, {
      token,
      body: {
        type: 'activity',
        title: 'Hike',
        startLocal: '2026-12-20T09:00',
        endLocal: '2026-12-20T12:00',
        details: {},
      },
    })
    const days = await call<DaysResponse>('GET', `${base}/days`, { token })
    const stops = days.body.days.find((d) => d.id === day)!.stops
    expect(stops.map((s) => [s.title, s.source, s.bookingSlot]).sort()).toEqual([
      ['Hike', 'booking', 'main'],
      ['Walk', 'manual', null],
    ])
    const leg = await call<{ leg: { mode: string } }>(
      'PUT',
      `${base}/legs/${stops[0].id}/${stops[1].id}`,
      {
        token,
        body: { mode: 'cycle' },
      },
    )
    expect(leg.status).toBe(200)
    expect(leg.body.leg.mode).toBe('cycle')
  })
})

describe('deadlines', () => {
  it('includes past-due items only with includePast=1', async () => {
    const { base, token } = await createTrip()
    const missed = await call<{ lodging: { id: string } }>('POST', `${base}/lodgings`, {
      token,
      body: {
        name: 'Missed',
        checkIn: '2026-12-20',
        checkOut: '2026-12-21',
        cancelBy: '2020-01-01T00:00:00Z',
      },
    })
    expect(missed.status).toBe(201)
    const plain = await call<DeadlinesResponse>('GET', `${base}/deadlines?withinDays=366`, {
      token,
    })
    expect(plain.body.deadlines.filter((d) => d.dueAt < '2021')).toEqual([])
    const past = await call<DeadlinesResponse>(
      'GET',
      `${base}/deadlines?withinDays=366&includePast=1`,
      { token },
    )
    expect(past.body.deadlines.slice(0, 2).map((d) => [d.id, d.type, d.dueAt])).toEqual([
      [missed.body.lodging.id, 'payment', '2020-01-01T00:00:00Z'],
      [missed.body.lodging.id, 'cancel', '2020-01-01T00:00:00Z'],
    ])
    expect((await call('GET', `${base}/deadlines?includePast=yes`, { token })).status).toBe(422)
  })
})
