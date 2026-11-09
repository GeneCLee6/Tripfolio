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
import { createFakeD1 } from './fake-d1.ts'

// GET /api/share/:token (e8-t01a): the filtered payload of the read-only share page

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
  return { trip, token, days, base, stops: { a, b, c, backup, late } }
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
