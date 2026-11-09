// D1-backed fixed-window rate limits (e11-t04, docs/PRD/e11-platform-security-ops.md, DEPLOY.md §12).
// One table, `rateLimits (key, bucket, count)`: `bucket` is the window's start in epoch minutes, so
// one-minute and one-hour windows share the table and old rows are dropped by a single DELETE.
//
// Best effort by design: D1 has no cross-statement locks, so concurrent requests can overshoot a
// limit by a few; and when D1 itself fails the request is allowed (and the failure logged once per
// isolate) rather than taking the app down with the limiter.

import { ApiError, errorResponse } from '../http.ts'
import type { Handler, RouteContext } from '../router.ts'
import { bearerToken, hashToken, isTokenShaped } from '../auth.ts'
import { proxyDeps } from '../proxy/deps.ts'

/** The clock, swappable in tests. Defaults to the proxies' clock so that one clock drives every
 * window (the proxies' own per-member limits share this table) */
export const limiterDeps = { now: () => proxyDeps.now() }

export interface WindowLimit {
  /** Requests allowed per window */
  limit: number
  /** Window length in seconds: a whole number of minutes */
  windowS: number
}

/** Rows older than the longest window are dropped on the way */
const LONGEST_WINDOW_MIN = 60

export const MINUTE = 60
export const HOUR = 3600

/** The limits applied in worker/app.ts (DEPLOY.md §12 mirrors this table) */
export const LIMITS = {
  /** POST /api/trips: unauthenticated, per client IP */
  tripCreate: { limit: 10, windowS: HOUR },
  /** POST /api/join/:token: per client IP */
  join: { limit: 20, windowS: HOUR },
  /** GET /api/share/:token: per client IP */
  share: { limit: 120, windowS: MINUTE },
  /** GET /api/media/*: per client IP (a photo wall loads many thumbnails) */
  media: { limit: 600, windowS: MINUTE },
  /** POST/PUT/PATCH/DELETE /api/trips/:id/*: per member token */
  write: { limit: 120, windowS: MINUTE },
} as const satisfies Record<string, WindowLimit>

export function rateLimited(retryAfterS: number, message: string): ApiError {
  return new ApiError(429, 'rate_limited', message, { retryAfterS })
}

let loggedFailure = false

/** Test hook: forget that a D1 failure was already logged */
export function resetLimiterLog(): void {
  loggedFailure = false
}

function describeWindow({ limit, windowS }: WindowLimit): string {
  if (windowS === MINUTE) return `at most ${limit} requests per minute`
  if (windowS === HOUR) return `at most ${limit} requests per hour`
  return `at most ${limit} requests per ${windowS} s`
}

/**
 * Counts one request against `key` in the current window; throws 429 `rate_limited`
 * (details.retryAfterS) past the limit. Allows the request when D1 fails.
 */
export async function enforceLimit(
  db: D1Database,
  key: string,
  window: WindowLimit,
  now = limiterDeps.now(),
): Promise<void> {
  const windowMin = Math.max(1, Math.round(window.windowS / 60))
  const nowMin = Math.floor(now / 60_000)
  const bucket = nowMin - (nowMin % windowMin)
  let count: number
  try {
    const results = await db.batch<{ count: number }>([
      db
        .prepare('DELETE FROM rateLimits WHERE bucket < ?')
        .bind(nowMin - Math.max(LONGEST_WINDOW_MIN, windowMin)),
      db
        .prepare(
          `INSERT INTO rateLimits (key, bucket, count) VALUES (?, ?, 1)
           ON CONFLICT (key, bucket) DO UPDATE SET count = rateLimits.count + 1
           RETURNING count`,
        )
        .bind(key, bucket),
    ])
    count = Number(results[1]?.results[0]?.count ?? 1)
  } catch (error) {
    if (!loggedFailure) {
      loggedFailure = true
      console.error(JSON.stringify({ event: 'rate_limit_unavailable', error: String(error) }))
    }
    return
  }
  if (count > window.limit) {
    const retryAfterS = Math.max(1, Math.ceil(((bucket + windowMin) * 60_000 - now) / 1000))
    throw rateLimited(retryAfterS, describeWindow(window))
  }
}

/** A 429 error response with its Retry-After header */
export function rateLimitedResponse(error: ApiError): Response {
  const response = errorResponse(error)
  const details = error.details as { retryAfterS?: number } | undefined
  response.headers.set('retry-after', String(details?.retryAfterS ?? 60))
  return response
}

/** The client IP as Cloudflare reports it; one shared bucket when it is missing (local dev) */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
}

/** A short, non-reversible key for a member token (the limiter never stores tokens) */
async function tokenKey(token: string): Promise<string> {
  return (await hashToken(token)).slice(0, 32)
}

const LOOPBACK = new Set(['127.0.0.1', '::1'])

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * The limit (key + window) for a matched route, or null when it has none here. Proxies and upload
 * signing keep their own per-member limits inside their handlers (worker/proxy/limits.ts).
 */
export async function limitFor(
  request: Request,
  pathname: string,
): Promise<{ key: string; window: WindowLimit } | null> {
  const method = request.method
  const parts = pathname.split('/').filter(Boolean) // ['api', ...]
  const ip = clientIp(request)
  const perIp = (name: string, window: WindowLimit) =>
    // Loopback only happens locally (miniflare reports 127.0.0.1; Cloudflare never does): one
    // developer's e2e run would otherwise share a single 10-per-hour bucket
    LOOPBACK.has(ip) ? null : { key: `ip:${name}:${ip}`, window }
  if (method === 'POST' && parts.length === 2 && parts[1] === 'trips')
    return perIp('trip-create', LIMITS.tripCreate)
  if (method === 'POST' && parts[1] === 'join') return perIp('join', LIMITS.join)
  if (method === 'GET' && parts[1] === 'share') return perIp('share', LIMITS.share)
  if (method === 'GET' && parts[1] === 'media') return perIp('media', LIMITS.media)
  if (WRITE_METHODS.has(method) && parts[1] === 'trips' && parts.length >= 3) {
    const token = bearerToken(request)
    // No or malformed token: the handler answers 401 without touching D1, nothing to count
    if (!token || !isTokenShaped(token)) return null
    return { key: `member:write:${await tokenKey(token)}`, window: LIMITS.write }
  }
  return null
}

/** Applies `limitFor` before the handler; the 429 it throws becomes `rateLimitedResponse` in
 * worker/app.ts, like every 429 a handler throws */
export function withRateLimit(handler: Handler): Handler {
  return async (c: RouteContext) => {
    const rule = await limitFor(c.request, c.url.pathname)
    if (rule) await enforceLimit(c.env.DB, rule.key, rule.window)
    return handler(c)
  }
}
