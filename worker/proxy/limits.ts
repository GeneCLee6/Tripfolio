// D1-backed bookkeeping shared by the proxies: daily apiUsage counts and quotas, per-member request
// limits, and the minimum interval between calls to a provider. All best effort: D1 has no
// cross-statement locks, so concurrent requests can overshoot a limit by a few. The request limiter
// itself lives in worker/security/ratelimit.ts (e11-t04); this module keeps its proxy-facing API.

import type { UsageProvider } from '../../shared/api/geo.ts'
import { ApiError } from '../http.ts'
import { enforceLimit, MINUTE, rateLimited, rateLimitedResponse } from '../security/ratelimit.ts'
import { proxyDeps } from './deps.ts'

/** The UTC day of an epoch-ms instant, YYYY-MM-DD */
export const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Adds n calls to today's apiUsage row for (provider, trip) */
export async function countUsage(
  db: D1Database,
  tripId: string,
  provider: UsageProvider,
  n = 1,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO apiUsage (date, provider, tripId, count) VALUES (?, ?, ?, ?)
       ON CONFLICT (date, provider, tripId) DO UPDATE SET count = apiUsage.count + excluded.count`,
    )
    .bind(utcDate(proxyDeps.now()), provider, tripId, n)
    .run()
}

/**
 * Reserves one call within the trip's daily limit and the provider's daily limit across all trips,
 * counting it in apiUsage. False (nothing counted) when either limit is used up.
 */
export async function reserveUsage(
  db: D1Database,
  tripId: string,
  provider: UsageProvider,
  perTripLimit: number,
  globalLimit: number,
): Promise<boolean> {
  const date = utcDate(proxyDeps.now())
  const total = await db
    .prepare('SELECT COALESCE(SUM(count), 0) AS n FROM apiUsage WHERE date = ? AND provider = ?')
    .bind(date, provider)
    .first<{ n: number }>()
  if (Number(total?.n ?? 0) >= globalLimit) return false
  const row = await db
    .prepare(
      `INSERT INTO apiUsage (date, provider, tripId, count) VALUES (?, ?, ?, 1)
       ON CONFLICT (date, provider, tripId) DO UPDATE SET count = apiUsage.count + 1
       WHERE apiUsage.count < ?
       RETURNING count`,
    )
    .bind(date, provider, tripId, perTripLimit)
    .first<{ count: number }>()
  return row !== null
}

export { rateLimited }

/**
 * Counts one request against `key` in the current one-minute window; throws 429 `rate_limited`
 * (details.retryAfterS) past `limit`. The shared fixed-window limiter (worker/security/ratelimit.ts)
 * on the proxies' clock; it allows the request when D1 fails.
 */
export async function enforceRateLimit(db: D1Database, key: string, limit: number): Promise<void> {
  await enforceLimit(db, key, { limit, windowS: MINUTE }, proxyDeps.now())
}

/**
 * Claims the provider's next call slot (at least `intervalMs` after the previous one, across every
 * isolate, via D1). Waits once for the slot when it is at most `maxWaitMs` away; false when busy.
 */
export async function claimSlot(
  db: D1Database,
  provider: string,
  intervalMs: number,
  maxWaitMs = 1500,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const now = proxyDeps.now()
    const claimed = await db
      .prepare(
        `INSERT INTO providerThrottle (provider, lastAt) VALUES (?, ?)
         ON CONFLICT (provider) DO UPDATE SET lastAt = excluded.lastAt
         WHERE providerThrottle.lastAt <= ?
         RETURNING lastAt`,
      )
      .bind(provider, now, now - intervalMs)
      .first()
    if (claimed) return true
    if (attempt > 0) break
    const last = await db
      .prepare('SELECT lastAt FROM providerThrottle WHERE provider = ?')
      .bind(provider)
      .first<{ lastAt: number }>()
    const wait = Number(last?.lastAt ?? 0) + intervalMs - now
    if (wait > maxWaitMs) break
    await proxyDeps.sleep(Math.max(0, wait))
  }
  return false
}

/** Handlers throw ApiError; a 429 also gets a Retry-After header */
export async function withRetryAfter(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) return rateLimitedResponse(error)
    throw error
  }
}
