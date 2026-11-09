import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  CreateInviteResponse,
  MemberTokenResponse,
  TripDetailResponse,
} from '../../../shared/api/types.ts'
import { CURRENCY_CODES } from '../../../shared/money/currencies.ts'
import type { ExpenseResponse } from '../../../shared/api/expenses.ts'
import type { MemberCreate } from '../../../shared/schema/member.ts'
import { ensureRate, fetchRates, FX_SOURCE, refreshAllBases } from '../../../worker/proxy/fx.ts'
import { createHarness, createTrip, jsonResponse, restoreDeps, type Harness } from './helpers.ts'

// Exchange rates (e7-t03): open.er-api.com → fxRates, daily cron, on-demand fill, refresh route

/** 2026-11-09 00:02:31 UTC, like the real provider */
const UPDATED_UNIX = 1794182551

function erApi(base: string, extra: Record<string, number> = {}) {
  const rates: Record<string, number> = { [base]: 1, XAU: 0.0002, BTN: 55.1 }
  CURRENCY_CODES.forEach((code, i) => {
    if (code !== base) rates[code] = code === 'IDR' ? 12444.859798 : 1 + i / 10
  })
  return {
    result: 'success',
    provider: 'https://www.exchangerate-api.com',
    time_last_update_unix: UPDATED_UNIX,
    time_last_update_utc: 'Mon, 09 Nov 2026 00:02:31 +0000',
    base_code: base,
    rates: { ...rates, ...extra },
  }
}

let h: Harness
let trip: Awaited<ReturnType<typeof createTrip>>
/** The default provider answers 500 while true */
let down: boolean

beforeEach(async () => {
  h = createHarness()
  trip = await createTrip(h)
  down = false
  h.on('open.er-api.com/v6/latest/', ({ url }) =>
    down ? new Response('down', { status: 500 }) : jsonResponse(erApi(url.split('/').pop()!)),
  )
})
afterEach(restoreDeps)

const rows = (base?: string) =>
  h.sqlite
    .prepare(
      `SELECT date, base, quote, rate, source FROM fxRates ${base ? 'WHERE base = ?' : ''} ORDER BY base, quote`,
    )
    .all(...(base ? [base] : []))
const fxUsage = () =>
  Number(
    h.sqlite
      .prepare("SELECT COALESCE(SUM(count), 0) AS n FROM apiUsage WHERE provider = 'fx'")
      .all()[0]?.n ?? 0,
  )

describe('fetchRates', () => {
  it('upserts every known quote, dated by time_last_update (UTC), and counts the call', async () => {
    const got = await fetchRates(h.env, 'AUD')
    expect(got).toEqual({ date: '2026-11-09', base: 'AUD', count: CURRENCY_CODES.length - 1 })
    expect(h.calls[0].url).toBe('https://open.er-api.com/v6/latest/AUD')
    const stored = rows('AUD')
    expect(stored).toHaveLength(CURRENCY_CODES.length - 1)
    expect(stored.map((r) => r.quote)).not.toContain('XAU')
    expect(stored.map((r) => r.quote)).not.toContain('AUD')
    expect(stored.find((r) => r.quote === 'IDR')).toEqual({
      date: '2026-11-09',
      base: 'AUD',
      quote: 'IDR',
      rate: 12444.859798,
      source: FX_SOURCE,
    })
    expect(fxUsage()).toBe(1)

    // a second fetch the same day replaces the rates, not duplicates them
    h.on('example.test/v6/latest/AUD', () => jsonResponse(erApi('AUD', { IDR: 12000 })))
    await fetchRates({ ...h.env, FX_API_URL: 'https://example.test/' }, 'AUD')
    expect(h.calls[1].url).toBe('https://example.test/v6/latest/AUD')
    expect(rows('AUD')).toHaveLength(CURRENCY_CODES.length - 1)
    expect(rows('AUD').find((r) => r.quote === 'IDR')?.rate).toBe(12000)
    expect(fxUsage()).toBe(2)
  })

  it('falls back to time_last_update_utc when the unix time is missing', async () => {
    const body = erApi('TWD') as Partial<ReturnType<typeof erApi>>
    delete body.time_last_update_unix
    body.time_last_update_utc = 'Sun, 08 Nov 2026 23:59:00 -0200'
    h.on('example.test', () => jsonResponse(body))
    const got = await fetchRates({ ...h.env, FX_API_URL: 'https://example.test' }, 'TWD')
    expect(got.date).toBe('2026-11-09')
  })

  it('throws on a provider failure and leaves the old rows', async () => {
    await fetchRates(h.env, 'AUD')
    const before = rows()
    const bad = [
      () => new Response('down', { status: 503 }),
      () => jsonResponse({ result: 'error', 'error-type': 'unsupported-code' }),
      () => jsonResponse({ ...erApi('NZD'), base_code: 'NZD' }),
      () => jsonResponse({ ...erApi('AUD'), rates: { XAU: 1 } }),
    ]
    for (const [i, respond] of bad.entries()) {
      h.on(`bad${i}.test`, respond)
      const env = { ...h.env, FX_API_URL: `https://bad${i}.test` }
      await expect(fetchRates(env, 'AUD')).rejects.toThrow()
    }
    expect(rows()).toEqual(before)
  })
})

describe('refreshAllBases', () => {
  it('fetches each distinct base of the live trips once, plus AUD and TWD', async () => {
    const id = () => crypto.randomUUID()
    // two more trips in NZD (one deleted) and one in JPY, one in an unknown currency
    const insert = (base: string, deleted: string | null) =>
      h.sqlite
        .prepare(
          `INSERT INTO trips (id, name, startDate, endDate, tz, baseCurrency, ownerMemberId,
             createdAt, updatedAt, deletedAt)
           SELECT ?, name, startDate, endDate, tz, ?, ownerMemberId, createdAt, updatedAt, ?
             FROM trips LIMIT 1`,
        )
        .all(id(), base, deleted)
    insert('JPY', null)
    insert('JPY', null)
    insert('CHF', '2026-11-01T00:00:00Z')
    insert('XXX', null)
    const done = await refreshAllBases(h.env)
    expect(done.map((d) => d.base).sort()).toEqual(['AUD', 'JPY', 'TWD'])
    expect(h.calls.map((c) => c.url.split('/').pop()).sort()).toEqual(['AUD', 'JPY', 'TWD'])
    expect(fxUsage()).toBe(3)
  })

  it('logs a failing base and keeps going', async () => {
    const h2 = createHarness()
    h2.on('/latest/AUD', () => new Response('nope', { status: 500 }))
    h2.on('/latest/TWD', () => jsonResponse(erApi('TWD')))
    const done = await refreshAllBases(h2.env)
    expect(done.map((d) => d.base)).toEqual(['TWD'])
  })
})

describe('ensureRate', () => {
  it('returns a stored row without fetching, in either direction', async () => {
    h.sqlite
      .prepare(
        "INSERT INTO fxRates (date, base, quote, rate, source) VALUES ('2026-11-05', 'NZD', 'AUD', 0.8, 'test')",
      )
      .all()
    const got = await ensureRate(h.env, { date: '2026-11-09', base: 'AUD', quote: 'NZD' })
    expect(got).toEqual({ date: '2026-11-05', rate: 1.25 })
    expect(h.calls).toHaveLength(0)
  })

  it('fills a missing rate on demand, at most once per base per hour', async () => {
    const got = await ensureRate(h.env, { date: '2026-11-09', base: 'AUD', quote: 'IDR' })
    expect(got).toEqual({ date: '2026-11-09', rate: 12444.859798 })
    expect(h.calls).toHaveLength(1)

    // a quote the provider lacks: no second call within the hour
    h.sqlite.prepare("DELETE FROM fxRates WHERE quote = 'KRW'").all()
    expect(await ensureRate(h.env, { date: '2026-11-09', base: 'AUD', quote: 'KRW' })).toBeNull()
    expect(h.calls).toHaveLength(1)
    // another base has its own slot
    expect(
      await ensureRate(h.env, { date: '2026-11-09', base: 'TWD', quote: 'KRW' }),
    ).not.toBeNull()
    expect(h.calls).toHaveLength(2)
    // an hour later AUD may fetch again
    h.clock.now += 60 * 60_000
    expect(
      await ensureRate(h.env, { date: '2026-11-09', base: 'AUD', quote: 'KRW' }),
    ).not.toBeNull()
    expect(h.calls).toHaveLength(3)
    expect(fxUsage()).toBe(3)
  })

  it('does not fetch for dates the latest rates cannot serve, or unknown currencies', async () => {
    expect(await ensureRate(h.env, { date: '2026-10-01', base: 'AUD', quote: 'NZD' })).toBeNull()
    expect(await ensureRate(h.env, { date: '2026-12-20', base: 'AUD', quote: 'NZD' })).toBeNull()
    expect(await ensureRate(h.env, { date: '2026-11-09', base: 'AUD', quote: 'XYZ' })).toBeNull()
    expect(h.calls).toHaveLength(0)
  })

  it('returns null and keeps old rows when the provider fails', async () => {
    h.sqlite
      .prepare(
        "INSERT INTO fxRates (date, base, quote, rate, source) VALUES ('2026-10-20', 'AUD', 'NZD', 1.1, 'test')",
      )
      .all()
    const env = { ...h.env, FX_API_URL: 'https://down.test' }
    h.on('down.test', () => {
      throw new TypeError('network down')
    })
    expect(await ensureRate(env, { date: '2026-11-09', base: 'AUD', quote: 'NZD' })).toBeNull()
    expect(rows()).toHaveLength(1)
  })
})

describe('POST /fx/refresh', () => {
  const refresh = (token?: string) =>
    h.call<{ date: string; count: number }>('POST', `/api/trips/${trip.tripId}/fx/refresh`, {
      token,
    })

  it('fetches the trip base for editors, 2 per minute per trip', async () => {
    const res = await refresh(trip.member)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ date: '2026-11-09', count: CURRENCY_CODES.length - 1 })
    expect(h.calls[0].url).toMatch(/\/v6\/latest\/AUD$/)
    const usage = h.sqlite.prepare("SELECT tripId, count FROM apiUsage WHERE provider = 'fx'").all()
    expect(usage).toEqual([{ tripId: trip.tripId, count: 1 }])

    expect((await refresh(trip.owner)).status).toBe(200)
    const limited = await refresh(trip.owner)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    h.clock.now += 60_000
    expect((await refresh(trip.owner)).status).toBe(200)
  })

  it('needs an editor; 502 when the provider fails', async () => {
    expect((await refresh()).status).toBe(401)
    const viewerBody: MemberCreate = { name: 'Kid', color: 'sky', email: null, role: 'viewer' }
    const base = `/api/trips/${trip.tripId}`
    const added = await h.call<{ member: { id: string } }>('POST', `${base}/members`, {
      token: trip.owner,
      body: viewerBody,
    })
    const invite = await h.call<CreateInviteResponse>('POST', `${base}/invites`, {
      token: trip.owner,
    })
    const viewer = await h.call<MemberTokenResponse>(
      'POST',
      `/api/join/${invite.body.inviteToken}`,
      {
        body: { memberId: added.body.member.id },
      },
    )
    expect((await refresh(viewer.body.memberToken)).status).toBe(403)

    h.env.FX_API_URL = 'https://down.test'
    h.on('down.test', () => new Response('down', { status: 500 }))
    const failed = await h.call<{ error: { code: string } }>('POST', `${base}/fx/refresh`, {
      token: trip.owner,
    })
    expect(failed.status).toBe(502)
    expect(failed.body.error.code).toBe('provider_error')
  })
})

describe('expense FX hook', () => {
  it('fills a missing rate on demand instead of answering 422', async () => {
    const tripRes = await h.call<TripDetailResponse>('GET', `/api/trips/${trip.tripId}`, {
      token: trip.owner,
    })
    const me = tripRes.body.members.find((m) => m.role === 'owner')!.id
    const post = (currency: string) =>
      h.call<ExpenseResponse & { error?: { code: string } }>(
        'POST',
        `/api/trips/${trip.tripId}/expenses`,
        {
          token: trip.owner,
          body: {
            amountMinor: 1244486,
            currency,
            date: '2026-11-09',
            category: 'food',
            payerMemberId: me,
            participants: [{ memberId: me }],
            splitMethod: 'equal',
          },
        },
      )
    const res = await post('IDR')
    expect(res.status).toBe(201)
    expect(res.body.expense).toMatchObject({ fxSource: 'auto', fxDate: '2026-11-09' })
    expect(res.body.expense.baseMinor).toBeGreaterThan(9900)
    expect(res.body.expense.baseMinor).toBeLessThan(10100)
    expect(h.calls).toHaveLength(1)

    // provider down and nothing stored for this base: still the 422 needsRate
    h.sqlite.prepare('DELETE FROM fxRates').all()
    h.sqlite.prepare('DELETE FROM providerThrottle').all()
    down = true
    const none = await post('NZD')
    expect(none.status).toBe(422)
    expect(none.body.error?.code).toBe('fx_unavailable')
    expect(h.calls).toHaveLength(2)
  })
})
