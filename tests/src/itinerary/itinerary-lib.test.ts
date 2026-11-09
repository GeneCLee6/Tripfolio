import { describe, expect, it } from 'vitest'
import type { GeoResult } from '../../../shared/api/geo.ts'
import type { DayWithStops, LegOverride, Place, Stop } from '../../../shared/api/types.ts'
import {
  assembleDay,
  overridesByKey,
  routeBatches,
  routeKey,
  routeModeFor,
  type CachedRoute,
} from '../../../src/lib/itinerary/legs.ts'
import {
  applyMove,
  moveDownTarget,
  moveToDayTarget,
  moveUpTarget,
} from '../../../src/lib/itinerary/order.ts'
import {
  findExistingPlace,
  looksLikeLocation,
  osmUrl,
  placeFromResult,
  placeName,
  stopTypeForCategory,
} from '../../../src/lib/itinerary/places.ts'
import {
  addDays,
  draftToInstants,
  localTime,
  spanMinutes,
  utcFromLocal,
} from '../../../src/lib/itinerary/time.ts'

const place = (id: string, lat: number, lng: number, extra: Partial<Place> = {}): Place => ({
  id,
  tripId: 't1',
  nameLocal: id,
  nameEn: '',
  lat,
  lng,
  address: '',
  category: 'other',
  source: 'manual',
  hours: null,
  links: [],
  rev: 1,
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
  ...extra,
})

const stop = (id: string, placeId: string | null, extra: Partial<Stop> = {}): Stop => ({
  id,
  tripId: 't1',
  dayId: 'd1',
  order: 1,
  type: 'sight',
  title: id,
  placeId,
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
  updatedAt: '2026-11-09T00:00:00Z',
  ...extra,
})

describe('time fields (trip zone ↔ UTC)', () => {
  it('stores a Queenstown wall-clock time as UTC (NZDT is UTC+13 in February)', () => {
    expect(utcFromLocal('2027-02-07', '09:30', 'Pacific/Auckland')).toBe('2027-02-06T20:30:00Z')
    expect(localTime('2027-02-06T20:30:00Z', 'Pacific/Auckland')).toBe('09:30')
  })

  it('uses standard time in winter (NZST, UTC+12)', () => {
    expect(utcFromLocal('2027-07-01', '12:00', 'Pacific/Auckland')).toBe('2027-07-01T00:00:00Z')
  })

  it('does not depend on the browser zone', () => {
    expect(utcFromLocal('2026-12-01', '08:00', 'Asia/Tokyo')).toBe('2026-11-30T23:00:00Z')
    expect(localTime('2026-11-30T23:00:00Z', 'Asia/Tokyo')).toBe('08:00')
  })

  it('round-trips through a draft; an end before the start is the next day', () => {
    const { startAt, endAt } = draftToInstants(
      { start: '22:00', end: '01:30' },
      '2027-02-07',
      'Pacific/Auckland',
    )
    expect(startAt).toBe('2027-02-07T09:00:00Z')
    expect(endAt).toBe('2027-02-07T12:30:00Z')
    expect(spanMinutes(startAt, endAt)).toBe(210)
  })

  it('empty or malformed times are null', () => {
    expect(draftToInstants({ start: '', end: '' }, '2027-02-07', 'UTC')).toEqual({
      startAt: null,
      endAt: null,
    })
    expect(utcFromLocal('2027-02-07', '25:00', 'UTC')).toBeNull()
    expect(localTime(null, 'UTC')).toBe('')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('leg assembly', () => {
  // Queenstown → Arrowtown → Glenorchy
  const places = new Map([
    ['p1', place('p1', -45.0312, 168.6626)],
    ['p2', place('p2', -44.9415, 168.8335)],
    ['p3', place('p3', -44.8513, 168.3871)],
  ])
  const base = { style: 'roadtrip' as const, limitMinutes: null, overrides: {}, cache: new Map() }

  it('asks the API only for routable legs and estimates the rest', () => {
    const stops = [stop('a', 'p1'), stop('b', 'p2'), stop('c', 'p3')]
    const overrides = overridesByKey([
      { fromStopId: 'b', toStopId: 'c', mode: 'ferry', minutes: null } as LegOverride,
    ])
    const day = assembleDay(stops, places, { ...base, overrides })
    expect(day.legs.map((leg) => leg.mode)).toEqual(['drive', 'ferry'])
    expect(day.legs.every((leg) => leg.estimated)).toBe(true)
    // Only the drive leg is sent; the ferry stays a client-side estimate
    expect(day.missing).toHaveLength(1)
    expect(day.missing[0].mode).toBe('drive')
  })

  it('maps modes: campervan → drive; transit, flight, ferry and other are never routed', () => {
    expect(routeModeFor('campervan')).toBe('drive')
    expect(routeModeFor('walk')).toBe('walk')
    expect(routeModeFor('cycle')).toBe('cycle')
    for (const mode of ['transit', 'flight', 'ferry', 'other'] as const) {
      expect(routeModeFor(mode)).toBeNull()
    }
    const day = assembleDay([stop('a', 'p1'), stop('b', 'p2')], places, {
      ...base,
      style: 'campervan',
    })
    expect(day.legs[0].mode).toBe('campervan')
    expect(day.missing[0].mode).toBe('drive')
  })

  it('uses cached routes, and still marks a routed estimate', () => {
    const stops = [stop('a', 'p1'), stop('b', 'p2'), stop('c', 'p3')]
    const cache = new Map<string, CachedRoute>([
      [
        routeKey(places.get('p1')!, places.get('p2')!, 'drive'),
        { distanceM: 21000, durationS: 1500, source: 'ors' },
      ],
      [
        routeKey(places.get('p2')!, places.get('p3')!, 'drive'),
        { distanceM: 60000, durationS: 3600, source: 'estimate' },
      ],
    ])
    const day = assembleDay(stops, places, { ...base, cache })
    expect(day.missing).toHaveLength(0)
    expect(day.legs.map((leg) => [leg.distanceM, leg.durationS, leg.estimated])).toEqual([
      [21000, 1500, false],
      [60000, 3600, true],
    ])
    expect(day.summary.driveMinutes).toBe(85)
    expect(day.summary.label).toBe('drive')
  })

  it('skips stops without a place and backups; ride styles are labelled ride', () => {
    const stops = [stop('a', 'p1'), stop('x', null), stop('y', 'p3', { isBackup: true }), stop('b', 'p2')]
    const day = assembleDay(stops, places, { ...base, style: 'private-driver' })
    // a → x has no coordinates for x; x → b neither; the backup is dropped
    expect(day.legs).toHaveLength(0)
    expect(day.summary.label).toBe('ride')
    expect(day.summary.backupExcluded).toBe(1)
  })

  it('a manual time is neither fetched as an estimate nor marked', () => {
    const overrides = overridesByKey([
      { fromStopId: 'a', toStopId: 'b', mode: 'drive', minutes: 40 } as LegOverride,
    ])
    const day = assembleDay([stop('a', 'p1'), stop('b', 'p2')], places, { ...base, overrides })
    expect(day.legs[0]).toMatchObject({ source: 'manual', durationS: 2400, estimated: false })
  })

  it('flags days over the limit', () => {
    const far = new Map([
      ['p1', place('p1', -45.0312, 168.6626)],
      ['p9', place('p9', -43.531, 172.6366)], // Christchurch
    ])
    const day = assembleDay([stop('a', 'p1'), stop('b', 'p9')], far, { ...base, limitMinutes: 120 })
    expect(day.summary.overLimit).toBe(true)
  })

  it('batches at most 30 legs per request', () => {
    const requests = Array.from({ length: 65 }, (_, i) => ({
      from: { lat: 0, lng: i },
      to: { lat: 1, lng: i },
      mode: 'drive' as const,
    }))
    expect(routeBatches(requests).map((batch) => batch.length)).toEqual([30, 30, 5])
  })
})

describe('places', () => {
  const result: GeoResult = {
    nameLocal: 'Fergburger',
    nameEn: 'Fergburger',
    lat: -45.0318,
    lng: 168.6598,
    address: '42 Shotover Street, Queenstown',
    category: 'food',
    source: 'photon',
    externalId: 'osm:N336415647',
  }

  it('links a result to its OSM element', () => {
    expect(osmUrl('osm:N336415647')).toBe('https://www.openstreetmap.org/node/336415647')
    expect(osmUrl('osm:W12')).toBe('https://www.openstreetmap.org/way/12')
    expect(osmUrl('nominatim:1')).toBeNull()
    const body = placeFromResult(result)
    expect(body).toMatchObject({ nameLocal: 'Fergburger', category: 'food', source: 'photon' })
    expect(body.links).toEqual([
      { url: 'https://www.openstreetmap.org/node/336415647', label: 'OpenStreetMap' },
    ])
  })

  it('reuses the place with the same externalId (by its OSM link)', () => {
    const existing = place('p1', -45.03, 168.66, {
      nameLocal: 'Ferg',
      links: [{ url: 'https://www.openstreetmap.org/node/336415647' }],
    })
    expect(findExistingPlace([place('p0', 0, 0), existing], result)?.id).toBe('p1')
    expect(findExistingPlace([place('p0', 0, 0)], result)).toBeNull()
    expect(
      findExistingPlace([place('p2', 0, 0, { links: [{ url: 'https://www.openstreetmap.org/node/1' }] })], result),
    ).toBeNull()
  })

  it('falls back to the same name at the same spot', () => {
    const same = place('p3', -45.0318, 168.6598, { nameLocal: 'Fergburger' })
    expect(findExistingPlace([same], { ...result, externalId: 'x' })?.id).toBe('p3')
  })

  it('shows the English name in English when there is one', () => {
    expect(placeName({ nameLocal: '東京タワー', nameEn: 'Tokyo Tower' }, 'en')).toBe('Tokyo Tower')
    expect(placeName({ nameLocal: '東京タワー', nameEn: 'Tokyo Tower' }, 'zh-TW')).toBe('東京タワー')
    expect(placeName({ nameLocal: 'Fergburger', nameEn: '' }, 'en')).toBe('Fergburger')
  })

  it('maps nature to a sight', () => {
    expect(stopTypeForCategory('nature')).toBe('sight')
    expect(stopTypeForCategory('food')).toBe('food')
    expect(stopTypeForCategory('weird')).toBe('other')
  })
})

describe('paste detection', () => {
  it.each([
    '-45.0312, 168.6626',
    '-45.0312,168.6626',
    '(-45.0312, 168.6626)',
    '35.6586 139.7454',
    '-45.03，168.66',
    'https://maps.app.goo.gl/AbCdEf123',
    'https://www.google.com/maps/place/Fergburger/@-45.03,168.66,17z',
    'https://maps.google.com/?q=-45.03,168.66',
    'https://goo.gl/maps/xyz',
    'google.co.nz/maps/@-45.03,168.66,15z',
  ])('treats %s as a location', (text) => {
    expect(looksLikeLocation(text)).toBe(true)
  })

  it.each(['Fergburger', 'Queenstown 2027', '91, 10', '-45.03, 190', '', 'https://example.com/maps'])(
    'searches %s instead',
    (text) => {
      expect(looksLikeLocation(text)).toBe(false)
    },
  )
})

describe('moving without drag and drop', () => {
  const stops = [stop('a', null), stop('b', null), stop('c', null)]

  it('moves up and down through /move targets', () => {
    expect(moveUpTarget(stops, 'a')).toBeNull()
    expect(moveUpTarget(stops, 'b')).toEqual({ dayId: 'd1', afterStopId: null })
    expect(moveUpTarget(stops, 'c')).toEqual({ dayId: 'd1', afterStopId: 'a' })
    expect(moveDownTarget(stops, 'a')).toEqual({ dayId: 'd1', afterStopId: 'b' })
    expect(moveDownTarget(stops, 'c')).toBeNull()
    expect(moveToDayTarget('d2', [])).toEqual({ dayId: 'd2', afterStopId: null })
    expect(moveToDayTarget('d2', stops)).toEqual({ dayId: 'd2', afterStopId: 'c' })
  })

  it('applies a move to the local days', () => {
    const days = [
      { id: 'd1', stops },
      { id: 'd2', stops: [] as Stop[] },
    ] as unknown as DayWithStops[]
    const down = applyMove(days, 'a', { dayId: 'd1', afterStopId: 'b' })
    expect(down[0].stops.map((s) => s.id)).toEqual(['b', 'a', 'c'])
    const across = applyMove(days, 'b', { dayId: 'd2', afterStopId: null })
    expect(across[0].stops.map((s) => s.id)).toEqual(['a', 'c'])
    expect(across[1].stops.map((s) => [s.id, s.dayId])).toEqual([['b', 'd2']])
  })
})
