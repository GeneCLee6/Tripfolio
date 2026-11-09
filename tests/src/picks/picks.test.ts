import { describe, expect, it } from 'vitest'
import type {
  DayWithStops,
  Stop,
  WishlistClaim,
  WishlistItemView,
} from '../../../shared/api/types.ts'
import { buildTripMapData, PICK_ID_PREFIX } from '../../../src/lib/map/assemble.ts'
import {
  claimSummary,
  filterPicks,
  groupPicks,
  isHttpUrl,
  priceCurrencies,
  sortPicks,
  statusChoices,
  stopDays,
  toggled,
  type StatusFilter,
} from '../../../src/lib/picks/picks.ts'

function item(id: string, extra: Partial<WishlistItemView> = {}): WishlistItemView {
  return {
    id,
    tripId: 't1',
    category: 'eat',
    name: `Item ${id}`,
    placeId: null,
    photoAttachmentId: null,
    estMinor: null,
    currency: null,
    sourceUrl: null,
    sourceTitle: null,
    sourceImageUrl: null,
    recommenderMemberId: null,
    note: '',
    status: 'wish',
    stopId: null,
    order: 1,
    rev: 1,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    votes: [],
    claims: [],
    place: null,
    ...extra,
  }
}

function stop(id: string, dayId: string): Stop {
  return {
    id,
    tripId: 't1',
    dayId,
    order: 1,
    type: 'food',
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
  }
}

function day(id: string, idx: number | null, stops: Stop[], date: string | null = null): DayWithStops {
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

function claim(id: string, extra: Partial<WishlistClaim> = {}): WishlistClaim {
  return {
    id,
    itemId: 'i',
    buyerMemberId: null,
    forName: '',
    qty: 1,
    done: false,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...extra,
  }
}

const days = [
  day('d2', 2, [stop('s2', 'd2')], '2026-12-02'),
  day('d1', 1, [stop('s1', 'd1')], '2026-12-01'),
  day('dx', null, [stop('sx', 'dx')], '2026-11-20'),
]

const items = [
  item('a', { createdAt: '2026-11-01T00:00:00Z', votes: ['m1'], estMinor: 2000, currency: 'NZD' }),
  item('b', {
    category: 'buy',
    createdAt: '2026-11-03T00:00:00Z',
    votes: ['m1', 'm2', 'm3'],
    estMinor: 450,
    currency: 'NZD',
    status: 'scheduled',
    stopId: 's2',
  }),
  item('c', { category: 'see', createdAt: '2026-11-02T00:00:00Z', estMinor: 0, currency: 'NZD' }),
  // JPY has no minor unit: 1500 is JPY 1500, so it sorts after NZD 20.00
  item('d', {
    category: 'buy',
    createdAt: '2026-11-04T00:00:00Z',
    votes: ['m2'],
    estMinor: 1500,
    currency: 'JPY',
    status: 'done',
    stopId: 's1',
  }),
  item('e', { category: 'experience', createdAt: '2026-11-05T00:00:00Z', status: 'dropped' }),
  item('f', { createdAt: '2026-11-05T00:00:00Z', stopId: 'sx', status: 'scheduled' }),
]
const ids = (list: readonly WishlistItemView[]) => list.map((i) => i.id)

describe('sortPicks', () => {
  it('newest first, ties by id', () => {
    expect(ids(sortPicks(items, 'newest'))).toEqual(['e', 'f', 'd', 'b', 'c', 'a'])
  })
  it('most votes first, then newest', () => {
    expect(ids(sortPicks(items, 'votes'))).toEqual(['b', 'd', 'a', 'e', 'f', 'c'])
  })
  it('cheapest first in major units, unpriced last', () => {
    expect(ids(sortPicks(items, 'price'))).toEqual(['c', 'b', 'a', 'd', 'e', 'f'])
  })
  it('does not mutate the input', () => {
    const copy = [...items]
    sortPicks(items, 'votes')
    expect(items).toEqual(copy)
  })
})

describe('filterPicks', () => {
  const none = new Set<StatusFilter>()
  it('by category', () => {
    expect(ids(filterPicks(items, { category: 'buy', statuses: none }))).toEqual(['b', 'd'])
    expect(filterPicks(items, { category: 'all', statuses: none })).toHaveLength(items.length)
  })
  it('by any of the selected statuses; dropped only shows unfiltered', () => {
    const statuses = new Set<StatusFilter>(['wish', 'done'])
    expect(ids(filterPicks(items, { category: 'all', statuses }))).toEqual(['a', 'c', 'd'])
    expect(ids(filterPicks(items, { category: 'buy', statuses }))).toEqual(['d'])
  })
  it('toggled adds and removes', () => {
    const once = toggled(new Set<StatusFilter>(), 'wish')
    expect([...once]).toEqual(['wish'])
    expect(toggled(once, 'wish').size).toBe(0)
  })
})

describe('groupPicks', () => {
  const dayOf = stopDays(days)

  it('stopDays maps every stop to its day', () => {
    expect(dayOf.get('s2')).toEqual({ dayId: 'd2', idx: 2, date: '2026-12-02', title: '' })
    expect(dayOf.get('sx')?.idx).toBeNull()
  })

  it('none: one group, or nothing for no items', () => {
    expect(groupPicks(items, 'none', dayOf).map((g) => g.kind)).toEqual(['all'])
    expect(groupPicks([], 'none', dayOf)).toEqual([])
  })

  it('category: fixed order, empty categories left out, order kept inside', () => {
    const groups = groupPicks(sortPicks(items, 'newest'), 'category', dayOf)
    expect(groups.map((g) => g.key)).toEqual([
      'category:eat',
      'category:buy',
      'category:see',
      'category:experience',
    ])
    expect(ids(groups[1]!.items)).toEqual(['d', 'b'])
    expect(groupPicks([items[0]!], 'category', dayOf).map((g) => g.key)).toEqual(['category:eat'])
  })

  it('day: by day number, unassigned days after, the rest under the pocket list', () => {
    const groups = groupPicks(items, 'day', dayOf)
    expect(groups.map((g) => g.key)).toEqual(['day:d1', 'day:d2', 'day:dx', 'pocket'])
    expect(ids(groups[0]!.items)).toEqual(['d'])
    expect(ids(groups[3]!.items)).toEqual(['a', 'c', 'e'])
  })

  it('day: a stop that is no longer in the itinerary counts as pocket', () => {
    const lost = item('g', { stopId: 'gone', status: 'scheduled' })
    expect(groupPicks([lost], 'day', dayOf).map((g) => g.kind)).toEqual(['pocket'])
  })
})

describe('claims, statuses, currencies, links', () => {
  it('claimSummary adds quantities and lists distinct buyers', () => {
    expect(
      claimSummary([
        claim('1', { buyerMemberId: 'm2', qty: 2 }),
        claim('2', { buyerMemberId: null, qty: 1, done: true }),
        claim('3', { buyerMemberId: 'm2', qty: 3 }),
        claim('4', { buyerMemberId: 'm1', qty: 1 }),
      ]),
    ).toEqual({ qty: 7, buyerIds: ['m2', 'm1'], done: 1, count: 4 })
    expect(claimSummary([])).toEqual({ qty: 0, buyerIds: [], done: 0, count: 0 })
  })

  it('statusChoices follow the API rules', () => {
    expect(statusChoices({ status: 'wish', stopId: null })).toEqual(['wish', 'done', 'dropped'])
    expect(statusChoices({ status: 'scheduled', stopId: 's' })).toEqual(['scheduled', 'done'])
    expect(statusChoices({ status: 'done', stopId: 's' })).toEqual(['scheduled', 'done'])
    expect(statusChoices({ status: 'done', stopId: null })).toEqual(['wish', 'done', 'dropped'])
  })

  it('priceCurrencies: local first, no duplicates, unknown codes dropped', () => {
    expect(
      priceCurrencies(
        { localCurrencies: ['NZD'], baseCurrency: 'AUD', secondaryCurrency: 'TWD' },
        'NZD',
      ),
    ).toEqual(['NZD', 'AUD', 'TWD'])
    expect(
      priceCurrencies({ localCurrencies: [], baseCurrency: 'AUD', secondaryCurrency: null }, 'XXX'),
    ).toEqual(['AUD'])
  })

  it('isHttpUrl', () => {
    expect(isHttpUrl(' https://fergburger.com/menu ')).toBe(true)
    expect(isHttpUrl('ftp://x.com')).toBe(false)
    expect(isHttpUrl('fergburger.com')).toBe(false)
    expect(isHttpUrl('https://a b.com')).toBe(false)
  })
})

describe('picks map layer (buildTripMapData)', () => {
  const place = (id: string) => ({ id, nameLocal: id, nameEn: '', lat: -45, lng: 168.6 })
  const wishlist = [
    item('w1', { place: place('p1'), category: 'see' }),
    item('w2', { place: place('p2'), stopId: 's2', status: 'scheduled' }),
    item('w3', { place: place('p3'), status: 'dropped' }),
    item('w4', { place: null }),
    item('w5', { place: place('p5'), stopId: 'sx', status: 'scheduled' }),
  ]

  it('items with a place, not dropped; scheduled ones carry their day (0-based)', () => {
    const data = buildTripMapData(days, [], [], { tz: 'Pacific/Auckland', locale: 'en' }, wishlist)
    expect(data.picks).toEqual([
      { id: `${PICK_ID_PREFIX}w1`, lat: -45, lng: 168.6, name: 'Item w1', type: 'see' },
      { id: `${PICK_ID_PREFIX}w2`, lat: -45, lng: 168.6, name: 'Item w2', type: 'eat', dayIndex: 1 },
      { id: `${PICK_ID_PREFIX}w5`, lat: -45, lng: 168.6, name: 'Item w5', type: 'eat' },
    ])
  })

  it('no wishlist: an empty layer', () => {
    expect(buildTripMapData(days, [], [], { tz: 'UTC', locale: 'en' }).picks).toEqual([])
  })
})
