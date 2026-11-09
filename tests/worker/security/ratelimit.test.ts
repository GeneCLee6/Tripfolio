import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiErrorBody } from '../../../shared/api/types.ts'
import { ApiError } from '../../../worker/http.ts'
import {
  enforceLimit,
  LIMITS,
  limitFor,
  resetLimiterLog,
} from '../../../worker/security/ratelimit.ts'
import { createFakeD1 } from '../fake-d1.ts'
import { createHarness, restoreClock, setupTrip, tripBody, type Harness } from './helpers.ts'

// e11-t04: the D1 fixed-window limiter and the limits worker/app.ts applies (DEPLOY.md §12)

const T0 = Date.parse('2026-11-09T10:00:00Z')

describe('enforceLimit', () => {
  it('counts per key in fixed windows and resets at the window edge', async () => {
    const { db } = createFakeD1()
    const w = { limit: 2, windowS: 60 }
    await enforceLimit(db, 'k', w, T0 + 10_000)
    await enforceLimit(db, 'k', w, T0 + 20_000)
    const error = await enforceLimit(db, 'k', w, T0 + 45_000).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 429, code: 'rate_limited', details: { retryAfterS: 15 } })
    // Another key has its own window
    await enforceLimit(db, 'other', w, T0 + 45_000)
    // The next minute starts over
    await enforceLimit(db, 'k', w, T0 + 60_000)
  })

  it('aligns hour windows to the hour and reports the time left in it', async () => {
    const { db } = createFakeD1()
    const w = { limit: 1, windowS: 3600 }
    await enforceLimit(db, 'h', w, T0 + 5 * 60_000)
    const error = await enforceLimit(db, 'h', w, T0 + 50 * 60_000).catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 429, details: { retryAfterS: 600 } })
    expect((error as Error).message).toBe('at most 1 requests per hour')
    await enforceLimit(db, 'h', w, T0 + 60 * 60_000)
  })

  it('keeps hour windows when minute windows clean up', async () => {
    const { db } = createFakeD1()
    const hour = { limit: 1, windowS: 3600 }
    await enforceLimit(db, 'h', hour, T0)
    // A minute-window request 59 minutes later must not drop the hour row
    await enforceLimit(db, 'm', { limit: 5, windowS: 60 }, T0 + 59 * 60_000)
    await expect(enforceLimit(db, 'h', hour, T0 + 59 * 60_000)).rejects.toThrow('per hour')
  })

  it('allows the request when D1 fails, and logs it once', async () => {
    resetLimiterLog()
    const broken = {
      prepare: () => ({ bind: () => ({}) }),
      batch: async () => {
        throw new Error('D1 down')
      },
    } as unknown as D1Database
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await enforceLimit(broken, 'k', { limit: 0, windowS: 60 }, T0)
    await enforceLimit(broken, 'k', { limit: 0, windowS: 60 }, T0)
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0]?.[0])).toContain('rate_limit_unavailable')
    log.mockRestore()
  })
})

describe('limitFor', () => {
  const req = (method: string, path: string, headers: Record<string, string> = {}) =>
    limitFor(new Request(`https://x.test${path}`, { method, headers }), path)
  const token = 'A'.repeat(22)
  const bearer = { authorization: `Bearer ${token}` }

  it('maps routes to their limits', async () => {
    const ip = { 'cf-connecting-ip': '192.0.2.9' }
    expect(await req('POST', '/api/trips', ip)).toEqual({
      key: 'ip:trip-create:192.0.2.9',
      window: LIMITS.tripCreate,
    })
    expect((await req('POST', '/api/join/x', ip))?.window).toBe(LIMITS.join)
    expect(await req('GET', '/api/join/x', ip)).toBeNull()
    expect((await req('GET', '/api/share/x', ip))?.window).toBe(LIMITS.share)
    expect((await req('GET', '/api/media/x/thumb', ip))?.window).toBe(LIMITS.media)
    expect(await req('GET', '/api/trips', ip)).toBeNull()
    expect(await req('GET', '/api/trips/t1/days', bearer)).toBeNull()
    const write = await req('PATCH', '/api/trips/t1', bearer)
    expect(write?.window).toBe(LIMITS.write)
    // Keyed by a hash prefix, never the token itself
    expect(write?.key).toMatch(/^member:write:[0-9a-f]{32}$/)
    expect(write?.key).not.toContain(token)
    // No or malformed token: the handler answers 401 without D1, nothing to count
    expect(await req('POST', '/api/trips/t1/stops')).toBeNull()
    expect(await req('POST', '/api/trips/t1/stops', { authorization: 'Bearer short' })).toBeNull()
  })

  it('skips per-IP limits for loopback (local dev) but keeps per-member ones', async () => {
    for (const ip of ['127.0.0.1', '::1']) {
      expect(await req('POST', '/api/trips', { 'cf-connecting-ip': ip })).toBeNull()
      expect(await req('GET', '/api/share/x', { 'cf-connecting-ip': ip })).toBeNull()
      const write = await req('PATCH', '/api/trips/t1', { ...bearer, 'cf-connecting-ip': ip })
      expect(write?.window).toBe(LIMITS.write)
    }
    // No header at all (not behind Cloudflare): one shared bucket, still limited
    expect((await req('POST', '/api/trips'))?.key).toBe('ip:trip-create:unknown')
  })
})

describe('route limits', () => {
  let h: Harness
  beforeEach(() => {
    h = createHarness()
  })
  afterEach(restoreClock)

  function expect429(response: { status: number; body: unknown; headers: Headers }): number {
    expect(response.status).toBe(429)
    const body = response.body as ApiErrorBody
    expect(body.error.code).toBe('rate_limited')
    const retry = (body.error.details as { retryAfterS: number }).retryAfterS
    expect(retry).toBeGreaterThan(0)
    expect(response.headers.get('retry-after')).toBe(String(retry))
    expect(response.headers.get('cache-control')).toBe('no-store')
    return retry
  }

  const createTrip = (ip: string) => h.call('POST', '/api/trips', { body: tripBody, ip })

  it('POST /api/trips: 10 per hour per client IP', async () => {
    for (let i = 0; i < LIMITS.tripCreate.limit; i++)
      expect((await createTrip('192.0.2.1')).status).toBe(201)
    expect(expect429(await createTrip('192.0.2.1'))).toBe(3600)
    // Another IP is not affected; the next hour starts over
    expect((await createTrip('192.0.2.2')).status).toBe(201)
    h.clock.now += 3600_000
    expect((await createTrip('192.0.2.1')).status).toBe(201)
  })

  it('POST /api/join/:token: 20 per hour per IP (unknown tokens count too)', async () => {
    const join = () =>
      h.call('POST', `/api/join/${'z'.repeat(22)}`, { body: { name: 'A' }, ip: '192.0.2.3' })
    for (let i = 0; i < LIMITS.join.limit; i++) expect((await join()).status).toBe(404)
    expect429(await join())
  })

  it('GET /api/share/:token: 120 per minute per IP', async () => {
    const s = await setupTrip(h)
    const share = () => h.call('GET', `/api/share/${s.shareToken}`, { ip: '192.0.2.4' })
    for (let i = 0; i < LIMITS.share.limit; i++) expect((await share()).status).toBe(200)
    expect(expect429(await share())).toBe(60)
    h.clock.now += 60_000
    expect((await share()).status).toBe(200)
  })

  it('GET /api/media/*: 600 per minute per IP', async () => {
    for (let i = 0; i < LIMITS.media.limit; i++)
      expect((await h.call('GET', '/api/media/nope', { ip: '192.0.2.5' })).status).toBe(401)
    expect429(await h.call('GET', '/api/media/nope/thumb', { ip: '192.0.2.5' }))
  })

  it('authenticated writes: 120 per minute per member; reads are not counted', async () => {
    const s = await setupTrip(h)
    // setupTrip's own owner writes (invites, members, shares) already count
    const rows = h.sqlite
      .prepare('SELECT key, count FROM rateLimits WHERE key LIKE ?')
      .all('member:write:%')
    const used = Math.max(...rows.map((r) => Number(r.count)))
    for (let i = used; i < LIMITS.write.limit; i++) {
      const patched = await h.call('PATCH', s.base, {
        token: s.owner,
        body: { name: `Tokyo ${i}` },
      })
      expect(patched.status).toBe(200)
    }
    expect429(await h.call('PATCH', s.base, { token: s.owner, body: { name: 'x' } }))
    expect((await h.call('POST', `${s.base}/invites`, { token: s.owner })).status).toBe(429)
    // Reads still work; another member still writes
    expect((await h.call('GET', s.base, { token: s.owner })).status).toBe(200)
    const other = await h.call('PATCH', `${s.base}/members/nope`, { token: s.editor, body: {} })
    expect(other.status).not.toBe(429)
    h.clock.now += 60_000
    expect((await h.call('PATCH', s.base, { token: s.owner, body: { name: 'y' } })).status).toBe(
      200,
    )
  })

  it('keeps the 60 per minute upload-signing limit', async () => {
    const s = await setupTrip(h)
    const sign = () =>
      h.call('POST', `${s.base}/attachments/sign`, {
        token: s.editor,
        body: { kind: 'photo', mime: 'image/webp', bytes: 10 },
      })
    for (let i = 0; i < 60; i++) expect((await sign()).status).toBe(201)
    expect429(await sign())
  })
})
