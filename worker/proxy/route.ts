// Routing (e3-t04): OpenRouteService directions, cached permanently in routeCache (mode + from/to
// rounded to 5 decimals). Without ORS_API_KEY, past the quota (300 calls per trip per day, 2,000 in
// all), or when ORS fails, the answer is shared/itinerary/legs.ts estimateLeg with a straight line.

import { z } from 'zod'
import {
  GEO_LIMITS,
  routeModes,
  type GeoPoint,
  type LineStringGeometry,
  type RouteMode,
  type RouteRequest,
  type RouteResponse,
  type RoutesResponse,
} from '../../shared/api/geo.ts'
import { estimateLeg } from '../../shared/itinerary/legs.ts'
import { latitude, longitude } from '../../shared/schema/common.ts'
import { authTrip } from '../auth.ts'
import type { Env } from '../env.ts'
import { json, readBody } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { nowIsoFrom, providerHeaders, proxyDeps } from './deps.ts'
import { reserveUsage } from './limits.ts'

export const DEFAULT_ORS_URL = 'https://api.openrouteservice.org'

const TIMEOUT_MS = 8000
const ORS_PROFILE: Record<RouteMode, string> = {
  drive: 'driving-car',
  walk: 'foot-walking',
  cycle: 'cycling-regular',
}

const point = z.object({ lat: latitude, lng: longitude })
const routeRequestSchema = z.object({ from: point, to: point, mode: z.enum(routeModes) })
const routesRequestSchema = z.object({
  legs: z.array(routeRequestSchema).min(1).max(GEO_LIMITS.routesPerBatch),
})

/** After ORS answers 429 (per-minute or daily quota) or 403, skip it for a while (per isolate) */
let orsPausedUntil = 0

/** Test hook: forget the pause */
export function resetOrsPause(): void {
  orsPausedUntil = 0
}

const fixed5 = (n: number) => n.toFixed(5)
const round5 = (n: number) => Math.round(n * 1e5) / 1e5

export function routeKey(r: RouteRequest): string {
  return `${r.mode}|${fixed5(r.from.lat)},${fixed5(r.from.lng)}|${fixed5(r.to.lat)},${fixed5(r.to.lng)}`
}

// --- Geometry -----------------------------------------------------------------------------------

type Coord = [number, number]

function perpendicularDistance(p: Coord, a: Coord, b: Coord): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Ramer–Douglas–Peucker in degrees (iterative, keeps both ends) */
function rdp(coords: Coord[], epsilon: number): Coord[] {
  const keep = new Uint8Array(coords.length)
  keep[0] = 1
  keep[coords.length - 1] = 1
  const stack: [number, number][] = [[0, coords.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()!
    let maxDist = 0
    let index = -1
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(coords[i], coords[start], coords[end])
      if (d > maxDist) {
        maxDist = d
        index = i
      }
    }
    if (index !== -1 && maxDist > epsilon) {
      keep[index] = 1
      stack.push([start, index], [index, end])
    }
  }
  return coords.filter((_, i) => keep[i] === 1)
}

/** Every k-th point so that at most `maxPoints` remain, keeping both ends */
function sampleEvenly(coords: Coord[], maxPoints: number): Coord[] {
  if (coords.length <= maxPoints) return coords
  const step = (coords.length - 1) / (maxPoints - 1)
  return Array.from({ length: maxPoints }, (_, i) => coords[Math.round(i * step)])
}

/**
 * At most `maxPoints` points: RDP with a doubling tolerance from 1e-5° (~1 m) up to ~0.04° (~4 km),
 * then even sampling as a last resort. Very long inputs are thinned first (RDP's worst case is
 * quadratic).
 */
export function simplifyLine(
  coords: Coord[],
  maxPoints: number = GEO_LIMITS.geometryMaxPoints,
): Coord[] {
  if (coords.length <= maxPoints) return coords
  const input = sampleEvenly(coords, 4000)
  let out = input
  for (let epsilon = 1e-5, i = 0; i < 12; epsilon *= 2, i++) {
    out = rdp(input, epsilon)
    if (out.length <= maxPoints) return out
  }
  return sampleEvenly(out, maxPoints)
}

function straightLine(from: GeoPoint, to: GeoPoint): LineStringGeometry {
  return {
    type: 'LineString',
    coordinates: [
      [round5(from.lng), round5(from.lat)],
      [round5(to.lng), round5(to.lat)],
    ],
  }
}

function estimate(r: RouteRequest, reason: RouteResponse['fallbackReason']): RouteResponse {
  const { distanceM, durationS } = estimateLeg(r.from, r.to, r.mode)
  return {
    distanceM,
    durationS,
    geometry: straightLine(r.from, r.to),
    source: 'estimate',
    cached: false,
    fallbackReason: reason,
  }
}

// --- ORS ----------------------------------------------------------------------------------------

class OrsQuotaError extends Error {}

interface OrsBody {
  features?: {
    geometry?: { coordinates?: unknown }
    properties?: { summary?: { distance?: number; duration?: number } }
  }[]
}

export function normaliseOrs(body: unknown): Omit<RouteResponse, 'source' | 'cached'> {
  const feature = (body as OrsBody)?.features?.[0]
  const raw = feature?.geometry?.coordinates
  if (!feature || !Array.isArray(raw)) throw new Error('ors: no route feature')
  const coords: Coord[] = []
  for (const c of raw as unknown[]) {
    if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number')
      coords.push([round5(c[0]), round5(c[1])])
  }
  if (coords.length < 2) throw new Error('ors: geometry too short')
  const summary = feature.properties?.summary ?? {}
  return {
    // ORS leaves out distance/duration for a zero-length route
    distanceM: Math.round(summary.distance ?? 0),
    durationS: Math.round(summary.duration ?? 0),
    geometry: { type: 'LineString', coordinates: simplifyLine(coords) },
  }
}

async function callOrs(env: Env, r: RouteRequest, origin: string) {
  const base = (env.ORS_URL || DEFAULT_ORS_URL).replace(/\/+$/, '')
  const response = await proxyDeps.fetch(`${base}/v2/directions/${ORS_PROFILE[r.mode]}/geojson`, {
    method: 'POST',
    headers: {
      ...providerHeaders(origin),
      accept: 'application/geo+json, application/json',
      'content-type': 'application/json',
      authorization: env.ORS_API_KEY ?? '',
    },
    body: JSON.stringify({
      coordinates: [
        [r.from.lng, r.from.lat],
        [r.to.lng, r.to.lat],
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (response.status === 429 || response.status === 403) {
    orsPausedUntil = proxyDeps.now() + (response.status === 429 ? 60_000 : 600_000)
    throw new OrsQuotaError(`ors: HTTP ${response.status}`)
  }
  if (!response.ok) throw new Error(`ors: HTTP ${response.status}`)
  return normaliseOrs(await response.json())
}

// --- Resolve ------------------------------------------------------------------------------------

export async function resolveRoute(
  env: Env,
  tripId: string,
  r: RouteRequest,
  origin: string,
): Promise<RouteResponse> {
  const db = env.DB
  const key = routeKey(r)
  const row = await db
    .prepare('SELECT distanceM, durationS, geometry FROM routeCache WHERE key = ?')
    .bind(key)
    .first<{ distanceM: number; durationS: number; geometry: string }>()
  if (row) {
    return {
      distanceM: Number(row.distanceM),
      durationS: Number(row.durationS),
      geometry: JSON.parse(row.geometry) as LineStringGeometry,
      source: 'ors',
      cached: true,
    }
  }
  if (!env.ORS_API_KEY) return estimate(r, 'no_key')
  if (proxyDeps.now() < orsPausedUntil) return estimate(r, 'quota')
  const reserved = await reserveUsage(
    db,
    tripId,
    'ors',
    GEO_LIMITS.orsPerTripPerDay,
    GEO_LIMITS.orsPerDay,
  )
  if (!reserved) return estimate(r, 'quota')
  try {
    const route = await callOrs(env, r, origin)
    await db
      .prepare(
        `INSERT OR REPLACE INTO routeCache
           (key, mode, provider, distanceM, durationS, geometry, createdAt)
         VALUES (?, ?, 'ors', ?, ?, ?, ?)`,
      )
      .bind(
        key,
        r.mode,
        route.distanceM,
        route.durationS,
        JSON.stringify(route.geometry),
        nowIsoFrom(proxyDeps.now()),
      )
      .run()
    return { ...route, source: 'ors', cached: false }
  } catch (error) {
    console.warn('route: ORS failed, estimating', error)
    return estimate(r, error instanceof OrsQuotaError ? 'quota' : 'provider_error')
  }
}

/** POST /api/trips/:id/geo/route { from, to, mode } (any member) */
export async function geoRoute(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'viewer')
  const body = await readBody(c.request, routeRequestSchema)
  return json(await resolveRoute(c.env, auth.trip.id, body, c.url.origin))
}

/** POST /api/trips/:id/geo/routes { legs: [...≤ 30] } → { routes } in the same order */
export async function geoRoutes(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'viewer')
  const { legs } = await readBody(c.request, routesRequestSchema)
  const seen = new Map<string, RouteResponse>()
  const routes: RouteResponse[] = []
  // One at a time: ORS also limits calls per minute, and repeated legs are only resolved once
  for (const leg of legs) {
    const key = routeKey(leg)
    let route = seen.get(key)
    if (!route) {
      route = await resolveRoute(c.env, auth.trip.id, leg, c.url.origin)
      seen.set(key, route)
    }
    routes.push(route)
  }
  const body: RoutesResponse = { routes }
  return json(body)
}
