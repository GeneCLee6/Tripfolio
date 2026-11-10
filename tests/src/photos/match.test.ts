import { describe, expect, it } from 'vitest'
import type { Attachment } from '../../../shared/api/media.ts'
import type { DayWithStops, Place } from '../../../shared/api/types.ts'
import {
  MATCH_RADIUS_M,
  buildMatchContext,
  isUnfiled,
  localDateOf,
  matchPhoto,
  planMatches,
  type MatchContext,
} from '../../../src/lib/upload/match.ts'

// e6-t03 / AC-6.2: GPS within 500 m of a stop on the same local day goes to that stop; else the day
// by capture date (in the trip's zone); else nothing.

const TZ = 'Pacific/Auckland' // UTC+13 in February (NZDT)

const ferg = { lat: -45.0318, lng: 168.6598 }
const glenorchy = { lat: -44.8513, lng: 168.3871 }

const ctx: MatchContext = {
  tz: TZ,
  days: [
    { id: 'd1', date: '2027-02-06' },
    { id: 'd2', date: '2027-02-07' },
  ],
  stops: [
    { id: 's1', dayId: 'd1', ...ferg },
    { id: 's2', dayId: 'd1', lat: ferg.lat - 0.002, lng: ferg.lng }, // about 220 m south
    { id: 's3', dayId: 'd2', ...glenorchy },
    { id: 's4', dayId: 'd2', ...ferg }, // same spot as s1, other day
  ],
}

/** A point `metres` north of Fergburger */
const north = (metres: number) => ({ lat: ferg.lat + metres / 111_195, lng: ferg.lng })

describe('localDateOf', () => {
  it('converts UTC capture times into the trip zone', () => {
    expect(localDateOf('2027-02-06T11:30:00Z', TZ)).toBe('2027-02-07')
    expect(localDateOf('2027-02-06T10:59:00Z', TZ)).toBe('2027-02-06')
  })
  it('takes wall-clock times as recorded', () => {
    expect(localDateOf('2027-02-06T23:59:00', TZ)).toBe('2027-02-06')
  })
  it('gives null for no or bad times', () => {
    expect(localDateOf(null, TZ)).toBeNull()
    expect(localDateOf('nonsense', TZ)).toBeNull()
  })
})

describe('matchPhoto', () => {
  it('hangs a photo on the nearest stop of that day within 500 m', () => {
    expect(matchPhoto({ takenAt: '2027-02-06T12:00:00', ...north(10) }, ctx)).toEqual({
      dayId: 'd1',
      stopId: 's1',
    })
    const nearS2 = { lat: ferg.lat - 0.0018, lng: ferg.lng }
    expect(matchPhoto({ takenAt: '2027-02-06T12:00:00', ...nearS2 }, ctx)?.stopId).toBe('s2')
  })

  it('uses the same day only: the same spot on day 2 goes to the day-2 stop', () => {
    expect(matchPhoto({ takenAt: '2027-02-07T09:00:00', ...north(10) }, ctx)).toEqual({
      dayId: 'd2',
      stopId: 's4',
    })
  })

  it('stops at 500 m: further away goes to the day only', () => {
    const at = '2027-02-06T12:00:00'
    expect(matchPhoto({ takenAt: at, ...north(MATCH_RADIUS_M - 20) }, ctx)?.stopId).toBe('s1')
    expect(matchPhoto({ takenAt: at, ...north(MATCH_RADIUS_M + 300) }, ctx)).toEqual({
      dayId: 'd1',
      stopId: null,
    })
  })

  it('decides the day in the trip zone across midnight UTC', () => {
    // 11:30Z on the 6th is just after midnight on the 7th in Auckland: Glenorchy is a day-2 stop
    expect(matchPhoto({ takenAt: '2027-02-06T11:30:00Z', ...glenorchy }, ctx)).toEqual({
      dayId: 'd2',
      stopId: 's3',
    })
    // 10:30Z is still the 6th: no day-1 stop near Glenorchy, so day 1 only
    expect(matchPhoto({ takenAt: '2027-02-06T10:30:00Z', ...glenorchy }, ctx)).toEqual({
      dayId: 'd1',
      stopId: null,
    })
  })

  it('files photos without GPS by their date', () => {
    expect(matchPhoto({ takenAt: '2027-02-07T08:00:00', lat: null, lng: null }, ctx)).toEqual({
      dayId: 'd2',
      stopId: null,
    })
  })

  it('leaves photos without a time, or outside the trip, unassigned', () => {
    expect(matchPhoto({ takenAt: null, ...ferg }, ctx)).toBeNull()
    expect(matchPhoto({ takenAt: '2027-03-01T08:00:00', ...ferg }, ctx)).toBeNull()
  })
})

describe('buildMatchContext and planMatches', () => {
  const stop = (id: string, dayId: string, placeId: string | null) =>
    ({ id, dayId, placeId }) as DayWithStops['stops'][number]
  const days = [
    { id: 'd1', idx: 1, date: '2027-02-06', stops: [stop('s1', 'd1', 'p1'), stop('s2', 'd1', null)] },
    { id: 'd2', idx: 2, date: '2027-02-07', stops: [] },
    { id: 'dx', idx: null, date: '2027-01-01', stops: [stop('s9', 'dx', 'p1')] },
  ] as unknown as DayWithStops[]
  const places = [{ id: 'p1', ...ferg }] as Place[]
  const built = buildMatchContext(days, places, TZ)

  it('keeps assigned days and stops whose place has coordinates', () => {
    expect(built.days).toEqual([
      { id: 'd1', date: '2027-02-06' },
      { id: 'd2', date: '2027-02-07' },
    ])
    expect(built.stops).toEqual([{ id: 's1', dayId: 'd1', ...ferg }])
    expect([...(built.knownDayIds ?? [])].sort()).toEqual(['d1', 'd2', 'dx'])
  })

  it('plans only unfiled photos that a rule places', () => {
    const photo = (id: string, extra: Partial<Attachment>) =>
      ({
        id,
        takenAt: '2027-02-06T12:00:00',
        lat: null,
        lng: null,
        dayId: null,
        stopId: null,
        ...extra,
      }) as Attachment
    const plan = planMatches(
      [
        photo('a', { ...north(30) }),
        photo('b', {}),
        photo('c', { dayId: 'd2' }), // filed by hand: left alone
        photo('d', { takenAt: null }), // nothing to go on
        photo('e', { dayId: 'gone' }), // its day was deleted: filed again
      ],
      built,
    )
    expect(plan).toEqual([
      { attachmentId: 'a', patch: { dayId: 'd1', stopId: 's1' } },
      { attachmentId: 'b', patch: { dayId: 'd1', stopId: null } },
      { attachmentId: 'e', patch: { dayId: 'd1', stopId: null } },
    ])
  })

  it('isUnfiled', () => {
    expect(isUnfiled({ dayId: null, stopId: null })).toBe(true)
    expect(isUnfiled({ dayId: null, stopId: 's1' })).toBe(false)
    expect(isUnfiled({ dayId: 'd1', stopId: null }, built.knownDayIds)).toBe(false)
    expect(isUnfiled({ dayId: 'gone', stopId: null }, built.knownDayIds)).toBe(true)
  })
})
