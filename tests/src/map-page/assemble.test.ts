import { describe, expect, it, vi } from 'vitest'
import type { RouteRequest, RouteResponse } from '../../../shared/api/geo.ts'
import type { DayWithStops, LegOverride, Place, Stop } from '../../../shared/api/types.ts'
import {
  buildTripMapData,
  chunk,
  FUEL_ID_PREFIX,
  localTime,
  MIN_LEG_M,
  pendingRouteBatches,
  placeName,
  resolveRoutes,
  routeCacheKey,
  routeModeFor,
  routesFromCache,
  type PlannedLeg,
  type RouteCache,
} from '../../../src/lib/map/assemble.ts'

const TZ = 'Pacific/Auckland'

function place(id: string, lat: number, lng: number, extra: Partial<Place> = {}): Place {
  return {
    id,
    tripId: 't1',
    nameLocal: `Local ${id}`,
    nameEn: `English ${id}`,
    lat,
    lng,
    address: '',
    category: 'sight',
    source: 'manual',
    hours: null,
    links: [],
    rev: 1,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...extra,
  }
}

function stop(id: string, dayId: string, order: number, extra: Partial<Stop> = {}): Stop {
  return {
    id,
    tripId: 't1',
    dayId,
    order,
    type: 'sight',
    title: '',
    placeId: null,
    startAt: null,
    endAt: null,
    durationMin: null,
    costMinor: null,
    currency: null,
    booking: 'none',
    note: '',
    links: [],
    wishlistItemId: null,
    bookingId: null,
    isBackup: false,
    rev: 1,
    updatedAt: '2026-11-01T00:00:00Z',
    ...extra,
  }
}

function day(
  id: string,
  idx: number | null,
  stops: Stop[],
  date: string | null = null,
): DayWithStops {
  return {
    id,
    tripId: 't1',
    date,
    idx,
    title: '',
    color: null,
    note: '',
    lodgingId: null,
    rev: 1,
    updatedAt: '2026-11-01T00:00:00Z',
    stops,
  }
}

// Around Queenstown: a few km apart
const places = [
  place('p1', -45.0312, 168.6626),
  place('p2', -45.0401, 168.7012),
  place('p3', -45.0659, 168.7315, { category: 'fuel' }),
  place('p4', -44.6999, 169.1321),
  place('p5', -44.6943, 169.1418),
  place('pocket', -45.0, 168.8, { nameEn: '' }),
]

const days = [
  day(
    'd1',
    1,
    [
      // Out of order on purpose: sorted by `order`
      stop('s2', 'd1', 2, { placeId: 'p2', startAt: '2026-12-01T22:30:00Z' }),
      stop('s1', 'd1', 1, { placeId: 'p1', title: 'Fergburger', startAt: '2026-12-01T20:00:00Z' }),
      stop('s3', 'd1', 3, { placeId: 'p3', type: 'fuel' }),
      stop('nowhere', 'd1', 4),
    ],
    '2026-12-02',
  ),
  day('d2', 2, [
    stop('s4', 'd2', 1, { placeId: 'p4' }),
    stop('backup', 'd2', 2, { placeId: 'p1', isBackup: true }),
    stop('s5', 'd2', 3, { placeId: 'p5' }),
  ]),
  day('unassigned', null, [stop('s9', 'unassigned', 1, { placeId: 'p2' })]),
]

describe('buildTripMapData', () => {
  const data = buildTripMapData(days, places, [], { tz: TZ, locale: 'zh-TW', style: 'self-drive' })

  it('keeps assigned days only, 0-based', () => {
    expect(data.days.map((d) => [d.id, d.dayIndex])).toEqual([
      ['d1', 0],
      ['d2', 1],
    ])
  })

  it('turns located stops into pins numbered by their place in the day', () => {
    expect(data.stops.map((s) => [s.id, s.dayIndex, s.order])).toEqual([
      ['s1', 0, 1],
      ['s2', 0, 2],
      ['s3', 0, 3],
      ['s4', 1, 1],
      ['backup', 1, 2],
      ['s5', 1, 3],
    ])
    const s1 = data.stops[0]!
    expect(s1).toMatchObject({ name: 'Fergburger', lat: -45.0312, lng: 168.6626, type: 'sight' })
    // No title: the place's name in the interface language
    expect(data.stops[1]!.name).toBe('Local p2')
  })

  it('shows start times in the trip zone (NZDT is UTC+13 in December)', () => {
    expect(data.stops[0]!.time).toBe('09:00')
    expect(data.stops[1]!.time).toBe('11:30')
    expect(data.stops[2]!.time).toBeNull()
  })

  it('uses English names in English when there are some', () => {
    const en = buildTripMapData(days, places, [], { tz: TZ, locale: 'en' })
    expect(en.stops[1]!.name).toBe('English p2')
    expect(en.pocket[0]!.name).toBe('Local pocket')
  })

  it('links the last stop of a day to the first of the next day', () => {
    expect(data.overnightLinks).toEqual([
      { dayIndex: 0, from: { lat: -45.0659, lng: 168.7315 }, to: { lat: -44.6999, lng: 169.1321 } },
    ])
  })

  it('skips days without located stops in the overnight chain', () => {
    const gap = [days[0]!, day('empty', 2, []), { ...days[1]!, idx: 3 }]
    const links = buildTripMapData(gap, places, [], { tz: TZ, locale: 'zh-TW' }).overnightLinks
    expect(links).toHaveLength(1)
    expect(links[0]!.dayIndex).toBe(0)
  })

  it('puts places no stop uses in the pocket list (unassigned days still count as references)', () => {
    expect(data.pocket.map((p) => p.id)).toEqual(['pocket'])
    expect(data.pocket[0]!.type).toBe('sight')
  })

  it('shows fuel and supplies stops on the fuel layer with their own ids', () => {
    expect(data.fuel).toEqual([
      {
        id: `${FUEL_ID_PREFIX}s3`,
        lat: -45.0659,
        lng: 168.7315,
        name: 'Local p3',
        type: 'fuel',
        dayIndex: 0,
      },
    ])
    expect(data.lodging).toEqual([])
    expect(data.picks).toEqual([])
  })

  it('plans legs between consecutive non-backup located stops', () => {
    expect(data.legs.map((l) => [l.key, l.dayIndex, l.mode, l.routeMode])).toEqual([
      ['s1>s2', 0, 'drive', 'drive'],
      ['s2>s3', 0, 'drive', 'drive'],
      ['s4>s5', 1, 'drive', 'drive'],
    ])
  })

  it('applies leg overrides and the campervan default', () => {
    const overrides: LegOverride[] = [
      {
        tripId: 't1',
        fromStopId: 's1',
        toStopId: 's2',
        mode: 'walk',
        minutes: null,
        rev: 1,
        updatedAt: '',
      },
      {
        tripId: 't1',
        fromStopId: 's2',
        toStopId: 's3',
        mode: 'ferry',
        minutes: null,
        rev: 1,
        updatedAt: '',
      },
    ]
    const legs = buildTripMapData(days, places, overrides, {
      tz: TZ,
      locale: 'zh-TW',
      style: 'campervan',
    }).legs
    expect(legs.map((l) => [l.mode, l.routeMode])).toEqual([
      ['walk', 'walk'],
      ['ferry', null],
      ['campervan', 'drive'],
    ])
  })

  it(`skips legs shorter than ${MIN_LEG_M} m`, () => {
    const near = [place('a', -45, 168), place('b', -45.0003, 168)] // ≈ 33 m
    const legs = buildTripMapData(
      [day('d', 1, [stop('x', 'd', 1, { placeId: 'a' }), stop('y', 'd', 2, { placeId: 'b' })])],
      near,
      [],
      { tz: TZ, locale: 'zh-TW' },
    ).legs
    expect(legs).toEqual([])
  })
})

describe('helpers', () => {
  it('placeName falls back to the local name', () => {
    expect(placeName({ nameLocal: '皇后鎮', nameEn: 'Queenstown' }, 'en')).toBe('Queenstown')
    expect(placeName({ nameLocal: '皇后鎮', nameEn: 'Queenstown' }, 'zh-TW')).toBe('皇后鎮')
    expect(placeName({ nameLocal: '皇后鎮', nameEn: ' ' }, 'en')).toBe('皇后鎮')
  })

  it('routeModeFor sends campervan as drive and never routes transit', () => {
    expect(routeModeFor('campervan')).toBe('drive')
    expect(routeModeFor('cycle')).toBe('cycle')
    expect(routeModeFor('transit')).toBeNull()
    expect(routeModeFor('flight')).toBeNull()
  })

  it('localTime survives bad input', () => {
    expect(localTime(null, TZ)).toBeNull()
    expect(localTime('nope', TZ)).toBeNull()
    expect(localTime('2026-12-01T20:00:00Z', 'Not/AZone')).toBeNull()
  })

  it('routeCacheKey matches the Worker rounding (5 decimals + mode)', () => {
    const key = routeCacheKey({
      from: { lat: -45.031234, lng: 168.6626 },
      to: { lat: 1, lng: 2 },
      mode: 'walk',
    })
    expect(key).toBe('walk|-45.03123,168.66260|1.00000,2.00000')
  })

  it('chunk splits evenly', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 30)).toEqual([])
  })
})

// ---- routes ----

function leg(i: number, extra: Partial<PlannedLeg> = {}): PlannedLeg {
  return {
    key: `a${i}>b${i}`,
    dayIndex: 0,
    fromStopId: `a${i}`,
    toStopId: `b${i}`,
    from: { lat: -45 + i * 0.01, lng: 168 },
    to: { lat: -45 + i * 0.01, lng: 168.1 },
    mode: 'drive',
    routeMode: 'drive',
    ...extra,
  }
}

const orsAnswer = (req: RouteRequest): RouteResponse => ({
  distanceM: 1000,
  durationS: 60,
  geometry: {
    type: 'LineString',
    coordinates: [
      [req.from.lng, req.from.lat],
      [req.from.lng + 0.05, req.from.lat + 0.001],
      [req.to.lng, req.to.lat],
    ],
  },
  source: 'ors',
  cached: false,
})

describe('route batching and cache', () => {
  it('batches at most 30 legs per call, deduplicated, without transit legs', () => {
    const legs = [
      ...Array.from({ length: 65 }, (_, i) => leg(i)),
      leg(3, { key: 'dup' }), // same ends and mode as leg 3
      leg(100, { mode: 'transit', routeMode: null }),
    ]
    const batches = pendingRouteBatches(legs, new Map())
    expect(batches.map((b) => b.length)).toEqual([30, 30, 5])
  })

  it('asks only for what the cache does not know, and nothing the second time', async () => {
    const cache: RouteCache = new Map()
    const fetchRoutes = vi.fn(async (batch: RouteRequest[]) => batch.map(orsAnswer))
    const legs = Array.from({ length: 31 }, (_, i) => leg(i))
    const first = await resolveRoutes(legs, fetchRoutes, cache)
    expect(fetchRoutes).toHaveBeenCalledTimes(2)
    expect(fetchRoutes.mock.calls.map(([batch]) => batch.length)).toEqual([30, 1])
    expect(first.error).toBeNull()
    expect(
      first.routes.every((r) => r.source === 'ors' && r.geometry.coordinates.length === 3),
    ).toBe(true)

    const again = await resolveRoutes(legs, fetchRoutes, cache)
    expect(fetchRoutes).toHaveBeenCalledTimes(2)
    expect(again.routes).toEqual(first.routes)
  })

  it('keys the cache like the Worker: tiny coordinate noise is a hit', async () => {
    const cache: RouteCache = new Map()
    const fetchRoutes = vi.fn(async (batch: RouteRequest[]) => batch.map(orsAnswer))
    await resolveRoutes([leg(1)], fetchRoutes, cache)
    const noisy = leg(1, { from: { lat: -45 + 0.01 + 1e-7, lng: 168 } })
    await resolveRoutes([noisy], fetchRoutes, cache)
    expect(fetchRoutes).toHaveBeenCalledTimes(1)
    // A different mode is a different route
    await resolveRoutes([leg(1, { mode: 'walk', routeMode: 'walk' })], fetchRoutes, cache)
    expect(fetchRoutes).toHaveBeenCalledTimes(2)
  })

  it('keeps the server estimate as an estimate (drawn dotted)', async () => {
    const cache: RouteCache = new Map()
    const fetchRoutes = async (batch: RouteRequest[]) =>
      batch.map((req) => ({
        ...orsAnswer(req),
        source: 'estimate' as const,
        fallbackReason: 'no_key' as const,
      }))
    const { routes } = await resolveRoutes([leg(1)], fetchRoutes, cache)
    expect(routes[0]!.source).toBe('estimate')
  })

  it('falls back to straight estimates when a batch fails, and stops asking', async () => {
    const cache: RouteCache = new Map()
    const failure = Object.assign(new Error('rate limited'), { status: 429 })
    const fetchRoutes = vi.fn(async () => {
      throw failure
    })
    const legs = Array.from({ length: 40 }, (_, i) => leg(i))
    const { routes, error } = await resolveRoutes(legs, fetchRoutes, cache)
    expect(error).toBe(failure)
    expect(fetchRoutes).toHaveBeenCalledTimes(1)
    expect(cache.size).toBe(0)
    expect(routes).toHaveLength(40)
    expect(routes[0]).toEqual({
      dayIndex: 0,
      source: 'estimate',
      geometry: {
        type: 'LineString',
        coordinates: [
          [168, -45],
          [168.1, -45],
        ],
      },
    })
  })

  it('draws never-routed legs as straight estimates', () => {
    const routes = routesFromCache(
      [leg(0, { mode: 'flight', routeMode: null, dayIndex: 4 })],
      new Map(),
    )
    expect(routes).toEqual([
      {
        dayIndex: 4,
        source: 'estimate',
        geometry: {
          type: 'LineString',
          coordinates: [
            [168, -45],
            [168.1, -45],
          ],
        },
      },
    ])
  })
})
