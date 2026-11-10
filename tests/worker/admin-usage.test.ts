import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminUsageResponse } from '../../shared/api/admin.ts'
import { handleRequest } from '../../worker/app.ts'
import { CF_GRAPHQL_URL, collectWarnings, doGbSeconds, pctOf } from '../../worker/admin/usage.ts'
import {
  createHarness,
  createTrip,
  jsonResponse,
  restoreDeps,
  type Harness,
} from './proxy/helpers.ts'

// e11-t05: GET /api/admin/usage — the ADMIN_KEY gate, the aggregation and the 80 % warnings.

const KEY = 'test-admin-key-0123456789'
let h: Harness
beforeEach(() => {
  h = createHarness({ ADMIN_KEY: KEY } as never)
})
afterEach(() => {
  restoreDeps()
  vi.restoreAllMocks()
})

const usage = (key = KEY) =>
  h.call<AdminUsageResponse>('GET', `/api/admin/usage?key=${encodeURIComponent(key)}`)

const exec = (sql: string, ...params: unknown[]) => h.sqlite.prepare(sql).all(...params)

describe('pure helpers', () => {
  it('rounds percentages to one decimal and guards a zero limit', () => {
    expect(pctOf(80, 100)).toBe(80)
    expect(pctOf(1, 3)).toBe(33.3)
    expect(pctOf(5, 0)).toBe(0)
    expect(pctOf(-3, 10)).toBe(0)
  })
  it('warns from exactly 80 %, flags over 100 %, largest first', () => {
    expect(
      collectWarnings([
        ['r2', 79.9],
        ['external.ors', 80],
        ['d1Writes', 120],
      ]),
    ).toEqual([
      { metric: 'd1Writes', pct: 120, over: true },
      { metric: 'external.ors', pct: 80, over: false },
    ])
  })
  it('converts DO seconds to GB-s at 128 MB', () => {
    expect(doGbSeconds(8)).toBe(1)
  })
})

describe('GET /api/admin/usage gate', () => {
  it('is 503 admin_disabled while ADMIN_KEY is unset', async () => {
    const bare = createHarness()
    const res = await bare.call<{ error: { code: string } }>('GET', '/api/admin/usage?key=x')
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('admin_disabled')
  })
  it('is 403 without or with a wrong key', async () => {
    expect((await h.call('GET', '/api/admin/usage')).status).toBe(403)
    expect((await usage('nope')).status).toBe(403)
    expect((await usage(`${KEY}x`)).status).toBe(403)
  })
  it('limits each IP to 10 per minute, wrong guesses included', async () => {
    const call = (key: string) =>
      handleRequest(
        new Request(`https://trip.test/api/admin/usage?key=${key}`, {
          headers: { 'cf-connecting-ip': '203.0.113.9' },
        }),
        h.env,
      )
    for (let i = 0; i < 9; i++) expect((await call('wrong')).status).toBe(403)
    expect((await call(KEY)).status).toBe(200)
    const limited = await call(KEY)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
  })
})

describe('aggregation', () => {
  it('adds up apiUsage, attachments, trips and rows, with warnings at 80 %', async () => {
    const { tripId } = await createTrip(h)
    const second = await createTrip(h)
    const date = '2026-11-09' // the harness clock
    // ors: 1,700 of 2,000 across two trips (85 %); photon 10; yesterday is ignored
    exec(
      `INSERT INTO apiUsage (date, provider, tripId, count) VALUES (?, 'ors', ?, 1000)`,
      date,
      tripId,
    )
    exec(
      `INSERT INTO apiUsage (date, provider, tripId, count) VALUES (?, 'ors', ?, 700)`,
      date,
      second.tripId,
    )
    exec(
      `INSERT INTO apiUsage (date, provider, tripId, count) VALUES (?, 'photon', ?, 10)`,
      date,
      tripId,
    )
    exec(
      `INSERT INTO apiUsage (date, provider, tripId, count) VALUES ('2026-11-08', 'fx', '*', 99)`,
    )
    // fx today: 100 of 100 → over? no, exactly 100 % is a warning, not over
    exec(`INSERT INTO apiUsage (date, provider, tripId, count) VALUES (?, 'fx', '*', 100)`, date)
    const addAttachment = (id: string, trip: string, bytes: number, thumb: number | null) =>
      exec(
        `INSERT INTO attachments
           (id, tripId, kind, mime, bytes, thumbBytes, r2Key, status, createdAt, updatedAt, uploaderMemberId)
         SELECT ?, ?, 'photo', 'image/webp', ?, ?, ?, 'ready', '2026-11-09T00:00:00Z', '2026-11-09T00:00:00Z', id
           FROM members WHERE tripId = ? LIMIT 1`,
        id,
        trip,
        bytes,
        thumb,
        `k/${id}`,
        trip,
      )
    addAttachment('a1', tripId, 3000, 100)
    addAttachment('a2', tripId, 1000, null)
    addAttachment('a3', second.tripId, 500, 50)
    // Lifecycle: archive the second trip; a third soft-deleted 5 days ago, a fourth 40 days ago
    exec(`UPDATE trips SET archivedAt = '2026-11-01T00:00:00Z' WHERE id = ?`, second.tripId)
    const third = await createTrip(h)
    const fourth = await createTrip(h)
    exec(`UPDATE trips SET deletedAt = '2026-11-04T00:00:00Z' WHERE id = ?`, third.tripId)
    exec(`UPDATE trips SET deletedAt = '2026-09-30T00:00:00Z' WHERE id = ?`, fourth.tripId)

    const res = await usage()
    expect(res.status).toBe(200)
    const body = res.body
    expect(body.date).toBe(date)
    expect(body.external.ors).toEqual({ today: 1700, limit: 2000, pct: 85 })
    expect(body.external.photon.today).toBe(10)
    expect(body.external.fx).toEqual({ today: 100, limit: 100, pct: 100 })
    expect(body.external.nominatim.today).toBe(0)
    expect(body.r2.bytes).toBe(4650)
    expect(body.r2.limitBytes).toBe(10 * 1024 ** 3)
    expect(body.r2.byTrip.map((t) => [t.tripId, t.bytes])).toEqual([
      [tripId, 4100],
      [second.tripId, 550],
    ])
    expect(body.r2.byTrip[0]?.name).toBe('NZ South Island')
    expect(body.trips).toEqual({ active: 1, archived: 1, deleted: 1, pendingPurge: 1 })
    expect(body.d1.rows.trips).toBe(4)
    expect(body.d1.rows.attachments).toBe(3)
    expect(body.d1.rows.apiUsage).toBe(5)
    // apiUsage counts today (1,810) are part of the write estimate
    expect(body.d1.estimatedWritesToday).toBeGreaterThanOrEqual(1810)
    expect(body.d1.limitWrites).toBe(100_000)
    expect(body.cf).toBeNull()
    expect(body.cfStatus).toBe('unconfigured')
    expect(body.warnings).toEqual([
      { metric: 'external.fx', pct: 100, over: false },
      { metric: 'external.ors', pct: 85, over: false },
    ])
  })

  it('reads Cloudflare analytics when the token and account are set', async () => {
    const cfHarness = createHarness({
      ADMIN_KEY: KEY,
      CF_ANALYTICS_TOKEN: 'cf-token',
      CF_ACCOUNT_ID: 'acc123',
    } as never)
    cfHarness.on(CF_GRAPHQL_URL, () =>
      jsonResponse({
        data: {
          viewer: {
            accounts: [
              {
                workersInvocationsAdaptive: [{ sum: { requests: 85_000 } }],
                d1AnalyticsAdaptiveGroups: [
                  { sum: { rowsRead: 1000, rowsWritten: 20 } },
                  { sum: { rowsRead: 500, rowsWritten: 5 } },
                ],
                durableObjectsPeriodicGroups: [{ sum: { activeTime: 3_600_000_000 } }],
              },
            ],
          },
        },
        errors: null,
      }),
    )
    const res = await cfHarness.call<AdminUsageResponse>('GET', `/api/admin/usage?key=${KEY}`)
    expect(res.body.cfStatus).toBe('ok')
    expect(res.body.cf).toEqual({
      requests24h: 85_000,
      d1Reads: 1500,
      d1Writes: 25,
      doDuration: 3600,
    })
    expect(res.body.warnings).toEqual([{ metric: 'cf.requests', pct: 85, over: false }])
    const sent = JSON.parse(String(cfHarness.calls[0]?.init?.body)) as {
      variables: Record<string, string>
    }
    expect(sent.variables.account).toBe('acc123')
    expect(sent.variables.sinceDate).toBe('2026-11-08')
    expect(new Headers(cfHarness.calls[0]?.init?.headers).get('authorization')).toBe(
      'Bearer cf-token',
    )
  })

  it('keeps answering when Cloudflare fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const cfHarness = createHarness({
      ADMIN_KEY: KEY,
      CF_ANALYTICS_TOKEN: 'cf-token',
      CLOUDFLARE_ACCOUNT_ID: 'acc123',
    } as never)
    cfHarness.on(CF_GRAPHQL_URL, () =>
      jsonResponse({ data: null, errors: [{ message: 'denied' }] }),
    )
    const res = await cfHarness.call<AdminUsageResponse>('GET', `/api/admin/usage?key=${KEY}`)
    expect(res.status).toBe(200)
    expect(res.body.cf).toBeNull()
    expect(res.body.cfStatus).toBe('error')
  })

  it('logs a usage_warning line when something is at 80 %', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    exec(
      `INSERT INTO apiUsage (date, provider, tripId, count) VALUES ('2026-11-09', 'og', 't', 900)`,
    )
    await usage()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"usage_warning"'))
  })
})
