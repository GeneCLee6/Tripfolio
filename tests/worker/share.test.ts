import { beforeEach, describe, expect, it } from 'vitest'
import migration0003 from '../../migrations/0003_proxy.sql?raw'
import type { SharePayload } from '../../shared/api/share.ts'
import type {
  CreateShareResponse,
  CreateTripResponse,
  Place,
  Stop,
} from '../../shared/api/types.ts'
import { handleRequest } from '../../worker/app.ts'
import type { Env } from '../../worker/env.ts'
import { routeKey } from '../../worker/proxy/route.ts'
import { buildEstimate, overnightLines } from '../../worker/share.ts'
import { createFakeD1 } from './fake-d1.ts'

// GET /api/share/:token (e8-t01a, e8-t01b): the filtered payload of the read-only share page

let env: Env
let sqlite: ReturnType<typeof createFakeD1>['sqlite']

beforeEach(() => {
  const fake = createFakeD1()
  fake.sqlite.exec(migration0003)
  sqlite = fake.sqlite
  env = { DB: fake.db, APP_VERSION: 'test' } as unknown as Env
})

async function call<T>(method: string, path: string, token?: string, body?: unknown) {
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
  return { status: response.status, headers: response.headers, body: (await response.json()) as T }
}

const CHRISTCHURCH = { lat: -43.5321, lng: 172.6362 }
const TEKAPO = { lat: -44.0046, lng: 170.4771 }
const COOK = { lat: -43.7342, lng: 170.0966 }

/** A trip with three dates, stops with places and money on Day 1, and a stop on Day 3 */
async function seed() {
  const created = await call<CreateTripResponse>('POST', '/api/trips', undefined, {
    name: 'NZ South Island',
    destination: 'New Zealand',
    startDate: '2026-12-20',
    endDate: '2026-12-22',
    tz: 'Pacific/Auckland',
    localCurrencies: ['NZD'],
    style: 'campervan',
    summary: 'Lakes and stars',
    owner: { name: 'Gene', color: 'teal' },
  })
  expect(created.status).toBe(201)
  const { trip, memberToken: token, days } = created.body
  const base = `/api/trips/${trip.id}`
  const place = async (nameLocal: string, at: { lat: number; lng: number }, extra = {}) =>
    (
      await call<{ place: Place }>('POST', `${base}/places`, token, {
        nameLocal,
        ...at,
        address: `${nameLocal} Road 1`,
        ...extra,
      })
    ).body.place
  const stop = async (dayId: string, fields: object) => {
    const res = await call<{ stop: Stop }>('POST', `${base}/stops`, token, { dayId, ...fields })
    expect(res.status).toBe(201)
    return res.body.stop
  }
  const chc = await place('基督城', CHRISTCHURCH, { nameEn: 'Christchurch' })
  const tek = await place('蒂卡波湖', TEKAPO, { nameEn: 'Lake Tekapo' })
  const cook = await place('庫克山', COOK)
  const a = await stop(days[0].id, {
    placeId: chc.id,
    type: 'transport',
    startAt: '2026-12-20T01:00:00.000Z',
  })
  const b = await stop(days[0].id, {
    placeId: tek.id,
    type: 'sight',
    title: 'Church of the Good Shepherd',
    costMinor: 1500,
    currency: 'NZD',
    booking: 'booked',
  })
  const c = await stop(days[0].id, {
    placeId: cook.id,
    type: 'sight',
    costMinor: 0,
    currency: 'NZD',
  })
  const backup = await stop(days[0].id, { title: 'Cinema', type: 'other', isBackup: true })
  const late = await stop(days[2].id, { placeId: cook.id, title: 'Hooker Valley' })
  return {
    trip,
    token,
    days,
    base,
    memberId: created.body.member.id,
    places: { chc, tek, cook },
    stops: { a, b, c, backup, late },
  }
}

async function share(base: string, token: string, options: object = {}) {
  const res = await call<CreateShareResponse>('POST', `${base}/shares`, token, { options })
  expect(res.status).toBe(201)
  return res.body
}

const getShare = (shareToken: string) => call<SharePayload>('GET', `/api/share/${shareToken}`)

/** Every key anywhere in a JSON value */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysOf(v, into)
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k)
      keysOf(v, into)
    }
  }
  return into
}

describe('GET /api/share/:token', () => {
  it('returns the trip, assigned days with stops and legs, the options and headers', async () => {
    const s = await seed()
    const { shareToken } = await share(s.base, s.token)
    const res = await getShare(shareToken)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    const body = res.body
    expect(body.trip).toEqual({
      name: 'NZ South Island',
      destination: 'New Zealand',
      startDate: '2026-12-20',
      endDate: '2026-12-22',
      tz: 'Pacific/Auckland',
      coverColor: null,
      summary: 'Lakes and stars',
      style: 'campervan',
      memberCount: 1,
      dayCount: 3,
      baseCurrency: 'AUD',
    })
    expect(body.options).toEqual({ hideMoney: false, hideAddresses: false, showRecap: false })
    expect(typeof body.generatedAt).toBe('string')
    expect(body.days.map((d) => [d.index, d.date])).toEqual([
      [1, '2026-12-20'],
      [2, '2026-12-21'],
      [3, '2026-12-22'],
    ])
    const [day1] = body.days
    expect(day1.lodgingName).toBeNull()
    expect(day1.stops).toHaveLength(4)
    expect(day1.stops[0]).toEqual({
      order: s.stops.a.order,
      type: 'transport',
      name: '基督城',
      nameEn: 'Christchurch',
      lat: CHRISTCHURCH.lat,
      lng: CHRISTCHURCH.lng,
      address: '基督城 Road 1',
      startAt: '2026-12-20T01:00:00.000Z',
      note: '',
      booking: 'none',
      isBackup: false,
    })
    // A stop title wins over the place name, and then no English place name is sent
    expect(day1.stops[1]).toMatchObject({
      name: 'Church of the Good Shepherd',
      costMinor: 1500,
      currency: 'NZD',
      booking: 'booked',
    })
    expect(day1.stops[1]).not.toHaveProperty('nameEn')
    expect(day1.stops[3]).toMatchObject({ name: 'Cinema', isBackup: true })
    expect(day1.stops[3]).not.toHaveProperty('lat')
    // Legs: a→b and b→c, campervan estimates; the backup stop is left out
    expect(day1.legs.map((l) => [l.fromOrder, l.toOrder, l.mode, l.source])).toEqual([
      [s.stops.a.order, s.stops.b.order, 'campervan', 'estimate'],
      [s.stops.b.order, s.stops.c.order, 'campervan', 'estimate'],
    ])
    expect(day1.driveMinutes).toBeGreaterThan(0)
    expect(day1.distanceM).toBe(day1.legs.reduce((sum, l) => sum + (l.distanceM ?? 0), 0))
    expect(body.days[1]).toMatchObject({ stops: [], legs: [], driveMinutes: 0, distanceM: 0 })
  })

  it('hideMoney removes every money field; hideAddresses removes addresses', async () => {
    const s = await seed()
    const money = await getShare((await share(s.base, s.token, { hideMoney: true })).shareToken)
    expect(money.body.options.hideMoney).toBe(true)
    const moneyKeys = keysOf(money.body)
    for (const key of ['costMinor', 'currency', 'baseCurrency', 'estimatedPerPersonMinor']) {
      expect(moneyKeys.has(key), key).toBe(false)
    }
    expect(moneyKeys.has('address')).toBe(true)
    expect(JSON.stringify(money.body)).not.toContain('1500')

    const addr = await getShare((await share(s.base, s.token, { hideAddresses: true })).shareToken)
    const addrKeys = keysOf(addr.body)
    expect(addrKeys.has('address')).toBe(false)
    expect(JSON.stringify(addr.body)).not.toContain('Road 1')
    expect(addrKeys.has('costMinor')).toBe(true)
  })

  it('leaves out unassigned days', async () => {
    const s = await seed()
    const patched = await call('PATCH', s.base, s.token, { endDate: '2026-12-21' })
    expect(patched.status).toBe(200)
    const res = await getShare((await share(s.base, s.token)).shareToken)
    expect(res.body.trip.dayCount).toBe(2)
    expect(res.body.days.map((d) => d.index)).toEqual([1, 2])
    expect(JSON.stringify(res.body)).not.toContain('Hooker Valley')
  })

  it('uses leg overrides and cached routes, without calling a provider', async () => {
    const s = await seed()
    const { a, b, c } = s.stops
    const put = await call('PUT', `${s.base}/legs/${b.id}/${c.id}`, s.token, {
      mode: 'walk',
      minutes: 90,
    })
    expect(put.status).toBe(200)
    // A cached drive route for a→b (campervans are looked up as cars)
    sqlite.exec(
      `INSERT INTO routeCache (key, mode, provider, distanceM, durationS, geometry, createdAt)
       VALUES ('${routeKey({ from: CHRISTCHURCH, to: TEKAPO, mode: 'drive' })}', 'drive', 'ors',
               226000, 10800, '{"type":"LineString","coordinates":[]}', '2026-11-09T00:00:00Z')`,
    )
    const res = await getShare((await share(s.base, s.token)).shareToken)
    const [day1] = res.body.days
    expect(day1.legs).toEqual([
      {
        fromOrder: a.order,
        toOrder: b.order,
        mode: 'campervan',
        distanceM: 226000,
        durationS: 10800,
        source: 'route',
      },
      expect.objectContaining({
        fromOrder: b.order,
        toOrder: c.order,
        mode: 'walk',
        durationS: 5400,
        source: 'manual',
      }),
    ])
    // Only road legs count as driving time
    expect(day1.driveMinutes).toBe(180)
    expect(day1.distanceM).toBe(226000 + (day1.legs[1].distanceM ?? 0))
  })

  it('answers 404 for revoked and unknown tokens, with the share headers', async () => {
    const s = await seed()
    const created = await share(s.base, s.token)
    expect((await getShare(created.shareToken)).status).toBe(200)
    const del = await call('DELETE', `${s.base}/shares/${created.share.id}`, s.token)
    expect(del.status).toBe(200)
    const revoked = await getShare(created.shareToken)
    expect(revoked.status).toBe(404)
    expect(revoked.body).toMatchObject({ error: { code: 'not_found' } })
    expect(revoked.headers.get('x-robots-tag')).toBe('noindex')
    expect(revoked.headers.get('cache-control')).toBe('private, no-store')
    expect((await getShare('AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404)
    expect((await getShare('not-a-token')).status).toBe(404)
  })
})

// ---- e8-t01b: lodgings, photos, picks, overnight lines, estimate -------------------------------

type Seeded = Awaited<ReturnType<typeof seed>>

/** A shareable photo unless told otherwise; inserted directly (the upload flow is media.test.ts) */
function photo(
  s: Seeded,
  id: string,
  fields: {
    dayId?: string
    stopId?: string
    takenAt?: string | null
    kind?: string
    visibility?: string
    status?: string
    deletedAt?: string | null
  },
) {
  const v = (x: string | null | undefined) => (x === null || x === undefined ? 'NULL' : `'${x}'`)
  sqlite.exec(
    `INSERT INTO attachments (id, tripId, kind, r2Key, thumbKey, mime, bytes, takenAt, dayId, stopId,
       uploaderMemberId, visibility, status, createdAt, updatedAt, deletedAt)
     VALUES ('${id}', '${s.trip.id}', '${fields.kind ?? 'photo'}', 'k/${id}', 'k/${id}.t',
       'image/jpeg', 10, ${v(fields.takenAt)}, ${v(fields.dayId)}, ${v(fields.stopId)},
       '${s.memberId}', '${fields.visibility ?? 'trip'}', '${fields.status ?? 'ready'}',
       '2026-11-09T00:00:00Z', '2026-11-09T00:00:00Z', ${v(fields.deletedAt)})`,
  )
}

/** A second member (for the per-person split and votes) */
async function addMember(s: Seeded, name: string) {
  const res = await call<{ member: { id: string } }>('POST', `${s.base}/members`, s.token, {
    name,
    color: 'amber',
  })
  expect(res.status).toBe(201)
  return res.body.member.id
}

async function wish(s: Seeded, body: object) {
  const res = await call<{ item: { id: string } }>('POST', `${s.base}/wishlist`, s.token, body)
  expect(res.status).toBe(201)
  return res.body.item.id
}

const vote = (itemId: string, memberId: string) =>
  sqlite.exec(
    `INSERT INTO wishlistVotes (itemId, memberId, createdAt)
     VALUES ('${itemId}', '${memberId}', '2026-11-09T00:00:00Z')`,
  )

const LODGING = {
  name: 'Lakeview Holiday Park',
  checkIn: '2026-12-20',
  checkOut: '2026-12-22',
}

describe('GET /api/share/:token, full version (e8-t01b)', () => {
  it('joins tonight’s lodging, the checkout time and the camp type into the days', async () => {
    const s = await seed()
    const lodging = await call('POST', `${s.base}/lodgings`, s.token, {
      ...LODGING,
      placeId: s.places.tek.id,
      checkOutTime: '10:00',
      campType: 'holiday-park',
      priceMinor: 30000,
      currency: 'NZD',
    })
    expect(lodging.status).toBe(201)
    const { body } = await getShare((await share(s.base, s.token)).shareToken)
    const [d1, d2, d3] = body.days
    expect(d1).toMatchObject({ lodgingName: LODGING.name, campType: 'holiday-park' })
    expect(d1).not.toHaveProperty('checkoutTime')
    expect(d2.lodgingName).toBe(LODGING.name)
    // Day 3 leaves the park in the morning and has no lodging tonight
    expect(d3.lodgingName).toBeNull()
    expect(d3.checkoutTime).toBe('10:00')
    expect(d3).not.toHaveProperty('campType')
    expect(JSON.stringify(body.days)).not.toContain('30000')
  })

  it('lists up to 3 shareable photos per day by takenAt, and a shareable cover', async () => {
    const s = await seed()
    const [day1, day2] = s.days
    photo(s, 'p1', { dayId: day1.id, takenAt: '2026-12-20T05:00:00Z' })
    photo(s, 'p2', { stopId: s.stops.a.id, takenAt: '2026-12-20T02:00:00Z' })
    photo(s, 'p3', { dayId: day1.id, takenAt: '2026-12-20T01:00:00Z', visibility: 'members-only' })
    photo(s, 'p4', { dayId: day1.id, takenAt: '2026-12-20T01:00:00Z', status: 'pending' })
    photo(s, 'p5', { dayId: day1.id, takenAt: '2026-12-20T01:00:00Z', kind: 'document' })
    photo(s, 'p6', { dayId: day1.id, takenAt: null })
    photo(s, 'p7', { dayId: day1.id, takenAt: '2026-12-20T09:00:00Z' })
    photo(s, 'p8', { dayId: day1.id, takenAt: '2026-12-20T00:00:00Z', deletedAt: '2026-11-09' })
    photo(s, 'p9', { dayId: day2.id, takenAt: null })
    sqlite.exec(`UPDATE trips SET coverAttachmentId = 'p1' WHERE id = '${s.trip.id}'`)
    const shareToken = (await share(s.base, s.token)).shareToken
    const { body } = await getShare(shareToken)
    expect(body.days.map((d) => d.photoIds)).toEqual([['p2', 'p1', 'p7'], ['p9'], []])
    expect(body.trip.coverAttachmentId).toBe('p1')

    // A members-only cover is not offered to the share page
    sqlite.exec(`UPDATE trips SET coverAttachmentId = 'p3' WHERE id = '${s.trip.id}'`)
    const again = await getShare(shareToken)
    expect(again.body.trip).not.toHaveProperty('coverAttachmentId')
    expect(JSON.stringify(again.body)).not.toContain('"p3"')
  })

  it('draws overnight lines from lodgings, falling back to the first and last stops', async () => {
    const s = await seed()
    // Without lodgings: Day 1 from its first stop to its last (the rainy-day backup is not on the
    // route); Day 3 ends where Day 1 did, so it has no line
    const fallback = await getShare((await share(s.base, s.token)).shareToken)
    expect(fallback.body.overnight).toEqual([
      { dayIndex: 1, from: CHRISTCHURCH, to: COOK, toName: '庫克山', toLodging: false },
    ])

    await call('POST', `${s.base}/lodgings`, s.token, { ...LODGING, placeId: s.places.tek.id })
    const { body } = await getShare((await share(s.base, s.token)).shareToken)
    // Day 1 sleeps at the park, Day 2 stays there (no line), Day 3 ends at its last stop
    expect(body.overnight).toEqual([
      { dayIndex: 1, from: CHRISTCHURCH, to: TEKAPO, toName: LODGING.name, toLodging: true },
      { dayIndex: 3, from: TEKAPO, to: COOK, toName: 'Hooker Valley', toLodging: false },
    ])
  })

  it('lists picks: not dropped, images first, then by votes, with day and place', async () => {
    const s = await seed()
    const mia = await addMember(s, 'Mia')
    photo(s, 'shared', { takenAt: null })
    photo(s, 'private', { takenAt: null, visibility: 'members-only' })
    const burger = await wish(s, {
      category: 'eat',
      name: 'Fergburger',
      placeId: s.places.chc.id,
      estMinor: 2000,
      currency: 'NZD',
    })
    await wish(s, { category: 'buy', name: 'Merino socks', photoAttachmentId: 'shared' })
    const stars = await wish(s, { category: 'see', name: 'Stargazing', photoAttachmentId: 'private' })
    await wish(s, { category: 'experience', name: 'Jet boat', sourceImageUrl: 'http://example.com/a.jpg' })
    await wish(s, { category: 'see', name: 'Lookout', sourceImageUrl: 'https://example.com/b.jpg' })
    const dropped = await wish(s, { category: 'eat', name: 'Gone' })
    const patched = await call('PATCH', `${s.base}/wishlist/${dropped}`, s.token, {
      status: 'dropped',
    })
    expect(patched.status).toBe(200)
    vote(burger, s.memberId)
    vote(burger, mia)
    vote(stars, mia)
    const scheduled = await call('POST', `${s.base}/wishlist/${burger}/schedule`, s.token, {
      dayId: s.days[2].id,
    })
    expect(scheduled.status).toBe(201)

    const { body } = await getShare((await share(s.base, s.token)).shareToken)
    expect(body.picks.map((p) => p.name)).toEqual([
      'Merino socks',
      'Lookout',
      'Fergburger',
      'Stargazing',
      'Jet boat',
    ])
    const [socks, lookout, burgerPick, starsPick, jet] = body.picks
    expect(socks).toEqual({
      category: 'buy',
      name: 'Merino socks',
      votes: 0,
      photoAttachmentId: 'shared',
    })
    expect(lookout.sourceImageUrl).toBe('https://example.com/b.jpg')
    expect(burgerPick).toEqual({
      category: 'eat',
      name: 'Fergburger',
      estMinor: 2000,
      currency: 'NZD',
      votes: 2,
      place: { ...CHRISTCHURCH, nameLocal: '基督城', nameEn: 'Christchurch' },
      dayIndex: 3,
    })
    // A members-only photo and a plain-http image are left out
    expect(starsPick).not.toHaveProperty('photoAttachmentId')
    expect(starsPick.votes).toBe(1)
    expect(jet).not.toHaveProperty('sourceImageUrl')
    expect(JSON.stringify(body)).not.toContain('private')
  })

  it('limits picks to 24, keeping the most wanted', async () => {
    const s = await seed()
    for (let i = 0; i < 30; i++) {
      sqlite.exec(
        `INSERT INTO wishlistItems (id, tripId, category, name, "order", createdAt, updatedAt)
         VALUES ('w${i}', '${s.trip.id}', 'eat', 'Item ${i}', ${i}, '2026-11-09', '2026-11-09')`,
      )
    }
    vote('w29', s.memberId)
    const { body } = await getShare((await share(s.base, s.token)).shareToken)
    expect(body.picks).toHaveLength(24)
    expect(body.picks[0]).toMatchObject({ name: 'Item 29', votes: 1 })
    expect(body.picks[1].name).toBe('Item 0')
  })

  it('estimates costs per currency: stops, lodgings and bookings, without backups', async () => {
    const s = await seed()
    await addMember(s, 'Mia')
    await call('POST', `${s.base}/lodgings`, s.token, { ...LODGING, priceMinor: 30000, currency: 'NZD' })
    const booking = await call<{ booking: { id: string; stops: { id: string }[] } }>(
      'POST',
      `${s.base}/bookings`,
      s.token,
      {
        type: 'activity',
        title: 'Glacier heli hike',
        details: {},
        startLocal: '2026-12-21T09:00',
        priceMinor: 12000,
        currency: 'AUD',
      },
    )
    expect(booking.status).toBe(201)
    expect(booking.body.booking.stops.length).toBeGreaterThan(0)
    // The booking's own stop with a price would count twice: it is skipped
    for (const st of booking.body.booking.stops) {
      sqlite.exec(`UPDATE stops SET costMinor = 12000, currency = 'AUD' WHERE id = '${st.id}'`)
    }
    const stop = async (fields: object) =>
      expect(
        (await call('POST', `${s.base}/stops`, s.token, { dayId: s.days[1].id, ...fields })).status,
      ).toBe(201)
    await stop({ title: 'Dinner', type: 'food', costMinor: 8001, currency: 'AUD' })
    await stop({ title: 'Museum', type: 'sight', isBackup: true, costMinor: 999, currency: 'AUD' })
    await stop({ title: 'Pass', type: 'transport', costMinor: 500, currency: 'JPY' })

    const { body } = await getShare((await share(s.base, s.token)).shareToken)
    expect(body.estimate).toEqual({
      currency: 'AUD',
      totalMinor: 20001,
      // Two members, rounded
      perPersonMinor: 10001,
      perPersonSource: 'items',
      breakdown: [
        { category: 'food', minor: 8001 },
        { category: 'activity', minor: 12000 },
      ],
      others: [
        {
          currency: 'JPY',
          totalMinor: 500,
          perPersonMinor: 250,
          breakdown: [{ category: 'transport', minor: 500 }],
        },
        {
          currency: 'NZD',
          totalMinor: 31500,
          perPersonMinor: 15750,
          breakdown: [
            { category: 'lodging', minor: 30000 },
            { category: 'activity', minor: 1500 },
          ],
        },
      ],
    })
    expect(body.trip.estimatedPerPersonMinor).toBe(10001)
  })

  it('hideMoney removes the estimate, pick prices and every other money field', async () => {
    const s = await seed()
    await call('POST', `${s.base}/lodgings`, s.token, {
      ...LODGING,
      priceMinor: 30000,
      currency: 'AUD',
    })
    await wish(s, { category: 'eat', name: 'Pie', estMinor: 777, currency: 'NZD' })
    const full = await getShare((await share(s.base, s.token)).shareToken)
    expect(full.body.estimate?.totalMinor).toBe(30000)
    expect(full.body.picks[0]).toMatchObject({ estMinor: 777, currency: 'NZD' })

    const hidden = await getShare((await share(s.base, s.token, { hideMoney: true })).shareToken)
    expect(hidden.body).not.toHaveProperty('estimate')
    expect(hidden.body.picks[0]).toEqual({ category: 'eat', name: 'Pie', votes: 0 })
    const keys = keysOf(hidden.body)
    for (const key of [
      'estimate',
      'estMinor',
      'costMinor',
      'currency',
      'baseCurrency',
      'estimatedPerPersonMinor',
      'totalMinor',
      'perPersonMinor',
    ]) {
      expect(keys.has(key), key).toBe(false)
    }
    const json = JSON.stringify(hidden.body)
    for (const amount of ['777', '30000', '1500']) expect(json).not.toContain(amount)
  })
})

describe('GET /api/share/:token, bookings summary (e8-t02)', () => {
  /** A lodging with a ref and a price, a flight across two zones, an undated activity */
  async function seedBookings() {
    const s = await seed()
    const lodging = await call('POST', `${s.base}/lodgings`, s.token, {
      ...LODGING,
      checkInTime: '15:00',
      checkOutTime: '10:00',
      ref: 'LHP-778',
      priceMinor: 30000,
      currency: 'NZD',
      payStatus: 'deposit',
    })
    expect(lodging.status).toBe(201)
    const flight = await call('POST', `${s.base}/bookings`, s.token, {
      type: 'flight',
      title: 'NZ 102 Sydney – Christchurch',
      details: { airline: 'Air NZ', flightNo: 'NZ102', fromAirport: 'SYD', toAirport: 'CHC' },
      startLocal: '2026-12-20T07:05',
      startTz: 'Australia/Sydney',
      endLocal: '2026-12-20T12:20',
      endTz: 'Pacific/Auckland',
      ref: 'X7Q2PL',
      priceMinor: 45900,
      currency: 'AUD',
      payStatus: 'paid',
    })
    expect(flight.status, JSON.stringify(flight.body)).toBe(201)
    const activity = await call('POST', `${s.base}/bookings`, s.token, {
      type: 'activity',
      title: 'Stargazing tour',
      details: {},
    })
    expect(activity.status, JSON.stringify(activity.body)).toBe(201)
    return s
  }

  it('lists lodgings and bookings by local start, undated last, with refs, prices and status', async () => {
    const s = await seedBookings()
    const { body } = await getShare((await share(s.base, s.token)).shareToken)
    expect(body.bookings).toEqual([
      {
        kind: 'flight',
        title: 'NZ 102 Sydney – Christchurch',
        // Each end in the zone it was entered in
        startDate: '2026-12-20',
        startTime: '07:05',
        endDate: '2026-12-20',
        endTime: '12:20',
        ref: 'X7Q2PL',
        priceMinor: 45900,
        currency: 'AUD',
        payStatus: 'paid',
      },
      {
        kind: 'lodging',
        title: 'Lakeview Holiday Park',
        startDate: '2026-12-20',
        startTime: '15:00',
        endDate: '2026-12-22',
        endTime: '10:00',
        ref: 'LHP-778',
        priceMinor: 30000,
        currency: 'NZD',
        payStatus: 'deposit',
      },
      { kind: 'activity', title: 'Stargazing tour', payStatus: 'unpaid' },
    ])
  })

  it('hideAddresses removes refs; hideMoney removes prices; both keep the rows', async () => {
    const s = await seedBookings()
    const noRefs = await getShare((await share(s.base, s.token, { hideAddresses: true })).shareToken)
    expect(noRefs.body.bookings).toHaveLength(3)
    expect(noRefs.body.bookings.some((b) => 'ref' in b)).toBe(false)
    expect(noRefs.body.bookings[0]).toMatchObject({ priceMinor: 45900, currency: 'AUD' })

    const noMoney = await getShare((await share(s.base, s.token, { hideMoney: true })).shareToken)
    expect(noMoney.body.bookings[0]).toMatchObject({ ref: 'X7Q2PL', payStatus: 'paid' })
    for (const b of noMoney.body.bookings) {
      expect(b).not.toHaveProperty('priceMinor')
      expect(b).not.toHaveProperty('currency')
    }

    const hidden = await getShare(
      (await share(s.base, s.token, { hideMoney: true, hideAddresses: true })).shareToken,
    )
    expect(hidden.body.bookings.map((b) => b.kind)).toEqual(['flight', 'lodging', 'activity'])
    const keys = keysOf(hidden.body.bookings)
    for (const key of ['ref', 'priceMinor', 'currency']) expect(keys.has(key), key).toBe(false)
    const json = JSON.stringify(hidden.body)
    for (const secret of ['X7Q2PL', 'LHP-778', '45900', '30000']) {
      expect(json).not.toContain(secret)
    }
  })

  it('sends an empty list when the trip has no lodgings or bookings', async () => {
    const s = await seed()
    const { body } = await getShare((await share(s.base, s.token)).shareToken)
    expect(body.bookings).toEqual([])
  })
})

describe('share payload helpers', () => {
  it('buildEstimate: nothing priced, no estimate; only other currencies, no base totals', () => {
    expect(buildEstimate([], 'AUD', 2)).toBeUndefined()
    expect(buildEstimate([{ category: 'food', minor: 300, currency: 'NZD' }], 'AUD', 0)).toEqual({
      currency: 'AUD',
      breakdown: [],
      others: [
        {
          currency: 'NZD',
          totalMinor: 300,
          perPersonMinor: 300,
          breakdown: [{ category: 'food', minor: 300 }],
        },
      ],
    })
  })

  it('overnightLines: skips days without points and keeps the line continuous', () => {
    const a = { lat: -43, lng: 172, name: 'A' }
    const b = { lat: -44, lng: 170, name: 'B' }
    const c = { lat: -45, lng: 168, name: 'C' }
    const lines = overnightLines([
      { dayIndex: 3, first: c, last: c },
      { dayIndex: 1, first: a, last: b },
      { dayIndex: 2 },
    ])
    expect(lines.map((l) => [l.dayIndex, l.from.lat, l.to.lat])).toEqual([
      [1, -43, -44],
      [3, -44, -45],
    ])
  })
})
