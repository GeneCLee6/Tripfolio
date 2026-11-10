import { describe, expect, it } from 'vitest'
import type { Attachment } from '../../../shared/api/media.ts'
import type { DayWithStops } from '../../../shared/api/types.ts'
import { groupByDay, photosByStop, sortPhotos } from '../../../src/lib/photos/albums.ts'

// e6-t04: albums per day (Day order, cover pick), the photos no day claims, photos per stop.

const photo = (id: string, extra: Partial<Attachment> = {}) =>
  ({
    id,
    takenAt: null,
    createdAt: '2027-02-01T00:00:00Z',
    dayId: null,
    stopId: null,
    ...extra,
  }) as Attachment

const days = [
  { id: 'd2', idx: 2, date: '2027-02-07', stops: [{ id: 's3' }] },
  { id: 'd1', idx: 1, date: '2027-02-06', stops: [{ id: 's1' }] },
  { id: 'dx', idx: null, date: '2027-01-01', stops: [] },
] as unknown as DayWithStops[]

describe('groupByDay', () => {
  const photos = [
    photo('a', { dayId: 'd1', stopId: 's1' }),
    photo('b', { dayId: 'd2' }),
    photo('c', { stopId: 's3' }), // no dayId: the stop's day
    photo('d'),
    photo('e', { dayId: 'dx' }), // a day outside the trip's dates
    photo('f', { dayId: 'gone' }),
    photo('g', { dayId: 'd1' }),
  ]

  it('groups by assigned day in Day order, the rest unassigned', () => {
    const albums = groupByDay(photos, days)
    expect(albums.days.map((a) => [a.day.id, a.position, a.photos.map((p) => p.id)])).toEqual([
      ['d1', 0, ['a', 'g']],
      ['d2', 1, ['b', 'c']],
    ])
    expect(albums.unassigned.map((p) => p.id)).toEqual(['d', 'e', 'f'])
  })

  it('covers: the pick when still in the album, else the first photo', () => {
    const albums = groupByDay(photos, days, { d1: 'g', d2: 'a' })
    expect(albums.days.map((a) => a.coverId)).toEqual(['g', 'b'])
  })

  it('keeps empty days with no cover', () => {
    const albums = groupByDay([photo('d')], days)
    expect(albums.days.map((a) => [a.photos.length, a.coverId])).toEqual([
      [0, null],
      [0, null],
    ])
  })
})

describe('photosByStop and sortPhotos', () => {
  it('lists photos per stop', () => {
    const map = photosByStop([
      photo('a', { stopId: 's1' }),
      photo('b'),
      photo('c', { stopId: 's1' }),
    ])
    expect([...map.keys()]).toEqual(['s1'])
    expect(map.get('s1')?.map((p) => p.id)).toEqual(['a', 'c'])
  })

  it('sorts by capture time, then upload time', () => {
    const sorted = sortPhotos([
      photo('x', { createdAt: '2027-02-09T00:00:00Z' }),
      photo('y', { takenAt: '2027-02-06T08:00:00' }),
    ])
    expect(sorted.map((p) => p.id)).toEqual(['y', 'x'])
  })
})
