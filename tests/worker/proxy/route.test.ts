import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  GeoUsageResponse,
  RouteRequest,
  RouteResponse,
  RoutesResponse,
} from '../../../shared/api/geo.ts'
import { estimateLeg } from '../../../shared/itinerary/legs.ts'
import { resetOrsPause, simplifyLine } from '../../../worker/proxy/route.ts'
import { createHarness, createTrip, jsonResponse, restoreDeps, type Harness } from './helpers.ts'

const queenstown = { lat: -45.0317416, lng: 168.6594621 }
const arrowtown = { lat: -44.9416, lng: 168.8338 }
const wanaka = { lat: -44.7032, lng: 169.1321 }

/** A wiggly 1,000-point line from Queenstown to Arrowtown */
function longLine(): [number, number][] {
  return Array.from({ length: 1000 }, (_, i) => {
    const t = i / 999
    return [
      queenstown.lng + (arrowtown.lng - queenstown.lng) * t + Math.sin(i / 5) * 0.001,
      queenstown.lat + (arrowtown.lat - queenstown.lat) * t,
    ]
  })
}

const orsBody = (coordinates: unknown[] = longLine()) => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { summary: { distance: 20512.4, duration: 1210.6 } },
      geometry: { type: 'LineString', coordinates },
    },
  ],
})

let h: Harness
let trip: Awaited<ReturnType<typeof createTrip>>

beforeEach(async () => {
  resetOrsPause()
  h = createHarness({ ORS_API_KEY: 'test-key' })
  trip = await createTrip(h)
})
afterEach(restoreDeps)

const route = (body: unknown, token = trip.member) =>
  h.call<RouteResponse>('POST', `/api/trips/${trip.tripId}/geo/route`, { token, body })

const orsUsage = () =>
  h.sqlite.prepare("SELECT count FROM apiUsage WHERE provider = 'ors'").all()[0]?.count ?? 0

describe('route', () => {
  it('routes through ORS, simplifies the geometry and caches it', async () => {
    h.on('api.openrouteservice.org', () => jsonResponse(orsBody()))
    const res = await route({ from: queenstown, to: arrowtown, mode: 'drive' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      distanceM: 20512,
      durationS: 1211,
      source: 'ors',
      cached: false,
    })
    expect(res.body.geometry.type).toBe('LineString')
    const coords = res.body.geometry.coordinates
    expect(coords.length).toBeLessThanOrEqual(200)
    expect(coords.length).toBeGreaterThan(2)
    expect(coords[0]).toEqual([168.65946, -45.03174])
    const end = longLine().at(-1)!
    expect(coords.at(-1)).toEqual([Math.round(end[0] * 1e5) / 1e5, Math.round(end[1] * 1e5) / 1e5])

    const call = h.calls[0]
    expect(call.url).toBe('https://api.openrouteservice.org/v2/directions/driving-car/geojson')
    expect(call.init?.method).toBe('POST')
    expect(new Headers(call.init?.headers).get('authorization')).toBe('test-key')
    expect(JSON.parse(String(call.init?.body))).toEqual({
      coordinates: [
        [queenstown.lng, queenstown.lat],
        [arrowtown.lng, arrowtown.lat],
      ],
    })
    expect(orsUsage()).toBe(1)

    // Same leg (equal to 5 decimals): routeCache, no fetch, not counted
    const again = await route({
      from: { lat: -45.031741, lng: 168.659462 },
      to: arrowtown,
      mode: 'drive',
    })
    expect(again.body).toMatchObject({
      distanceM: 20512,
      durationS: 1211,
      source: 'ors',
      cached: true,
    })
    expect(again.body.geometry).toEqual(res.body.geometry)
    expect(h.calls).toHaveLength(1)
    expect(orsUsage()).toBe(1)

    // Another mode is another route
    await route({ from: queenstown, to: arrowtown, mode: 'walk' })
    expect(h.calls[1].url).toContain('/foot-walking/')
  })

  it('falls back to the estimate on ORS 429 and does not cache it', async () => {
    h.on('api.openrouteservice.org', () => jsonResponse({ error: 'quota' }, 429))
    const req: RouteRequest = { from: queenstown, to: wanaka, mode: 'drive' }
    const res = await route(req)
    const expected = estimateLeg(queenstown, wanaka, 'drive')
    expect(res.body).toEqual({
      ...expected,
      geometry: {
        type: 'LineString',
        coordinates: [
          [168.65946, -45.03174],
          [169.1321, -44.7032],
        ],
      },
      source: 'estimate',
      cached: false,
      fallbackReason: 'quota',
    })
    expect(h.sqlite.prepare('SELECT * FROM routeCache').all()).toHaveLength(0)
    // ORS is paused for a minute after a 429: no further calls meanwhile
    await route({ from: queenstown, to: arrowtown, mode: 'drive' })
    expect(h.calls).toHaveLength(1)
  })

  it('estimates on other ORS failures', async () => {
    h.on('api.openrouteservice.org', () => jsonResponse({ error: { code: 2010 } }, 404))
    const res = await route({ from: queenstown, to: wanaka, mode: 'cycle' })
    expect(res.body).toMatchObject({ source: 'estimate', fallbackReason: 'provider_error' })
    expect(res.body.distanceM).toBe(estimateLeg(queenstown, wanaka, 'cycle').distanceM)
  })

  it('estimates without calling anything when ORS_API_KEY is missing', async () => {
    h = createHarness()
    trip = await createTrip(h)
    const res = await route({ from: queenstown, to: wanaka, mode: 'walk' })
    expect(res.body).toMatchObject({
      ...estimateLeg(queenstown, wanaka, 'walk'),
      source: 'estimate',
      fallbackReason: 'no_key',
    })
    expect(h.calls).toHaveLength(0)
  })

  it('stops calling ORS after 300 calls for the trip today', async () => {
    h.on('api.openrouteservice.org', () =>
      jsonResponse(
        orsBody([
          [168.6, -45],
          [168.7, -44.9],
        ]),
      ),
    )
    h.sqlite
      .prepare(
        "INSERT INTO apiUsage (date, provider, tripId, count) VALUES ('2026-11-09', 'ors', ?, 299)",
      )
      .all(trip.tripId)
    expect((await route({ from: queenstown, to: arrowtown, mode: 'drive' })).body.source).toBe(
      'ors',
    )
    expect(orsUsage()).toBe(300)
    const over = await route({ from: queenstown, to: wanaka, mode: 'drive' })
    expect(over.body).toMatchObject({ source: 'estimate', fallbackReason: 'quota' })
    expect(h.calls).toHaveLength(1)
    expect(orsUsage()).toBe(300)
    // Cached legs still come back as routes
    expect((await route({ from: queenstown, to: arrowtown, mode: 'drive' })).body.cached).toBe(true)
    // A new UTC day starts a new count
    h.clock.now += 24 * 3600 * 1000
    expect((await route({ from: queenstown, to: wanaka, mode: 'drive' })).body.source).toBe('ors')
  })

  it('validates the body and requires a member', async () => {
    expect((await route({ from: queenstown, to: wanaka, mode: 'transit' })).status).toBe(422)
    expect((await route({ from: { lat: 95, lng: 0 }, to: wanaka, mode: 'drive' })).status).toBe(422)
    const anon = await h.call('POST', `/api/trips/${trip.tripId}/geo/route`, {
      body: { from: queenstown, to: wanaka, mode: 'drive' },
    })
    expect(anon.status).toBe(401)
  })
})

describe('routes batch', () => {
  it('answers up to 30 legs in order; cache hits and repeats are not counted', async () => {
    h.on('api.openrouteservice.org', () =>
      jsonResponse(
        orsBody([
          [168.6, -45],
          [168.7, -44.9],
        ]),
      ),
    )
    await route({ from: queenstown, to: arrowtown, mode: 'drive' })
    expect(orsUsage()).toBe(1)
    const legs = [
      { from: queenstown, to: arrowtown, mode: 'drive' },
      { from: arrowtown, to: wanaka, mode: 'drive' },
      { from: arrowtown, to: wanaka, mode: 'drive' },
    ]
    const res = await h.call<RoutesResponse>('POST', `/api/trips/${trip.tripId}/geo/routes`, {
      token: trip.member,
      body: { legs },
    })
    expect(res.status).toBe(200)
    expect(res.body.routes.map((r) => [r.source, r.cached])).toEqual([
      ['ors', true],
      ['ors', false],
      ['ors', false],
    ])
    expect(h.calls).toHaveLength(2)
    expect(orsUsage()).toBe(2)

    const tooMany = await h.call('POST', `/api/trips/${trip.tripId}/geo/routes`, {
      token: trip.member,
      body: { legs: Array.from({ length: 31 }, () => legs[0]) },
    })
    expect(tooMany.status).toBe(422)
  })
})

describe('usage', () => {
  it('shows today’s counts and the limits to the owner only', async () => {
    h.on('api.openrouteservice.org', () =>
      jsonResponse(
        orsBody([
          [168.6, -45],
          [168.7, -44.9],
        ]),
      ),
    )
    h.on('photon.komoot.io', () => jsonResponse({ type: 'FeatureCollection', features: [] }))
    h.on('nominatim', () => jsonResponse([]))
    await route({ from: queenstown, to: arrowtown, mode: 'drive' })
    await h.call('GET', `/api/trips/${trip.tripId}/geo/search?q=nowhere`, { token: trip.member })
    h.sqlite
      .prepare(
        "INSERT INTO apiUsage (date, provider, tripId, count) VALUES ('2026-11-09', 'ors', 'other', 5)",
      )
      .all()
    const res = await h.call<GeoUsageResponse>('GET', `/api/trips/${trip.tripId}/geo/usage`, {
      token: trip.owner,
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      date: '2026-11-09',
      trip: { photon: 1, nominatim: 1, ors: 1 },
      all: { photon: 1, nominatim: 1, ors: 6 },
      limits: { orsPerTripPerDay: 300, orsPerDay: 2000, geoPerMemberPerMinute: 30 },
      orsConfigured: true,
    })
    const member = await h.call('GET', `/api/trips/${trip.tripId}/geo/usage`, {
      token: trip.member,
    })
    expect(member.status).toBe(403)
  })
})

describe('simplifyLine', { timeout: 30_000 }, () => {
  it('keeps short lines and both ends of long ones', () => {
    const short: [number, number][] = [
      [0, 0],
      [1, 1],
    ]
    expect(simplifyLine(short)).toBe(short)
    const line = longLine()
    const out = simplifyLine(line, 50)
    expect(out.length).toBeLessThanOrEqual(50)
    expect(out[0]).toEqual(line[0])
    expect(out.at(-1)).toEqual(line.at(-1))
    // Zig-zag noise that RDP cannot drop still ends up within the limit (even sampling)
    const noise = Array.from({ length: 6000 }, (_, i): [number, number] => [i * 1e-3, i % 2])
    expect(simplifyLine(noise).length).toBeLessThanOrEqual(200)
  })
})
