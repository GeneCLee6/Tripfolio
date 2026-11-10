import { describe, expect, it } from 'vitest'
import type { Place } from '../../../shared/api/types.ts'
import { isOpenAt } from '../../../shared/itinerary/checks.ts'
import { openingHoursOf } from '../../../src/lib/itinerary/checks.ts'
import {
  distanceM,
  duplicateReason,
  findDuplicateGroups,
} from '../../../src/lib/places/dedupe.ts'
import {
  draftFromHours,
  emptyDraft,
  hoursFromDraft,
  isClosedDay,
  withDay,
} from '../../../src/lib/places/hours.ts'
import {
  countRefs,
  filterAndSort,
  foldText,
  placeCategory,
} from '../../../src/lib/places/library.ts'

// e3-t05: dedupe heuristics, the hours editor's draft ↔ stored hours, ref counts, filter and sort

let seq = 0
function place(overrides: Partial<Place> = {}): Place {
  seq++
  return {
    id: `p${seq}`,
    tripId: 't1',
    nameLocal: `Place ${seq}`,
    nameEn: '',
    lat: -45 - seq,
    lng: 168 + seq,
    address: '',
    category: 'other',
    source: 'manual',
    hours: null,
    links: [],
    externalId: null,
    rev: 1,
    createdAt: `2026-11-09T00:00:${String(seq % 60).padStart(2, '0')}Z`,
    updatedAt: '2026-11-09T00:00:00Z',
    ...overrides,
  }
}

// About 11 m per 0.0001° of latitude
const ferg = { lat: -45.0318, lng: 168.6598 }

describe('dedupe', () => {
  it('measures distance', () => {
    expect(distanceM(ferg, { lat: ferg.lat + 0.001, lng: ferg.lng })).toBeCloseTo(111.2, 0)
  })

  it('same externalId wins regardless of distance', () => {
    const a = place({ externalId: 'osm:N1', ...ferg })
    const b = place({ externalId: 'osm:N1', lat: 10, lng: 10 })
    expect(duplicateReason(a, b)).toBe('externalId')
  })

  it('same normalized name within 100 m', () => {
    const a = place({ nameLocal: 'Fergburger', ...ferg })
    const b = place({ nameLocal: 'FERG-burger ', lat: ferg.lat + 0.0008, lng: ferg.lng })
    expect(duplicateReason(a, b)).toBe('name')
    const far = place({ nameLocal: 'Fergburger', lat: ferg.lat + 0.002, lng: ferg.lng })
    expect(duplicateReason(a, far)).toBeNull()
  })

  it('matches the English name against the local one, accents folded', () => {
    const a = place({ nameLocal: '富士山', nameEn: 'Mount Fuji', ...ferg })
    const b = place({ nameLocal: 'Mount Fují', lat: ferg.lat + 0.0005, lng: ferg.lng })
    expect(duplicateReason(a, b)).toBe('name')
  })

  it('any two places under 25 m apart', () => {
    const a = place({ nameLocal: 'Cafe', ...ferg })
    const b = place({ nameLocal: 'Bakery', lat: ferg.lat + 0.0001, lng: ferg.lng })
    expect(duplicateReason(a, b)).toBe('distance')
    const c = place({ nameLocal: 'Bakery', lat: ferg.lat + 0.0004, lng: ferg.lng })
    expect(duplicateReason(a, c)).toBeNull()
  })

  it('groups transitively, most referenced first', () => {
    const a = place({ nameLocal: 'A', ...ferg })
    const b = place({ nameLocal: 'B', lat: ferg.lat + 0.0001, lng: ferg.lng })
    const c = place({ nameLocal: 'C', lat: ferg.lat + 0.0002, lng: ferg.lng })
    const lone = place({ nameLocal: 'Lone' })
    const groups = findDuplicateGroups([a, b, c, lone], new Map([[c.id, 2]]))
    expect(groups).toHaveLength(1)
    expect(groups[0].places.map((p) => p.id)).toEqual([c.id, a.id, b.id])
    expect(groups[0].reasons).toEqual(['distance'])
  })

  it('prefers a place with a search id, then the oldest', () => {
    const a = place({ nameLocal: 'X', ...ferg })
    const b = place({ nameLocal: 'X', externalId: 'osm:N9', lat: ferg.lat + 0.0005, lng: ferg.lng })
    expect(findDuplicateGroups([a, b])[0].places[0].id).toBe(b.id)
    const c = place({ nameLocal: 'Y', ...ferg })
    const d = place({ nameLocal: 'Y', lat: ferg.lat + 0.0005, lng: ferg.lng })
    expect(findDuplicateGroups([d, c])[0].places[0].id).toBe(c.id)
  })
})

describe('hours draft', () => {
  // 2030-12-16 is a Monday
  const MONDAY = '2030-12-16'
  const TUESDAY = '2030-12-17'

  it('Mon 09:00–17:00 round-trips and drives isOpenAt', () => {
    const draft = withDay(emptyDraft(), 1, [{ open: '09:00', close: '17:00' }])
    const { hours, issues } = hoursFromDraft(draft)
    expect(issues).toEqual([])
    expect(hours).toEqual({ periods: [{ day: 1, open: '09:00', close: '17:00' }] })
    expect(draftFromHours(hours)).toEqual(draft)
    const weekly = openingHoursOf(hours)!
    expect(isOpenAt(weekly, MONDAY, 10 * 60)).toBe(true)
    expect(isOpenAt(weekly, MONDAY, 18 * 60)).toBe(false)
    // Other weekdays are closed once one weekday has hours
    expect(isOpenAt(weekly, TUESDAY, 10 * 60)).toBe(false)
    expect(isClosedDay(draft, 2)).toBe(true)
    expect(isClosedDay(draft, 1)).toBe(false)
  })

  it('keeps several ranges, past-midnight ranges and the note', () => {
    const hours = {
      text: 'Closed on public holidays',
      periods: [
        { day: 5, open: '11:00', close: '14:00' },
        { day: 5, open: '17:00', close: '02:00' },
      ],
    }
    const draft = draftFromHours(hours)
    expect(draft.days[5]).toHaveLength(2)
    expect(hoursFromDraft(draft)).toEqual({ hours, issues: [] })
    const weekly = openingHoursOf(hours)!
    // Friday 2030-12-20 at 23:00, and 01:00 the next morning
    expect(isOpenAt(weekly, '2030-12-20', 23 * 60)).toBe(true)
    expect(isOpenAt(weekly, '2030-12-21', 60)).toBe(true)
    expect(isOpenAt(weekly, '2030-12-20', 15 * 60)).toBe(false)
  })

  it('empty means unknown (null) and nothing is closed', () => {
    expect(hoursFromDraft(emptyDraft())).toEqual({ hours: null, issues: [] })
    expect(isClosedDay(emptyDraft(), 1)).toBe(false)
    expect(draftFromHours(null)).toEqual(emptyDraft())
    expect(hoursFromDraft({ ...emptyDraft(), text: ' note ' }).hours).toEqual({ text: 'note' })
  })

  it('flags bad and equal times and too many ranges', () => {
    const bad = withDay(emptyDraft(), 0, [
      { open: '', close: '17:00' },
      { open: '10:00', close: '10:00' },
    ])
    expect(hoursFromDraft(bad).issues).toEqual([
      { day: 0, index: 0, problem: 'format' },
      { day: 0, index: 1, problem: 'same' },
    ])
    const many = { ...emptyDraft(), days: emptyDraft().days.map(() => Array.from({ length: 8 }, () => ({ open: '09:00', close: '10:00' }))) }
    expect(hoursFromDraft(many).issues).toContainEqual({ day: -1, index: -1, problem: 'tooMany' })
  })
})

describe('library list', () => {
  const a = place({ id: 'a', nameLocal: 'Église', address: 'Rue 1', category: 'sight' })
  const b = place({ id: 'b', nameLocal: 'Bakery', category: 'food' })
  const c = place({ id: 'c', nameLocal: 'Camp', nameEn: '', category: 'weird' })

  it('counts refs from days, wishlist, lodgings and bookings', () => {
    const refs = countRefs({
      days: [{ stops: [{ placeId: 'a' }, { placeId: 'a' }, { placeId: null }] as never }],
      wishlist: [{ placeId: 'b' }, { placeId: null }],
      lodgings: [{ placeId: 'c' }],
      bookings: [
        { details: { pickupPlaceId: 'a', dropoffPlaceId: 'a' } } as never,
        { details: { meetingPlaceId: 'b' } } as never,
        { details: {} } as never,
      ],
    })
    expect(Object.fromEntries(refs)).toEqual({ a: 3, b: 2, c: 1 })
  })

  it('folds text for search', () => {
    expect(foldText(' Église, St-Jean ')).toBe('eglisestjean')
  })

  it('maps unknown categories to other', () => {
    expect(placeCategory('weird')).toBe('other')
    expect(placeCategory('nature')).toBe('nature')
  })

  it('filters by text and category', () => {
    const refs = new Map<string, number>()
    const list = [a, b, c]
    const q = (text: string, category: 'all' | 'other' | 'food' = 'all') =>
      filterAndSort(list, refs, { text, category, sort: 'name' }, 'en').map((p) => p.id)
    expect(q('eglise')).toEqual(['a'])
    expect(q('rue')).toEqual(['a'])
    expect(q('', 'other')).toEqual(['c'])
    expect(q('', 'food')).toEqual(['b'])
  })

  it('sorts by name, most referenced and unused first', () => {
    const refs = new Map([
      ['a', 1],
      ['b', 5],
    ])
    const sort = (s: 'name' | 'refs' | 'unused') =>
      filterAndSort([a, b, c], refs, { text: '', category: 'all', sort: s }, 'en').map((p) => p.id)
    expect(sort('name')).toEqual(['b', 'c', 'a'])
    expect(sort('refs')).toEqual(['b', 'a', 'c'])
    expect(sort('unused')).toEqual(['c', 'b', 'a'])
  })
})
