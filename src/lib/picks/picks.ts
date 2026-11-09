import type {
  DayWithStops,
  Trip,
  WishlistClaim,
  WishlistItemView,
} from '../../../shared/api/types.ts'
import { isCurrencyCode, minorUnitsOf, type CurrencyCode } from '../../../shared/money/currencies.ts'
import type { WishlistCategory, WishlistStatus } from '../../../shared/schema/index.ts'

// Pure helpers of the picks page (e5-t02..t04): filtering, sorting and grouping the card wall,
// which day a scheduled item sits on, and the claim summary on a must-buy card.

export const PICK_CATEGORIES: readonly WishlistCategory[] = ['eat', 'buy', 'see', 'experience']

export type CategoryFilter = 'all' | WishlistCategory
export type PickSort = 'newest' | 'votes' | 'price'
export type PickGrouping = 'none' | 'category' | 'day'
/** The status chips: 想去 (wish) / 已排入 (scheduled) / 已完成 (done); none selected = everything */
export type StatusFilter = 'wish' | 'scheduled' | 'done'
export const STATUS_FILTERS: readonly StatusFilter[] = ['wish', 'scheduled', 'done']

/** Where a scheduled item's stop is: its day, numbered from 1 (null for unassigned days) */
export interface StopDay {
  dayId: string
  idx: number | null
  date: string | null
  title: string
}

/** stopId → its day, for every stop in the itinerary */
export function stopDays(days: readonly DayWithStops[]): Map<string, StopDay> {
  const out = new Map<string, StopDay>()
  for (const day of days) {
    for (const stop of day.stops) {
      out.set(stop.id, { dayId: day.id, idx: day.idx, date: day.date, title: day.title })
    }
  }
  return out
}

export interface PickFilters {
  category: CategoryFilter
  statuses: ReadonlySet<StatusFilter>
}

export function filterPicks(
  items: readonly WishlistItemView[],
  { category, statuses }: PickFilters,
): WishlistItemView[] {
  return items.filter(
    (item) =>
      (category === 'all' || item.category === category) &&
      (statuses.size === 0 || statuses.has(item.status as StatusFilter)),
  )
}

/** An estimate in major units (for ordering only; currencies are not converted) */
function major(item: WishlistItemView): number | null {
  if (item.estMinor === null) return null
  const digits = item.currency && isCurrencyCode(item.currency) ? minorUnitsOf(item.currency) : 2
  return item.estMinor / 10 ** digits
}

const newestFirst = (a: WishlistItemView, b: WishlistItemView) =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)

/**
 * newest: created last first · votes: most 「想去」 first (then newest) · price: cheapest first,
 * items without a price last (then newest). Never mutates `items`.
 */
export function sortPicks(items: readonly WishlistItemView[], sort: PickSort): WishlistItemView[] {
  const list = [...items]
  if (sort === 'votes') return list.sort((a, b) => b.votes.length - a.votes.length || newestFirst(a, b))
  if (sort === 'price') {
    return list.sort((a, b) => {
      const pa = major(a)
      const pb = major(b)
      if (pa === null || pb === null) return pa === pb ? newestFirst(a, b) : pa === null ? 1 : -1
      return pa - pb || newestFirst(a, b)
    })
  }
  return list.sort(newestFirst)
}

export type PickGroup =
  | { key: string; kind: 'all'; items: WishlistItemView[] }
  | { key: string; kind: 'category'; category: WishlistCategory; items: WishlistItemView[] }
  | { key: string; kind: 'day'; day: StopDay; items: WishlistItemView[] }
  | { key: string; kind: 'pocket'; items: WishlistItemView[] }

/**
 * Splits already sorted items into sections. `category`: the four categories in order (empty ones
 * left out). `day`: items whose stop is on a day, by day (assigned days in order, unassigned after),
 * then everything else under the pocket list.
 */
export function groupPicks(
  items: readonly WishlistItemView[],
  grouping: PickGrouping,
  dayOfStop: ReadonlyMap<string, StopDay>,
): PickGroup[] {
  if (grouping === 'none') return items.length ? [{ key: 'all', kind: 'all', items: [...items] }] : []
  if (grouping === 'category') {
    return PICK_CATEGORIES.map((category) => ({
      key: `category:${category}`,
      kind: 'category' as const,
      category,
      items: items.filter((item) => item.category === category),
    })).filter((group) => group.items.length > 0)
  }
  const byDay = new Map<string, { day: StopDay; items: WishlistItemView[] }>()
  const pocket: WishlistItemView[] = []
  for (const item of items) {
    const day = item.stopId ? dayOfStop.get(item.stopId) : undefined
    if (!day) {
      pocket.push(item)
      continue
    }
    const entry = byDay.get(day.dayId) ?? { day, items: [] }
    entry.items.push(item)
    byDay.set(day.dayId, entry)
  }
  const days = [...byDay.values()].sort((a, b) => {
    if (a.day.idx === null || b.day.idx === null) {
      if (a.day.idx !== b.day.idx) return a.day.idx === null ? 1 : -1
      return (a.day.date ?? '').localeCompare(b.day.date ?? '')
    }
    return a.day.idx - b.day.idx
  })
  const groups: PickGroup[] = days.map(({ day, items: list }) => ({
    key: `day:${day.dayId}`,
    kind: 'day',
    day,
    items: list,
  }))
  if (pocket.length) groups.push({ key: 'pocket', kind: 'pocket', items: pocket })
  return groups
}

export interface ClaimSummary {
  /** Sum of the claims' quantities */
  qty: number
  /** Distinct buyers in claim order (members only) */
  buyerIds: string[]
  /** Claims ticked as bought */
  done: number
  count: number
}

export function claimSummary(claims: readonly WishlistClaim[]): ClaimSummary {
  const buyerIds: string[] = []
  let qty = 0
  let done = 0
  for (const claim of claims) {
    qty += claim.qty
    if (claim.done) done++
    if (claim.buyerMemberId && !buyerIds.includes(claim.buyerMemberId)) buyerIds.push(claim.buyerMemberId)
  }
  return { qty, buyerIds, done, count: claims.length }
}

/** The statuses an item can be set to from the form (the API's rules, e5 設計方向) */
export function statusChoices(item: Pick<WishlistItemView, 'status' | 'stopId'>): WishlistStatus[] {
  if (item.status === 'scheduled') return ['scheduled', 'done']
  if (item.status === 'done' && item.stopId) return ['scheduled', 'done']
  return ['wish', 'done', 'dropped']
}

/** Currencies the price field offers: the trip's local ones first, then base and secondary */
export function priceCurrencies(
  trip: Pick<Trip, 'localCurrencies' | 'baseCurrency' | 'secondaryCurrency'>,
  current: string | null,
): CurrencyCode[] {
  const list = [...trip.localCurrencies, trip.baseCurrency, trip.secondaryCurrency, current]
  return [...new Set(list)].filter((code): code is CurrencyCode => !!code && isCurrencyCode(code))
}

/** Toggles one value in a set (a new set) */
export function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

/** Whether a string is an http(s) URL the API accepts as a source link */
export function isHttpUrl(text: string): boolean {
  const value = text.trim()
  if (!/^https?:\/\/\S+$/i.test(value) || value.length > 2000) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
