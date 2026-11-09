// GET /api/trips/:id/geo/usage (owner): today's provider calls for the trip and across all trips,
// with the configured limits. Feeds the usage page (E11).

import { GEO_LIMITS, type GeoUsageResponse, type UsageProvider } from '../../shared/api/geo.ts'
import { authTrip } from '../auth.ts'
import { json } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { proxyDeps } from './deps.ts'
import { utcDate } from './limits.ts'

const providers: UsageProvider[] = ['photon', 'nominatim', 'ors']

function counts(rows: { provider: string; n: number }[]): Record<UsageProvider, number> {
  const out = { photon: 0, nominatim: 0, ors: 0 }
  for (const r of rows) {
    if ((providers as string[]).includes(r.provider)) out[r.provider as UsageProvider] = Number(r.n)
  }
  return out
}

export async function geoUsage(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'owner', { allowArchived: true })
  const date = utcDate(proxyDeps.now())
  const [trip, all] = await c.env.DB.batch<{ provider: string; n: number }>([
    c.env.DB.prepare(
      'SELECT provider, count AS n FROM apiUsage WHERE date = ? AND tripId = ?',
    ).bind(date, auth.trip.id),
    c.env.DB.prepare(
      'SELECT provider, SUM(count) AS n FROM apiUsage WHERE date = ? GROUP BY provider',
    ).bind(date),
  ])
  const body: GeoUsageResponse = {
    date,
    trip: counts(trip.results),
    all: counts(all.results),
    limits: GEO_LIMITS,
    orsConfigured: Boolean(c.env.ORS_API_KEY),
  }
  return json(body)
}
