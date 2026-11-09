import { beforeEach, describe, expect, it } from 'vitest'
import type { ImportTripResponse, TripExport } from '../../shared/api/export.ts'
import type { CreateTripResponse, DaysResponse, Stop } from '../../shared/api/types.ts'
import { handleRequest } from '../../worker/app.ts'
import type { Env } from '../../worker/env.ts'
import { shiftInstant } from '../../worker/trips/export.ts'
import { createFakeD1 } from './fake-d1.ts'

// e8-t03: GET /api/trips/:id/export → POST /api/import round trip (AC-8.3)

let env: Env
let sqlite: ReturnType<typeof createFakeD1>['sqlite']

beforeEach(() => {
  const fake = createFakeD1()
  sqlite = fake.sqlite
  env = { DB: fake.db, APP_VERSION: 'test' } as unknown as Env
})

type Json = Record<string, unknown>

async function call<T = Json>(
  method: string,
  path: string,
  { token, body, raw }: { token?: string; body?: unknown; raw?: string } = {},
): Promise<{ status: number; body: T; headers: Headers }> {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json'
  const response = await handleRequest(
    new Request(`https://x.test${path}`, {
      method,
      headers,
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
    env,
  )
  return { status: response.status, body: (await response.json()) as T, headers: response.headers }
}

interface Seeded {
  t: CreateTripResponse
  token: string
  ana: { id: string; token: string }
  viewerToken: string
}

/** NZ, 3 days: places, timed/untimed stops, a leg, a lodging, a flight and a rental (with places),
 * a scheduled wishlist item with votes and a claim, an expense, a pool top-up and a settlement */
async function seed(): Promise<Seeded> {
  const created = await call<CreateTripResponse>('POST', '/api/trips', {
    body: {
      name: 'NZ South',
      destination: 'New Zealand',
      startDate: '2026-12-20',
      endDate: '2026-12-22',
      tz: 'Pacific/Auckland',
      baseCurrency: 'AUD',
      localCurrencies: ['NZD'],
      style: 'campervan',
      owner: { name: 'Gene', color: 'teal' },
    },
  })
  expect(created.status).toBe(201)
  const t = created.body
  const token = t.memberToken
  const id = t.trip.id
  const day = (n: number) => t.days[n - 1].id
  const post = async (path: string, body: unknown, as = token) => {
    const res = await call<Json>('POST', `/api/trips/${id}${path}`, { token: as, body })
    expect(res.status, `${path} ${JSON.stringify(res.body)}`).toBeLessThan(300)
    return res.body
  }

  // Ana joins with an invite (editor, has a token); Kid is a viewer
  const invite = await post('/invites', {})
  const joined = await call<Json>('POST', `/api/join/${String(invite.inviteToken)}`, {
    body: { name: 'Ana', color: 'coral' },
  })
  expect(joined.status).toBe(201)
  const ana = {
    id: String((joined.body.member as Json).id),
    token: String(joined.body.memberToken),
  }
  const kid = (await post('/members', { name: 'Kid', color: 'sun', role: 'viewer' })).member as Json
  const invite2 = await post('/invites', {})
  const kidJoin = await call<Json>('POST', `/api/join/${String(invite2.inviteToken)}`, {
    body: { memberId: kid.id },
  })
  expect(kidJoin.status).toBe(201)

  const place = async (nameLocal: string, lat: number, lng: number, address = '') =>
    String(((await post('/places', { nameLocal, lat, lng, address })).place as Json).id)
  const chc = await place('Christchurch Airport', -43.4894, 172.5322, '30 Durey Rd')
  const tekapo = await place('Lake Tekapo', -44.0046, 170.4771, 'SH8, Tekapo')
  const park = await place('Tekapo Holiday Park', -44.0, 170.48, '2 Lakeside Dr; Tekapo')

  const stop = async (body: Json) => (await post('/stops', body)).stop as Stop
  const s1 = await stop({
    dayId: day(1),
    title: 'Church of the Good Shepherd',
    placeId: tekapo,
    startAt: '2026-12-20T03:00:00Z',
    durationMin: 60,
    costMinor: 1500,
    currency: 'NZD',
    note: 'Sunset, bring jackets',
  })
  const s2 = await stop({ dayId: day(1), title: 'Supermarket run', type: 'supplies' })
  await stop({ dayId: day(2), title: 'Rainy day museum', isBackup: true })
  const put = await call('PUT', `/api/trips/${id}/legs/${s1.id}/${s2.id}`, {
    token,
    body: { mode: 'walk', minutes: 12 },
  })
  expect(put.status).toBe(200)
  await call('PATCH', `/api/trips/${id}/days/${day(1)}`, { token, body: { title: 'Arrive' } })

  await post('/lodgings', {
    name: 'Tekapo Holiday Park',
    placeId: park,
    checkIn: '2026-12-20',
    checkOut: '2026-12-22',
    checkInTime: '14:00',
    checkOutTime: '10:00',
    ref: 'BK-123',
    phone: '+64 3 680 6825',
    priceMinor: 18000,
    currency: 'NZD',
    campType: 'holiday-park',
  })
  const flight = (
    await post('/bookings', {
      type: 'flight',
      title: 'NZ104 SYD → CHC',
      details: {
        airline: 'Air New Zealand',
        flightNo: 'NZ104',
        fromAirport: 'SYD',
        toAirport: 'CHC',
      },
      startAt: '2026-12-19T22:00:00Z',
      endAt: '2026-12-20T01:00:00Z',
      startTz: 'Australia/Sydney',
      endTz: 'Pacific/Auckland',
      priceMinor: 45000,
      currency: 'AUD',
      ref: 'ABC123',
    })
  ).booking as Json
  await post('/bookings', {
    type: 'rental',
    title: 'Campervan',
    details: { company: 'Jucy', vehicle: 'Condo', pickupPlaceId: chc, dropoffPlaceId: chc },
    startAt: '2026-12-20T02:00:00Z',
    endAt: '2026-12-22T21:00:00Z',
    payerMemberId: ana.id,
  })

  const item = (
    await post('/wishlist', {
      category: 'see',
      name: 'Dark sky tour',
      placeId: tekapo,
      estMinor: 9900,
      currency: 'NZD',
      recommenderMemberId: ana.id,
    })
  ).item as Json
  await post(`/wishlist/${String(item.id)}/vote`, {})
  await post(`/wishlist/${String(item.id)}/vote`, {}, ana.token)
  await post(`/wishlist/${String(item.id)}/claims`, { buyerMemberId: ana.id, forName: 'Mum' })
  await post(`/wishlist/${String(item.id)}/schedule`, { dayId: day(2) })
  await post('/wishlist', { category: 'buy', name: 'Merino socks' })

  await post('/expenses', {
    amountMinor: 4200,
    currency: 'NZD',
    fxRate: 0.9,
    date: '2026-12-20',
    category: 'food',
    payerMemberId: t.member.id,
    splitMethod: 'equal',
    participants: [{ memberId: t.member.id }, { memberId: ana.id }],
    bookingId: String(flight.id),
  })
  await post('/pool/contributions', { memberId: ana.id, amountMinor: 10000, currency: 'AUD' })
  await post('/settlements', { fromMemberId: ana.id, toMemberId: t.member.id, amountMinor: 500 })

  return { t, token, ana, viewerToken: String(kidJoin.body.memberToken) }
}

async function exportOf(tripId: string, token: string, include = '') {
  const res = await handleRequest(
    new Request(
      `https://x.test/api/trips/${tripId}/export${include ? `?include=${include}` : ''}`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    ),
    env,
  )
  return { status: res.status, headers: res.headers, file: (await res.json()) as TripExport }
}

const withoutStamp = ({ exportedAt: _ignored, ...rest }: TripExport) => rest

describe('export', () => {
  it('writes a v1 file with local ids and no database ids, tokens or emails', async () => {
    const s = await seed()
    const { status, headers, file } = await exportOf(s.t.trip.id, s.token)
    expect(status).toBe(200)
    expect(headers.get('content-type')).toContain('application/json')
    expect(headers.get('content-disposition')).toMatch(/^attachment; filename="NZ-South-2026-12-20/)
    expect(headers.get('cache-control')).toBe('no-store')
    expect(file.format).toBe('tripfolio.trip')
    expect(file.version).toBe(1)
    expect(file.includes).toEqual({ expenses: false, photos: false })
    expect(file.expenses).toBeUndefined()
    expect(file.attachments).toBeUndefined()
    expect(file.members.map((m) => [m.id, m.name, m.role])).toEqual([
      [1, 'Gene', 'owner'],
      [2, 'Ana', 'editor'],
      [3, 'Kid', 'viewer'],
    ])
    expect(file.places.map((p) => p.id)).toEqual([1, 2, 3])
    expect(file.days.map((d) => [d.id, d.idx, d.date, d.title])).toEqual([
      [1, 1, '2026-12-20', 'Arrive'],
      [2, 2, '2026-12-21', ''],
      [3, 3, '2026-12-22', ''],
    ])
    const text = JSON.stringify(file)
    for (const secret of [s.t.trip.id, s.t.member.id, s.ana.id, s.token, s.ana.token])
      expect(text).not.toContain(secret)
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
    // Relations are local ids
    const rental = file.bookings.find((b) => b.type === 'rental')
    expect(rental?.details.pickupPlaceId).toBe(1)
    expect(rental?.payer).toBe(2)
    const item = file.wishlist.find((w) => w.name === 'Dark sky tour')
    expect(item?.votes).toEqual([1, 2])
    expect(item?.claims).toEqual([{ buyer: 2, forName: 'Mum', qty: 1, done: false }])
    const scheduled = file.stops.find((st) => st.id === item?.stop)
    expect(scheduled?.wishlistItem).toBe(item?.id)
    expect(file.days[0].lodging).toBe(1)
    expect(file.days[1].lodging).toBe(1)
    expect(file.stops.filter((st) => st.bookingRef !== null)).toHaveLength(2)
    expect(file.legOverrides).toHaveLength(1)
  })

  it('adds expenses with ?include=expenses and photo metadata with photos', async () => {
    const s = await seed()
    const { file } = await exportOf(s.t.trip.id, s.token, 'expenses,photos')
    expect(file.includes).toEqual({ expenses: true, photos: true })
    expect(file.expenses).toHaveLength(1)
    expect(file.expenses?.[0]).toMatchObject({
      payer: 1,
      amountMinor: 4200,
      currency: 'NZD',
      fxRate: 0.9,
      baseMinor: 3780,
      bookingRef: 1,
    })
    expect(file.expenses?.[0].shares.map((sh) => [sh.member, sh.shareMinor])).toEqual([
      [1, 1890],
      [2, 1890],
    ])
    expect(file.poolContributions?.[0]).toMatchObject({ member: 2, amountMinor: 10000 })
    expect(file.settlements?.[0]).toMatchObject({ from: 2, to: 1, amountMinor: 500 })
    expect(file.attachments).toEqual([])
    expect((await exportOf(s.t.trip.id, s.token, 'receipts')).status).toBe(422)
  })

  it('is for editors and owners only', async () => {
    const s = await seed()
    expect((await exportOf(s.t.trip.id, s.ana.token)).status).toBe(200)
    expect((await exportOf(s.t.trip.id, s.viewerToken)).status).toBe(403)
    expect((await exportOf(s.t.trip.id, '')).status).toBe(401)
    const other = await call<CreateTripResponse>('POST', '/api/trips', {
      body: {
        name: 'Other',
        startDate: '2026-01-01',
        endDate: '2026-01-01',
        tz: 'UTC',
        owner: { name: 'X', color: 'teal' },
      },
    })
    expect((await exportOf(s.t.trip.id, other.body.memberToken)).status).toBe(404)
    // Archived trips can still be exported
    await call('PATCH', `/api/trips/${s.t.trip.id}`, { token: s.token, body: { archived: true } })
    expect((await exportOf(s.t.trip.id, s.token)).status).toBe(200)
  })
})

describe('import', () => {
  const owner = { name: 'Gene', color: 'teal' }

  it('round trip: export → import → export gives the same file (AC-8.3)', async () => {
    const s = await seed()
    const first = (await exportOf(s.t.trip.id, s.token, 'expenses')).file
    const imported = await call<ImportTripResponse>('POST', '/api/import', {
      body: { ...first, owner, asMember: 1 },
    })
    expect(imported.status).toBe(201)
    expect(imported.body.trip.id).not.toBe(s.t.trip.id)
    expect(imported.body.member.role).toBe('owner')
    expect(imported.body.skipped).toEqual([])
    const second = (await exportOf(imported.body.trip.id, imported.body.memberToken, 'expenses'))
      .file
    expect(withoutStamp(second)).toEqual(withoutStamp(first))

    // The new trip works through the normal API: days with stops, the new owner can edit
    const days = await call<DaysResponse>('GET', `/api/trips/${imported.body.trip.id}/days`, {
      token: imported.body.memberToken,
    })
    expect(days.status).toBe(200)
    expect(days.body.days.map((d) => d.stops.length)).toEqual(
      first.days.map((d) => first.stops.filter((st) => st.day === d.id).length),
    )
    const balances = await call<Json>('GET', `/api/trips/${imported.body.trip.id}/balances`, {
      token: imported.body.memberToken,
    })
    expect(balances.status).toBe(200)
    // Placeholder members have no tokens; only the owner's token exists
    const tokens = sqlite
      .prepare('SELECT COUNT(*) AS n FROM memberTokens WHERE tripId = ?')
      .all(imported.body.trip.id)
    expect(tokens[0].n).toBe(1)
  })

  it('moves every date and time when startDate differs', async () => {
    const s = await seed()
    const first = (await exportOf(s.t.trip.id, s.token, 'expenses')).file
    const imported = await call<ImportTripResponse>('POST', '/api/import', {
      body: { ...first, owner, asMember: 1, startDate: '2027-03-01', name: 'NZ again' },
    })
    expect(imported.status).toBe(201)
    expect(imported.body.trip).toMatchObject({
      name: 'NZ again',
      startDate: '2027-03-01',
      endDate: '2027-03-03',
    })
    const moved = (await exportOf(imported.body.trip.id, imported.body.memberToken, 'expenses'))
      .file
    const delta = 71 // 2026-12-20 → 2027-03-01
    expect(moved.days.map((d) => d.date)).toEqual(['2027-03-01', '2027-03-02', '2027-03-03'])
    expect(moved.lodgings[0]).toMatchObject({ checkIn: '2027-03-01', checkOut: '2027-03-03' })
    expect(moved.expenses?.[0].date).toBe('2027-03-01')
    // Same local wall-clock time in the zone each time was entered in (the flight: Sydney)
    const st = moved.stops.find((x) => x.title === 'Church of the Good Shepherd')
    expect(st?.startAt).toBe(shiftInstant('2026-12-20T03:00:00Z', delta, 'Pacific/Auckland'))
    const flight = moved.bookings.find((b) => b.type === 'flight')
    expect(flight?.startAt).toBe(shiftInstant('2026-12-19T22:00:00Z', delta, 'Australia/Sydney'))
    // Relations are intact: the same shape as the original apart from the dates
    const shape = (f: TripExport) => ({
      stops: f.stops.map((x) => [x.day, x.place, x.wishlistItem, x.bookingRef, x.lodging]),
      days: f.days.map((d) => d.lodging),
      wishlist: f.wishlist.map((w) => [w.place, w.stop, w.votes, w.recommender]),
      legs: f.legOverrides,
      bookings: f.bookings.map((b) => [b.details, b.payer]),
    })
    expect(shape(moved)).toEqual(shape(first))
  })

  it('shiftInstant keeps the wall-clock time across a DST change', () => {
    // 09:00 NZDT (UTC+13) on 2027-03-01 → 09:00 NZST (UTC+12) on 2027-05-01
    expect(shiftInstant('2027-02-28T20:00:00Z', 61, 'Pacific/Auckland')).toBe(
      '2027-04-30T21:00:00.000Z',
    )
    expect(shiftInstant('2027-02-28T20:00:00Z', 0, 'Pacific/Auckland')).toBe('2027-02-28T20:00:00Z')
  })

  it('without members: only the caller, references cleared, expenses skipped', async () => {
    const s = await seed()
    const first = (await exportOf(s.t.trip.id, s.token, 'expenses')).file
    const imported = await call<ImportTripResponse>('POST', '/api/import', {
      body: { ...first, owner: { name: 'Friend', color: 'sky' }, keep: { members: false } },
    })
    expect(imported.status).toBe(201)
    expect(imported.body.skipped).toEqual([
      'members: not kept; their references were cleared',
      'expenses: they need the members, which were not kept',
    ])
    const out = (await exportOf(imported.body.trip.id, imported.body.memberToken, 'expenses')).file
    expect(out.members).toEqual([
      { id: 1, name: 'Friend', color: 'sky', role: 'owner', removed: false },
    ])
    expect(out.expenses).toEqual([])
    expect(out.wishlist[0]).toMatchObject({ votes: [], recommender: null })
    expect(out.bookings.find((b) => b.type === 'rental')?.payer).toBeNull()
    expect(out.places).toHaveLength(3)
  })

  it('rejects bad files with 422 and big ones with 413', async () => {
    const s = await seed()
    const file = (await exportOf(s.t.trip.id, s.token)).file
    const bad: unknown[] = [
      { ...file, owner },
      { ...file, format: 'other', owner },
      { ...file, version: 2, owner },
      { owner },
      { ...file, owner, stops: [{ ...file.stops[0], place: 99 }] },
      { ...file, owner, places: [...file.places, file.places[0]] },
      { ...file, owner, asMember: 42 },
      {
        ...file,
        owner,
        bookings: file.bookings.map((b) => ({ ...b, details: { ...b.details, flightNo: '' } })),
      },
      { ...file, owner, trip: { ...file.trip, tz: 'Mars/Olympus' } },
    ]
    bad[0] = { ...file, owner: { name: '' } }
    for (const [i, body] of bad.entries()) {
      const res = await call('POST', '/api/import', { body })
      expect(res.status, `case ${i}: ${JSON.stringify(res.body)}`).toBe(422)
    }
    expect((await call('POST', '/api/import', { raw: '{nope' })).status).toBe(422)
    const huge = JSON.stringify({ ...file, owner, pad: 'x'.repeat(5 * 1024 * 1024) })
    expect((await call('POST', '/api/import', { raw: huge })).status).toBe(413)
    // Nothing half-written
    const trips = sqlite.prepare('SELECT COUNT(*) AS n FROM trips').all()
    expect(trips[0].n).toBe(1)
  })
})
