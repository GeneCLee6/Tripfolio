// apiUsage for proxies whose handler does not count its own calls (e11-t04). geocode, route and fx
// count inside worker/proxy/*; the link preview (og) is counted here, from worker/app.ts.

import { ApiError } from '../http.ts'
import { utcDate } from '../proxy/limits.ts'
import type { Handler } from '../router.ts'
import { limiterDeps } from './ratelimit.ts'

/** Adds n calls to today's apiUsage row for (provider, trip); never throws */
export async function countApiUsage(
  db: D1Database,
  tripId: string,
  provider: string,
  n = 1,
  now = limiterDeps.now(),
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO apiUsage (date, provider, tripId, count) VALUES (?, ?, ?, ?)
         ON CONFLICT (date, provider, tripId) DO UPDATE SET count = apiUsage.count + excluded.count`,
      )
      .bind(utcDate(now), provider, tripId, n)
      .run()
  } catch (error) {
    console.warn(
      JSON.stringify({ event: 'api_usage_count_failed', provider, error: String(error) }),
    )
  }
}

/**
 * Counts one `provider` call for the route's trip (`:id`) when the handler went out to the network:
 * a 200, or a 502 from the provider. 4xx (auth, validation, URL refused, 429) never fetched.
 */
export function withUsageCount(provider: string, handler: Handler): Handler {
  return async (c) => {
    try {
      const response = await handler(c)
      if (response.status === 200 || response.status === 502)
        await countApiUsage(c.env.DB, c.params.id, provider)
      return response
    } catch (error) {
      // Handlers throw ApiError; the router turns it into the response
      if (error instanceof ApiError && error.status === 502)
        await countApiUsage(c.env.DB, c.params.id, provider)
      throw error
    }
  }
}
