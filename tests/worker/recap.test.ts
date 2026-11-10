import { beforeEach, describe, expect, it } from 'vitest'
import type { RecapPutResponse, RecapResponse, SharePayload } from '../../shared/api/share.ts'
import type { CreateShareResponse, CreateTripResponse } from '../../shared/api/types.ts'
import { handleRequest } from '../../worker/app.ts'
import type { Env } from '../../worker/env.ts'
import { withBudget } from '../../worker/share.ts'
import { nightlyShares } from '../../worker/trips/recap.ts'
import { createFakeD1 } from './fake-d1.ts'

// Recap mode (e8-t04): GET /recap aggregation, PUT /days/:dayId/recap, the share page's recap
// section (showRecap after the end date, never money), and the budget-based share estimate (E9).

let env: Env
let sqlite: ReturnType<typeof createFakeD1>['sqlite']

beforeEach(() => {
  const fake = createFakeD1()
  sqlite = fake.sqlite
  env = { DB: fake.db, APP_VERSION: 'test' } as unknown as Env
})

type Json = Record<string, unknown>

async function call<T = Json>(method: string, path: string, token?: string, body?: unknown) {
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
  return { status: response.status, body: (await response.json()) as T }
}

/** A two-day trip: past by default (it has ended), or in the future */
async function seed(when: 'past' | 'future' = 'past') {
  const [startDate, endDate] =
    when === 'past' ? ['2025-03-01', '2025-03-02'] : ['2030-03-01', '2030-03-02']
  const created = await call<CreateTripResponse>('POST', '/api/trips', undefined, {
    name: 'Tekapo weekend',
    destination: 'New Zealand',
    startDate,
    endDate,
    tz: 'Pacific/Auckland',
    baseCurrency: 'AUD',
    localCurrencies: ['NZD'],
    owner: { name: 'Gene', color: 'teal' },
  })
  expect(created.status).toBe(201)
  const { trip, memberToken: token, days, member } = created.body
  const base = `/api/trips/${trip.id}`
  const req = async (method: string, path: string, body?: unknown, as = token) => {
    const res = await call<Json>(method, `${base}${path}`, as, body)
    expect(res.status, `${path} ${JSON.stringify(res.body)}`).toBeLessThan(300)
    return res.body
  }
  return { trip, token, days, base, memberId: member.id, req }
}
type Seeded = Awaited<ReturnType<typeof seed>>

function photo(s: Seeded, id: string, dayId: string, takenAt: string, visibility = 'trip') {
  sqlite.exec(
    `INSERT INTO attachments (id, tripId, kind, r2Key, thumbKey, mime, bytes, takenAt, dayId,
       uploaderMemberId, visibility, status, createdAt, updatedAt)
     VALUES ('${id}', '${s.trip.id}', 'photo', 'k/${id}', 'k/${id}.t', 'image/webp', 10,
       '${takenAt}', '${dayId}', '${s.memberId}', '${visibility}', 'ready',
       '2026-11-09T00:00:00Z', '2026-11-09T00:00:00Z')`,
  )
}

function expense(s: Seeded, id: string, date: string, baseMinor: number, deleted = false) {
  sqlite.exec(
    `INSERT INTO expenses (id, tripId, payerMemberId, amountMinor, currency, fxRate, fxSource,
       baseMinor, date, category, splitMethod, createdByMemberId, createdAt, updatedAt, deletedAt)
     VALUES ('${id}', '${s.trip.id}', '${s.memberId}', ${baseMinor}, 'AUD', 1, 'base', ${baseMinor},
       '${date}', 'food', 'self', '${s.memberId}', '2026-11-09T00:00:00Z', '2026-11-09T00:00:00Z',
       ${deleted ? "'2026-11-09T00:00:00Z'" : 'NULL'})`,
  )
}

/** A viewer with a token of their own */
async function viewer(s: Seeded): Promise<string> {
  const kid = (await s.req('POST', '/members', { name: 'Kid', color: 'sun', role: 'viewer' }))
    .member as Json
  const invite = await s.req('POST', '/invites', {})
  const joined = await call<Json>('POST', `/api/join/${String(invite.inviteToken)}`, undefined, {
    memberId: kid.id,
  })
  expect(joined.status).toBe(201)
  return String(joined.body.memberToken)
}

async function share(s: Seeded, options: object = {}) {
  const res = await call<CreateShareResponse>('POST', `${s.base}/shares`, s.token, { options })
  expect(res.status).toBe(201)
  return res.body.shareToken
}
const getShare = async (token: string) =>
  (await call<SharePayload>('GET', `/api/share/${token}`)).body

describe('GET /api/trips/:id/recap (e8-t04)', () => {
  it('sums planned cost per day (stops, lodging nights, bookings) against spending', async () => {
    const s = await seed()
    const [d1] = s.days
    sqlite.exec(`UPDATE trips SET fxOverrides = '{"NZD":0.9}' WHERE id = '${s.trip.id}'`)
    const cost = (title: string, costMinor: number, currency: string) =>
      s.req('POST', '/stops', { dayId: d1.id, title, costMinor, currency })
    await cost('Hot pools', 2000, 'AUD')
    await cost('Cruise', 3000, 'NZD')
    await cost('Sushi', 500, 'JPY')
    await s.req('POST', '/stops', {
      dayId: d1.id,
      title: 'Museum',
      isBackup: true,
      costMinor: 999,
      currency: 'AUD',
    })
    await s.req('POST', '/lodgings', {
      name: 'Lakeside Motel',
      checkIn: '2025-03-01',
      checkOut: '2025-03-03',
      priceMinor: 10001,
      currency: 'AUD',
    })
    await s.req('POST', '/bookings', {
      type: 'activity',
      title: 'Stargazing',
      details: {},
      startAt: '2025-03-02T08:00:00.000Z',
      priceMinor: 4000,
      currency: 'AUD',
    })
    expense(s, 'e1', '2025-03-01', 1500)
    expense(s, 'e2', '2025-03-02', 2500)
    expense(s, 'e3', '2025-03-02', 700)
    expense(s, 'e4', '2025-03-02', 100000, true)
    expense(s, 'e5', '2025-02-20', 9999)
    photo(s, 'p2', d1.id, '2025-03-01T05:00:00Z')
    photo(s, 'p1', d1.id, '2025-03-01T01:00:00Z', 'members-only')

    const res = await call<RecapResponse>('GET', `${s.base}/recap`, s.token)
    expect(res.status).toBe(200)
    expect(res.body.baseCurrency).toBe('AUD')
    expect(res.body.ended).toBe(true)
    const [day1, day2] = res.body.days
    expect(day1).toMatchObject({
      dayId: d1.id,
      index: 1,
      date: '2025-03-01',
      // 2000 + 3000 NZD × 0.9 + the first night (10001 over 2 nights: 5001 + 5000)
      estimateMinor: 2000 + 2700 + 5001,
      unconverted: [{ currency: 'JPY', minor: 500 }],
      actualMinor: 1500,
      photoIds: ['p1', 'p2'],
    })
    expect(day1).not.toHaveProperty('recapBody')
    expect(day2).toMatchObject({ estimateMinor: 5000 + 4000, unconverted: [], actualMinor: 3200 })
    expect(res.body.totals).toEqual({
      estimateMinor: 9701 + 9000,
      actualMinor: 4700,
      otherActualMinor: 9999,
    })
  })

  it('says whether the trip has ended', async () => {
    const s = await seed('future')
    const res = await call<RecapResponse>('GET', `${s.base}/recap`, s.token)
    expect(res.body.ended).toBe(false)
    expect(res.body.days.map((d) => d.estimateMinor)).toEqual([0, 0])
  })

  it('nightlyShares splits a price over its nights, remainder first', () => {
    expect(nightlyShares(1000, '2025-03-01', '2025-03-04')).toEqual([
      { date: '2025-03-01', minor: 334 },
      { date: '2025-03-02', minor: 333 },
      { date: '2025-03-03', minor: 333 },
    ])
    expect(nightlyShares(500, '2025-03-01', '2025-03-01')).toEqual([
      { date: '2025-03-01', minor: 500 },
    ])
  })
})

describe('PUT /api/trips/:id/days/:dayId/recap (e8-t04)', () => {
  it('writes, replaces and clears a day’s recap; editors only', async () => {
    const s = await seed()
    const day = s.days[0]
    const path = `${s.base}/days/${day.id}/recap`
    const put = await call<RecapPutResponse>('PUT', path, s.token, { body: 'Lake walk.\n\n' })
    expect(put.status).toBe(200)
    expect(put.body).toMatchObject({ dayId: day.id, body: 'Lake walk.' })
    await call('PUT', path, s.token, { body: 'Lake walk, then pies.' })
    let recap = (await call<RecapResponse>('GET', `${s.base}/recap`, s.token)).body
    expect(recap.days[0].recapBody).toBe('Lake walk, then pies.')
    expect(recap.days[0].recapUpdatedAt).toEqual(expect.any(String))

    const kid = await viewer(s)
    expect((await call('PUT', path, kid, { body: 'Mine' })).status).toBe(403)
    expect((await call('GET', `${s.base}/recap`, kid)).status).toBe(200)
    expect((await call('PUT', path, undefined, { body: 'x' })).status).toBe(401)
    expect((await call('PUT', path, s.token, { body: 'x'.repeat(4001) })).status).toBe(422)
    expect((await call('PUT', `${s.base}/days/nope/recap`, s.token, { body: 'x' })).status).toBe(
      404,
    )

    const cleared = await call<RecapPutResponse>('PUT', path, s.token, { body: '   ' })
    expect(cleared.body.body).toBe('')
    recap = (await call<RecapResponse>('GET', `${s.base}/recap`, s.token)).body
    expect(recap.days[0]).not.toHaveProperty('recapBody')
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM dayRecaps').all()[0].n).toBe(0)
  })
})

describe('share page recap and estimate (e8-t04, E9)', () => {
  async function withRecap(s: Seeded) {
    const [d1, d2] = s.days
    await s.req('PUT', `/days/${d1.id}/recap`, { body: 'Stars over the lake.' })
    for (let i = 1; i <= 11; i++)
      photo(s, `p${String(i).padStart(2, '0')}`, d1.id, `2025-03-01T0${i % 10}:${10 + i}:00Z`)
    photo(s, 'secret', d2.id, '2025-03-02T01:00:00Z', 'members-only')
    await s.req('POST', '/stops', {
      dayId: d1.id,
      title: 'Pools',
      costMinor: 2000,
      currency: 'AUD',
    })
    expense(s, 'e1', '2025-03-01', 1500)
  }

  it('adds recap text and up to 9 shareable photos per day after the end', async () => {
    const s = await seed()
    await withRecap(s)
    const body = await getShare(await share(s, { showRecap: true }))
    const [day1, day2] = body.days
    expect(day1.recapBody).toBe('Stars over the lake.')
    expect(day1.recapPhotoIds).toHaveLength(9)
    expect(day1.photoIds).toHaveLength(3)
    expect(day2).not.toHaveProperty('recapBody')
    expect(day2.recapPhotoIds).toEqual([])
    expect(JSON.stringify(body)).not.toContain('secret')
    // Recap money stays in the app
    expect(JSON.stringify(body)).not.toContain('actualMinor')
    expect(JSON.stringify(body)).not.toContain('"1500')
  })

  it('leaves the recap out without showRecap, and before the trip has ended', async () => {
    const s = await seed()
    await withRecap(s)
    const off = await getShare(await share(s))
    expect(off.days[0]).not.toHaveProperty('recapBody')
    expect(off.days[0]).not.toHaveProperty('recapPhotoIds')

    const future = await seed('future')
    await future.req('PUT', `/days/${future.days[0].id}/recap`, { body: 'Plans' })
    const early = await getShare(await share(future, { showRecap: true }))
    expect(early.days[0]).not.toHaveProperty('recapBody')
    expect(early.days[0]).not.toHaveProperty('recapPhotoIds')
  })

  it('with hideMoney the recap keeps text and photos, and there are no amounts', async () => {
    const s = await seed()
    await withRecap(s)
    await s.req('PUT', '/budget', { rows: [{ category: 'food', plannedMinor: 30000 }] })
    const body = await getShare(await share(s, { showRecap: true, hideMoney: true }))
    expect(body.days[0].recapBody).toBe('Stars over the lake.')
    expect(body).not.toHaveProperty('estimate')
    expect(body.trip).not.toHaveProperty('estimatedPerPersonMinor')
    expect(JSON.stringify(body)).not.toMatch(/Minor/)
  })

  it('prefers the budget for the per-person estimate, else the priced items', async () => {
    const s = await seed()
    await s.req('POST', '/members', { name: 'Ana', color: 'coral' })
    await s.req('POST', '/stops', {
      dayId: s.days[0].id,
      title: 'Pools',
      costMinor: 2000,
      currency: 'AUD',
    })
    const before = await getShare(await share(s))
    expect(before.trip.estimatedPerPersonMinor).toBe(1000)
    expect(before.estimate).toMatchObject({ perPersonMinor: 1000, perPersonSource: 'items' })

    // food 300.00 each + lodging 900.00 for the group (two members: 450.00 each)
    await s.req('PUT', '/budget', {
      rows: [
        { category: 'food', plannedMinor: 30000, perPerson: true },
        { category: 'lodging', plannedMinor: 90000 },
      ],
    })
    const after = await getShare(await share(s))
    expect(after.trip.estimatedPerPersonMinor).toBe(75000)
    expect(after.estimate).toMatchObject({
      totalMinor: 2000,
      perPersonMinor: 75000,
      perPersonSource: 'budget',
      budgetTotalMinor: 150000,
    })
  })

  it('withBudget: a budget alone still makes an estimate', () => {
    expect(
      withBudget(undefined, { currency: 'AUD', perPersonMinor: 500, totalMinor: 1000 }, 'AUD'),
    ).toEqual({
      currency: 'AUD',
      breakdown: [],
      others: [],
      perPersonMinor: 500,
      budgetTotalMinor: 1000,
      perPersonSource: 'budget',
    })
    expect(withBudget(undefined, null, 'AUD')).toBeUndefined()
  })
})
