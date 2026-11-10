import { describe, expect, it, vi } from 'vitest'
import type { DayWithStops, LegOverride, Stop } from '../../../shared/api/types.ts'
import type { TripEvent } from '../../../shared/protocol.ts'
import {
  createRefetchScheduler,
  EVERYTHING,
  NOTHING,
  planFor,
  REFETCH_DEBOUNCE_MS,
} from '../../../src/lib/itinerary/live.ts'
import {
  carryConflicts,
  changedFields,
  mergeFields,
  sameValue,
} from '../../../src/lib/itinerary/merge.ts'
import { applyPending, draftStop } from '../../../src/lib/itinerary/pending.ts'
import { draftValues, toDraft } from '../../../src/lib/itinerary/stop-draft.ts'

// e2-t08b: which events reload what (and the 300 ms fold), the field-level merge of an open
// editor, and the offline queue's waiting edits laid over fetched days.

const event = (entity: TripEvent['entity'], by: string | null = 'm-b'): TripEvent => ({
  rev: 7,
  entity,
  id: 'x',
  action: 'upsert',
  byMemberId: by,
  at: '2026-11-10T00:00:00Z',
})

describe('live refetch plan', () => {
  it('skips own events and entities the itinerary does not show', () => {
    expect(planFor(event('stop', 'm-a'), 'm-a')).toEqual(NOTHING)
    expect(planFor(event('expense'), 'm-a')).toEqual(NOTHING)
    expect(planFor(event('note'), 'm-a')).toEqual(NOTHING)
    expect(planFor(event('member'), 'm-a')).toEqual(NOTHING)
  })

  it('reloads /days for stops, days, legs, lodgings, bookings and picks; /places for places', () => {
    for (const entity of [
      'stop',
      'day',
      'legOverride',
      'lodging',
      'booking',
      'wishlist',
    ] as const) {
      expect(planFor(event(entity), 'm-a').days).toBe(true)
    }
    expect(planFor(event('place'), 'm-a')).toEqual({ days: false, places: true, pocket: true })
    expect(planFor(event('stop'), 'm-a').pocket).toBe(true)
    expect(planFor(event('legOverride'), 'm-a').pocket).toBe(false)
    // A system write (no member) is someone else's
    expect(planFor(event('stop', null), 'm-a').days).toBe(true)
  })

  it('folds a burst into one refetch 300 ms after the last event', () => {
    vi.useFakeTimers()
    try {
      const run = vi.fn()
      const scheduler = createRefetchScheduler(run)
      scheduler.request(planFor(event('stop'), 'm-a'))
      vi.advanceTimersByTime(200)
      scheduler.request(planFor(event('place'), 'm-a'))
      scheduler.request(NOTHING)
      vi.advanceTimersByTime(REFETCH_DEBOUNCE_MS - 1)
      expect(run).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(run).toHaveBeenCalledTimes(1)
      expect(run).toHaveBeenCalledWith(EVERYTHING)
      // Nothing waiting: nothing runs
      vi.advanceTimersByTime(1000)
      scheduler.flush()
      expect(run).toHaveBeenCalledTimes(1)
      scheduler.request(planFor(event('day'), 'm-a'))
      scheduler.cancel()
      vi.advanceTimersByTime(1000)
      expect(run).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('field-level merge', () => {
  const base = { title: 'Lake', start: '09:00', end: '', note: '', links: ['https://a.example'] }

  it('takes untouched fields from the remote version silently', () => {
    const local = { ...base, title: 'Lake Tekapo' }
    const remote = { ...base, start: '10:30' }
    const result = mergeFields(base, local, remote)
    expect(result.merged).toEqual({ ...base, title: 'Lake Tekapo', start: '10:30' })
    expect(result.conflicts).toEqual({})
    expect(result.updated).toEqual(['start'])
  })

  it('keeps a field the person is editing and reports the remote value as a conflict', () => {
    const local = { ...base, title: 'Mine' }
    const remote = { ...base, title: 'Theirs', note: 'bring cash' }
    const result = mergeFields(base, local, remote)
    expect(result.merged.title).toBe('Mine')
    expect(result.merged.note).toBe('bring cash')
    expect(result.conflicts).toEqual({ title: 'Theirs' })
  })

  it('is no conflict when both made the same change, or only the person changed it', () => {
    expect(
      mergeFields(base, { ...base, title: 'Same' }, { ...base, title: 'Same' }).conflicts,
    ).toEqual({})
    expect(mergeFields(base, { ...base, title: 'Mine' }, base).conflicts).toEqual({})
  })

  it('compares arrays by value', () => {
    expect(sameValue(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameValue({ url: 'a' }, { url: 'a' })).toBe(true)
    expect(sameValue(['a'], ['a', 'b'])).toBe(false)
    const result = mergeFields(base, base, { ...base, links: ['https://b.example'] })
    expect(result.merged.links).toEqual(['https://b.example'])
  })

  it('sends only what changed, and drops a conflict once the values agree', () => {
    expect(changedFields(base, { ...base, title: 'New', start: '09:00' })).toEqual({ title: 'New' })
    const local = { ...base, title: 'Mine' }
    expect(carryConflicts({ title: 'Old theirs' }, { title: 'Newer theirs' }, local)).toEqual({
      title: 'Newer theirs',
    })
    expect(carryConflicts({ title: 'Mine' }, {}, local)).toEqual({})
  })

  it('a stop edited in two places ends up with both changes (title here, time there)', () => {
    const tz = 'Pacific/Auckland'
    const stop = draftStop('t1', 's1', {
      dayId: 'd1',
      title: 'Hooker Valley',
      startAt: '2026-12-20T20:00:00Z',
    })
    const opened = toDraft(stop, tz, ['NZD'])
    const editing = { ...opened, title: 'Hooker Valley Track' }
    const theirs = { ...stop, startAt: '2026-12-20T21:30:00Z' }
    const { merged, conflicts } = mergeFields(opened, editing, toDraft(theirs, tz, ['NZD']))
    expect(conflicts).toEqual({})
    const values = draftValues(merged, '2026-12-21', tz)
    const sent = changedFields(draftValues(toDraft(theirs, tz, ['NZD']), '2026-12-21', tz), values)
    // Only the title goes out: the time someone else set is not overwritten
    expect(sent).toEqual({ title: 'Hooker Valley Track' })
    expect(values.startAt).toBe('2026-12-20T21:30:00Z')
  })
})

describe('waiting edits over fetched days', () => {
  const stop = (id: string, order: number, dayId = 'd1'): Stop =>
    draftStop('t1', id, { dayId, title: id, order } as Partial<Stop> & { dayId: string })
  const fetched = (): { days: DayWithStops[]; legs: LegOverride[] } => ({
    days: [
      {
        id: 'd1',
        tripId: 't1',
        date: '2026-12-20',
        idx: 1,
        title: '',
        color: null,
        note: '',
        lodgingId: null,
        rev: 1,
        updatedAt: '',
        stops: [
          { ...stop('a', 1), order: 1 },
          { ...stop('b', 2), order: 2 },
        ],
      },
      {
        id: 'd2',
        tripId: 't1',
        date: '2026-12-21',
        idx: 2,
        title: '',
        color: null,
        note: '',
        lodgingId: null,
        rev: 1,
        updatedAt: '',
        stops: [],
      },
    ],
    legs: [],
  })
  const P = 'pending-00000000-0000-4000-8000-000000000001'

  it('adds a created stop, moves it, patches, deletes and overrides legs in queue order', () => {
    const view = applyPending(fetched(), 't1', [
      { op: { kind: 'stop.create', body: { dayId: 'd1', title: 'New' } }, tempId: P },
      { op: { kind: 'stop.move', stopId: P, body: { dayId: 'd2', afterStopId: null } } },
      { op: { kind: 'stop.patch', stopId: 'a', body: { title: 'A!' } } },
      { op: { kind: 'stop.delete', stopId: 'b' } },
      { op: { kind: 'leg.put', fromStopId: 'a', toStopId: P, body: { mode: 'walk', minutes: 5 } } },
      { op: { kind: 'day.patch', dayId: 'd2', body: { title: 'Mt Cook' } } },
    ])
    expect(view.days[0].stops.map((s) => [s.id, s.title])).toEqual([['a', 'A!']])
    expect(view.days[1].stops.map((s) => s.id)).toEqual([P])
    expect(view.days[1].title).toBe('Mt Cook')
    expect(view.legs).toMatchObject([{ fromStopId: 'a', toStopId: P, mode: 'walk', minutes: 5 }])
    const again = applyPending(view, 't1', [
      { op: { kind: 'leg.delete', fromStopId: 'a', toStopId: P } },
    ])
    expect(again.legs).toEqual([])
  })

  it('places a create after a given stop, and ignores one already fetched', () => {
    const view = applyPending(fetched(), 't1', [
      { op: { kind: 'stop.create', body: { dayId: 'd1', afterStopId: 'a' } }, tempId: P },
    ])
    expect(view.days[0].stops.map((s) => s.id)).toEqual(['a', P, 'b'])
    const twice = applyPending(view, 't1', [
      { op: { kind: 'stop.create', body: { dayId: 'd1' } }, tempId: P },
    ])
    expect(twice.days[0].stops).toHaveLength(3)
  })
})
