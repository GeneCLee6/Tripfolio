import { describe, expect, it } from 'vitest'
import type { Place, Stop } from '../../../shared/api/types.ts'
import {
  applyBackupChanges,
  backupDropId,
  dayIdOfBackupDrop,
  splitBackup,
  swapInChanges,
} from '../../../src/lib/itinerary/backup.ts'
import {
  dayDropId,
  isContainerDrop,
  isSameSectionPlace,
  previewSectionMove,
  sectionOfDrop,
  sectionTarget,
} from '../../../src/lib/itinerary/dnd.ts'
import { assembleDay } from '../../../src/lib/itinerary/legs.ts'
import {
  endOfDay,
  parsePocketDragId,
  pocketDragId,
  pocketRequest,
  withNewStop,
} from '../../../src/lib/itinerary/pocket.ts'

// e2-t07: the rainy-day group (toggling, swapping, totals) and pocket-list drops → API requests

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

const place = (id: string, lat: number, lng: number, category = 'other'): Place => ({
  id,
  tripId: 't1',
  nameLocal: id,
  nameEn: '',
  lat,
  lng,
  address: '',
  category,
  source: 'manual',
  hours: null,
  links: [],
  rev: 1,
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
})

// Day 1: a (main), x (backup), b (main); Day 2 empty
const a = stop('a', { order: 1, placeId: 'p1' })
const x = stop('x', { order: 2, placeId: 'p3', isBackup: true })
const b = stop('b', { order: 3, placeId: 'p2' })
const days = [
  { id: 'd1', stops: [a, x, b] },
  { id: 'd2', stops: [] as Stop[] },
]

describe('rainy-day group', () => {
  it('splits a day into the main rail and the backups, in order', () => {
    const { main, backup } = splitBackup(days[0].stops)
    expect(main.map((s) => s.id)).toEqual(['a', 'b'])
    expect(backup.map((s) => s.id)).toEqual(['x'])
  })

  it('drop ids for the backup group', () => {
    expect(backupDropId('d1')).toBe('backup:d1')
    expect(dayIdOfBackupDrop('backup:d1')).toBe('d1')
    expect(dayIdOfBackupDrop('d1')).toBeNull()
    expect(isContainerDrop('backup:d1')).toBe(true)
    expect(isContainerDrop(dayDropId('d1'))).toBe(true)
    expect(isContainerDrop('a')).toBe(false)
  })

  it('「只加入」 flips only the backups; 「全部換上」 also benches the main stops', () => {
    expect(swapInChanges(days[0].stops, 'add')).toEqual([{ stopId: 'x', isBackup: false }])
    expect(swapInChanges(days[0].stops, 'swap')).toEqual([
      { stopId: 'a', isBackup: true },
      { stopId: 'x', isBackup: false },
      { stopId: 'b', isBackup: true },
    ])
    const swapped = applyBackupChanges(days, swapInChanges(days[0].stops, 'swap'))
    expect(splitBackup(swapped[0].stops).main.map((s) => s.id)).toEqual(['x'])
    expect(swapped[1]).toBe(days[1])
  })

  it('backups are left out of the legs and totals, and swapping them in counts them', () => {
    const places = new Map([
      ['p1', place('p1', -45.03, 168.66)],
      ['p2', place('p2', -44.85, 168.39)],
      ['p3', place('p3', -45.33, 168.72)],
    ])
    const options = {
      style: 'campervan' as const,
      limitMinutes: null,
      overrides: {},
      cache: new Map(),
    }
    const before = assembleDay(days[0].stops, places, options)
    expect(before.legs.map((leg) => `${leg.fromStopId}>${leg.toStopId}`)).toEqual(['a>b'])
    expect(before.summary.backupExcluded).toBe(1)
    const after = assembleDay(
      applyBackupChanges(days, swapInChanges(days[0].stops, 'add'))[0].stops,
      places,
      options,
    )
    expect(after.legs).toHaveLength(2)
    expect(after.summary.backupExcluded).toBe(0)
    expect(after.summary.driveMinutes).toBeGreaterThan(before.summary.driveMinutes)
  })

  it('a drop on a stop or a container names its day and list', () => {
    expect(sectionOfDrop(days, 'x')).toMatchObject({ day: { id: 'd1' }, backup: true })
    expect(sectionOfDrop(days, 'b')).toMatchObject({ day: { id: 'd1' }, backup: false })
    expect(sectionOfDrop(days, 'backup:d2')).toMatchObject({ day: { id: 'd2' }, backup: true })
    expect(sectionOfDrop(days, 'day:d2')).toMatchObject({ day: { id: 'd2' }, backup: false })
    expect(sectionOfDrop(days, 'nope')).toBeUndefined()
  })

  it('previews a stop dragged into the backup group (flagged, placed in that list)', () => {
    const preview = previewSectionMove(days, 'b', 'd1', true, 0)
    const moved = preview[0].stops.find((s) => s.id === 'b')!
    expect(moved.isBackup).toBe(true)
    expect(splitBackup(preview[0].stops).backup.map((s) => s.id)).toEqual(['b', 'x'])
    // Into another day's empty backup group
    const across = previewSectionMove(days, 'a', 'd2', true, 0)
    expect(across[1].stops).toMatchObject([{ id: 'a', dayId: 'd2', isBackup: true }])
    expect(across[0].stops.map((s) => s.id)).toEqual(['x', 'b'])
  })

  it('the neighbour above is counted in the stop’s own list', () => {
    // b's main-list neighbour is a (x sits between them in day order)
    expect(isSameSectionPlace(days, 'b', { dayId: 'd1', afterStopId: 'a' })).toBe(true)
    expect(isSameSectionPlace(days, 'b', { dayId: 'd1', afterStopId: 'x' })).toBe(false)
    expect(isSameSectionPlace(days, 'x', { dayId: 'd1', afterStopId: null })).toBe(true)
  })
})

describe('pocket list drops', () => {
  it('drag ids tell items and places apart from stops', () => {
    expect(pocketDragId({ kind: 'item', id: 'w1' })).toBe('pocket:item:w1')
    expect(pocketDragId({ kind: 'place', id: 'p9' })).toBe('pocket:place:p9')
    expect(parsePocketDragId('pocket:item:w1')).toEqual({ kind: 'item', id: 'w1' })
    expect(parsePocketDragId('pocket:place:p9')).toEqual({ kind: 'place', id: 'p9' })
    expect(parsePocketDragId('a')).toBeNull()
  })

  it('where a drop lands: before / after the stop under it, or the end of a container', () => {
    expect(sectionTarget(days, 'b', true)).toEqual({ dayId: 'd1', afterStopId: 'b', backup: false })
    expect(sectionTarget(days, 'b', false)).toEqual({
      dayId: 'd1',
      afterStopId: 'a',
      backup: false,
    })
    expect(sectionTarget(days, 'a', false)).toEqual({
      dayId: 'd1',
      afterStopId: null,
      backup: false,
    })
    expect(sectionTarget(days, 'x', true)).toEqual({ dayId: 'd1', afterStopId: 'x', backup: true })
    expect(sectionTarget(days, 'day:d2', false)).toEqual({
      dayId: 'd2',
      afterStopId: null,
      backup: false,
    })
    expect(sectionTarget(days, 'nope', false)).toBeNull()
    // 「排進 Day N」: the end of the main rail
    expect(endOfDay(days[0])).toEqual({ dayId: 'd1', afterStopId: 'b', backup: false })
    expect(endOfDay(days[1])).toEqual({ dayId: 'd2', afterStopId: null, backup: false })
  })

  it('an item goes through /schedule (the link is kept by the server)', () => {
    expect(
      pocketRequest({ kind: 'item', id: 'w1' }, { dayId: 'd1', afterStopId: 'a', backup: false }),
    ).toEqual({
      kind: 'schedule',
      itemId: 'w1',
      body: { dayId: 'd1', afterStopId: 'a' },
      isBackup: false,
    })
    // Into the backup group: flagged afterwards
    expect(
      pocketRequest({ kind: 'item', id: 'w1' }, { dayId: 'd1', afterStopId: 'x', backup: true }),
    ).toMatchObject({ kind: 'schedule', isBackup: true })
  })

  it('a place becomes POST /stops with its type from the category', () => {
    expect(
      pocketRequest(
        { kind: 'place', id: 'p9' },
        { dayId: 'd2', afterStopId: null, backup: false },
        { id: 'p9', category: 'food' },
      ),
    ).toEqual({
      kind: 'createStop',
      body: { dayId: 'd2', afterStopId: null, placeId: 'p9', type: 'food', isBackup: false },
    })
    expect(
      pocketRequest(
        { kind: 'place', id: 'p8' },
        { dayId: 'd1', afterStopId: 'x', backup: true },
        { id: 'p8', category: 'nature' },
      ),
    ).toMatchObject({ body: { type: 'sight', isBackup: true } })
  })

  it('the server’s new stop joins its day in order', () => {
    const next = withNewStop(days, stop('n', { order: 1.5 }), [{ id: 'b', order: 4 }])
    expect(next[0].stops.map((s) => s.id)).toEqual(['a', 'n', 'x', 'b'])
    expect(next[0].stops.find((s) => s.id === 'b')!.order).toBe(4)
    expect(next[1]).toBe(days[1])
  })
})
