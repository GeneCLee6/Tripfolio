import { describe, expect, it } from 'vitest'
import type { DayWithStops, LegOverride, Place, Stop } from '../../../shared/api/types.ts'
import {
  checkItineraryDay,
  checkStops,
  dayCheckContext,
  DEFAULT_DAY_END,
  openingHoursOf,
  warnedStops,
} from '../../../src/lib/itinerary/checks.ts'
import {
  dayDropId,
  dayOfDrop,
  isSamePlace,
  previewMove,
  targetAtIndex,
  targetFromList,
} from '../../../src/lib/itinerary/dnd.ts'
import {
  assembleDay,
  legModeFromApi,
  overrideModeOf,
  overridesByKey,
  parseMinutes,
} from '../../../src/lib/itinerary/legs.ts'
import { applyMove, applyMoveResult, orderBetween } from '../../../src/lib/itinerary/order.ts'

// e2-t04 (drop → /move body, fractional order), e2-t05 (overrides → totals), e2-t06 (check context)

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

const stop = (id: string, extra: Partial<Stop> = {}): Stop => ({
  id,
  tripId: 't1',
  dayId: 'd1',
  order: 1,
  type: 'sight',
  title: id,
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
  updatedAt: '2026-11-09T00:00:00Z',
  ...extra,
})

const day = (id: string, stops: Stop[], date: string | null = '2027-02-08'): DayWithStops => ({
  id,
  tripId: 't1',
  date,
  idx: 1,
  title: '',
  color: null,
  note: '',
  lodgingId: null,
  rev: 1,
  updatedAt: '2026-11-09T00:00:00Z',
  stops,
})

describe('drop → /move body (e2-t04)', () => {
  const list = [stop('a'), stop('b'), stop('c')]

  it('first, middle and last positions in the same day', () => {
    expect(targetAtIndex('d1', list, 'c', 0)).toEqual({ dayId: 'd1', afterStopId: null })
    expect(targetAtIndex('d1', list, 'a', 1)).toEqual({ dayId: 'd1', afterStopId: 'b' })
    expect(targetAtIndex('d1', list, 'a', 2)).toEqual({ dayId: 'd1', afterStopId: 'c' })
    // Past the end clamps to last
    expect(targetAtIndex('d1', list, 'a', 9)).toEqual({ dayId: 'd1', afterStopId: 'c' })
  })

  it('reads the neighbour above from the final list', () => {
    expect(targetFromList('d1', [stop('b'), stop('a'), stop('c')], 'a')).toEqual({
      dayId: 'd1',
      afterStopId: 'b',
    })
    expect(targetFromList('d1', [stop('c'), stop('a'), stop('b')], 'c')).toEqual({
      dayId: 'd1',
      afterStopId: null,
    })
  })

  it('cross-day: into an empty day, and at the start / end of a full one', () => {
    expect(targetAtIndex('d2', [], 'a', 0)).toEqual({ dayId: 'd2', afterStopId: null })
    const other = [stop('x', { dayId: 'd2' }), stop('y', { dayId: 'd2' })]
    expect(targetAtIndex('d2', other, 'a', 0)).toEqual({ dayId: 'd2', afterStopId: null })
    expect(targetAtIndex('d2', other, 'a', 2)).toEqual({ dayId: 'd2', afterStopId: 'y' })
  })

  it('previews a cross-day drag and finds the drop day', () => {
    const days = [day('d1', list), day('d2', [stop('x', { dayId: 'd2' })])]
    const moved = previewMove(days, 'b', 'd2', 1)
    expect(moved[0].stops.map((s) => s.id)).toEqual(['a', 'c'])
    expect(moved[1].stops.map((s) => s.id)).toEqual(['x', 'b'])
    expect(moved[1].stops[1].dayId).toBe('d2')
    expect(targetFromList('d2', moved[1].stops, 'b')).toEqual({ dayId: 'd2', afterStopId: 'x' })
    expect(dayOfDrop(days, dayDropId('d2'))?.id).toBe('d2')
    expect(dayOfDrop(days, 'c')?.id).toBe('d1')
  })

  it('knows when nothing moved', () => {
    const days = [day('d1', list)]
    expect(isSamePlace(days, 'b', { dayId: 'd1', afterStopId: 'a' })).toBe(true)
    expect(isSamePlace(days, 'a', { dayId: 'd1', afterStopId: null })).toBe(true)
    expect(isSamePlace(days, 'a', { dayId: 'd1', afterStopId: 'b' })).toBe(false)
    expect(isSamePlace(days, 'a', { dayId: 'd2', afterStopId: null })).toBe(false)
  })
})

describe('fractional order and the /move answer', () => {
  it('orders between neighbours like the Worker', () => {
    expect(orderBetween(null, null)).toBe(1)
    expect(orderBetween(null, 2)).toBe(1)
    expect(orderBetween(3, null)).toBe(4)
    expect(orderBetween(1, 2)).toBe(1.5)
  })

  it('gives the optimistic stop a fractional order, then takes the renumbered one', () => {
    const days = [
      day('d1', [stop('a', { order: 1 }), stop('b', { order: 2 }), stop('c', { order: 3 })]),
    ]
    const optimistic = applyMove(days, 'c', { dayId: 'd1', afterStopId: 'a' })
    expect(optimistic[0].stops.map((s) => [s.id, s.order])).toEqual([
      ['a', 1],
      ['c', 1.5],
      ['b', 2],
    ])
    // The server renumbered the day and put c at 1.5
    const settled = applyMoveResult(optimistic, stop('c', { order: 1.5, rev: 2 }), [
      { id: 'a', order: 1 },
      { id: 'b', order: 2 },
    ])
    expect(settled[0].stops.map((s) => s.id)).toEqual(['a', 'c', 'b'])
    expect(settled[0].stops[1].rev).toBe(2)
  })

  it('moves the server stop across days and keeps both sorted', () => {
    const days = [
      day('d1', [stop('a', { order: 1 }), stop('b', { order: 2 })]),
      day('d2', [stop('x', { dayId: 'd2', order: 5 })]),
    ]
    const settled = applyMoveResult(days, stop('a', { dayId: 'd2', order: 4 }), [])
    expect(settled[0].stops.map((s) => s.id)).toEqual(['b'])
    expect(settled[1].stops.map((s) => s.id)).toEqual(['a', 'x'])
  })
})

describe('leg overrides → totals (e2-t05)', () => {
  const places = new Map([
    ['p1', place('p1', -45.0312, 168.6626)],
    ['p2', place('p2', -44.8513, 168.3871)],
    ['p3', place('p3', -45.4145, 167.718)],
  ])
  const stops = [
    stop('s1', { placeId: 'p1' }),
    stop('s2', { placeId: 'p2' }),
    stop('s3', { placeId: 'p3', isBackup: true }),
  ]
  const override = (extra: Partial<LegOverride>): LegOverride => ({
    tripId: 't1',
    fromStopId: 's1',
    toStopId: 's2',
    mode: 'drive',
    minutes: null,
    rev: 1,
    updatedAt: '2026-11-09T00:00:00Z',
    ...extra,
  })
  const assemble = (legs: LegOverride[]) =>
    assembleDay(stops, places, {
      style: 'campervan',
      limitMinutes: null,
      overrides: overridesByKey(legs, 'campervan'),
      cache: new Map(),
    })

  it('backup stops have no legs and are not counted', () => {
    const result = assemble([])
    expect(result.legs).toHaveLength(1)
    expect(result.summary.backupExcluded).toBe(1)
    expect(result.legs[0]).toMatchObject({ mode: 'campervan', estimated: true, overridden: false })
  })

  it('manual minutes replace the time, mark the leg and change the day total', () => {
    const before = assemble([])
    const after = assemble([override({ minutes: 300 })])
    expect(after.legs[0]).toMatchObject({
      source: 'manual',
      estimated: false,
      overridden: true,
      overrideMinutes: 300,
      durationS: 18_000,
    })
    expect(after.summary.driveMinutes).toBe(300)
    expect(after.summary.driveMinutes).not.toBe(before.summary.driveMinutes)
    // Over the campervan limit (3.5 h)
    expect(after.summary.overLimit).toBe(true)
    expect(after.summary.limitMinutes).toBe(210)
  })

  it('a non-road mode leaves the driving total', () => {
    const walked = assemble([override({ mode: 'walk' })])
    expect(walked.legs[0]).toMatchObject({ mode: 'walk', overridden: true, estimated: true })
    expect(walked.summary.driveMinutes).toBe(0)
    expect(walked.summary.distanceM).toBeGreaterThan(0)
  })

  it('maps the API road mode to the campervan on campervan trips, and back', () => {
    expect(legModeFromApi('drive', 'campervan')).toBe('campervan')
    expect(legModeFromApi('drive', 'self-drive')).toBe('drive')
    expect(overrideModeOf('campervan')).toBe('drive')
    expect(overrideModeOf('cycle')).toBe('other')
    expect(overrideModeOf('ferry')).toBe('ferry')
  })

  it('parses typed minutes', () => {
    expect(parseMinutes('')).toBeNull()
    expect(parseMinutes(' 45 ')).toBe(45)
    expect(parseMinutes('4.5')).toBeNaN()
    expect(parseMinutes('-3')).toBeNaN()
    expect(parseMinutes('99999')).toBeNaN()
  })
})

describe('time check context (e2-t06)', () => {
  const trip = { tz: 'Pacific/Auckland', centerLat: -45.03, centerLng: 168.66 }

  it('maps stored periods (0 = Sunday) to the weekly table; none means skip', () => {
    expect(openingHoursOf(null)).toBeNull()
    expect(openingHoursOf({ text: 'see website' })).toBeNull()
    const hours = openingHoursOf({
      periods: [
        { day: 1, open: '09:00', close: '17:00' },
        { day: 0, open: '10:00', close: '14:00' },
        { day: 1, open: '18:00', close: '22:00' },
      ],
    })
    expect(hours?.mon).toEqual([
      ['09:00', '17:00'],
      ['18:00', '22:00'],
    ])
    expect(hours?.sun).toEqual([['10:00', '14:00']])
    // Days without periods are closed
    expect(hours?.tue).toEqual([])
  })

  it('defaults the end of the day and skips a day without a date', () => {
    expect(DEFAULT_DAY_END).toBe('21:00')
    expect(dayCheckContext({ date: '2027-02-08' }, trip, [])).toMatchObject({
      date: '2027-02-08',
      tz: 'Pacific/Auckland',
      dayEnd: '21:00',
      lat: -45.03,
      lng: 168.66,
    })
    expect(dayCheckContext({ date: null }, trip, [])).toBeNull()
    expect(
      dayCheckContext({ date: '2027-02-08' }, { ...trip, centerLat: null, centerLng: null }, []),
    ).not.toHaveProperty('lat')
  })

  it('turns stored UTC times into local HH:mm with booking, category and hours', () => {
    const places = new Map([
      ['p1', place('p1', -45.03, 168.66, { category: 'nature', hours: { periods: [] } })],
    ])
    const [item] = checkStops(
      [stop('s1', { placeId: 'p1', startAt: '2027-02-07T20:30:00Z', booking: 'booked' })],
      places,
      'Pacific/Auckland',
    )
    expect(item).toMatchObject({
      startTime: '09:30',
      endTime: null,
      booking: 'booked',
      category: 'nature',
      hours: null,
      lat: -45.03,
    })
  })

  it('finds the closed-on-arrival, booking-overlap and after-sunset warnings', () => {
    // 2027-02-08 is a Monday; the museum is closed on Mondays
    const places = new Map([
      [
        'museum',
        place('museum', -45.03, 168.66, {
          hours: { periods: [{ day: 2, open: '09:00', close: '17:00' }] },
        }),
      ],
      ['lake', place('lake', -45.03, 168.66, { category: 'nature' })],
    ])
    const stops = [
      // 10:00–11:00 local (NZDT, UTC+13)
      stop('museum', {
        placeId: 'museum',
        startAt: '2027-02-07T21:00:00Z',
        endAt: '2027-02-07T22:00:00Z',
      }),
      stop('jet', {
        booking: 'booked',
        startAt: '2027-02-07T23:00:00Z',
        endAt: '2027-02-08T00:30:00Z',
      }),
      stop('cruise', {
        booking: 'todo',
        startAt: '2027-02-08T00:00:00Z',
        endAt: '2027-02-08T01:00:00Z',
      }),
      // 22:00 local, well after the February sunset
      stop('lake', { placeId: 'lake', startAt: '2027-02-08T09:00:00Z' }),
    ]
    const warnings = checkItineraryDay(day('d1', stops), trip, places, [])
    const kinds = warnings.map((w) => w.kind)
    expect(kinds).toContain('closed-on-arrival')
    expect(kinds).toContain('booking-overlap')
    expect(kinds).toContain('after-sunset')
    expect(warnings.find((w) => w.kind === 'closed-on-arrival')?.data?.arrival).toBe('10:00')
    expect(warnings.find((w) => w.kind === 'booking-overlap')?.stopIds).toEqual(['jet', 'cruise'])
    // Cards get a mark for their own warnings, not for the whole-day one
    const marked = warnedStops(warnings)
    expect([...marked].sort()).toEqual(['cruise', 'jet', 'lake', 'museum'])
    expect(warnedStops([{ kind: 'no-buffer', stopIds: ['a'] }]).size).toBe(0)
  })

  it('has nothing to say about a day without stops or date, and ignores backups', () => {
    expect(checkItineraryDay(day('d1', []), trip, new Map(), [])).toEqual([])
    const backup = stop('late', { startAt: '2027-02-08T09:00:00Z', isBackup: true })
    expect(checkItineraryDay(day('d1', [backup], null), trip, new Map(), [])).toEqual([])
  })
})
