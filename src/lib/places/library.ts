import type { Booking, Lodging } from '../../../shared/api/bookings.ts'
import type { DayWithStops, Place, WishlistItem } from '../../../shared/api/types.ts'
import type { Locale } from '../../../shared/i18n/t.ts'

// The place library's list (e3-t05): how many things point at each place, and the search, category
// filter and sort the page offers. Pure functions, so they are unit-tested on their own.

/** The place categories search gives (shared/api/geo.ts) plus `rest`, in the filter's order */
export const PLACE_CATEGORIES = [
  'sight',
  'food',
  'shopping',
  'lodging',
  'transport',
  'fuel',
  'supplies',
  'nature',
  'rest',
  'other',
] as const
export type PlaceCategory = (typeof PLACE_CATEGORIES)[number]

const KNOWN: ReadonlySet<string> = new Set(PLACE_CATEGORIES)

/** A stored category as one the page knows (anything else is `other`) */
export function placeCategory(category: string): PlaceCategory {
  return KNOWN.has(category) ? (category as PlaceCategory) : 'other'
}

/** The booking details keys that hold a placeId (worker/trips/places.ts BOOKING_PLACE_FIELDS) */
const BOOKING_PLACE_FIELDS = ['pickupPlaceId', 'dropoffPlaceId', 'meetingPlaceId'] as const

export interface RefSources {
  days: readonly Pick<DayWithStops, 'stops'>[]
  wishlist: readonly Pick<WishlistItem, 'placeId'>[]
  lodgings: readonly Pick<Lodging, 'placeId'>[]
  bookings: readonly Pick<Booking, 'details'>[]
}

/**
 * How many items point at each place: stops (every day, unassigned ones too), wishlist items,
 * lodgings, and bookings (once per booking, however many of its fields name the place). The same
 * things GET /places/:pid/refs lists, counted from the lists the page loads anyway.
 */
export function countRefs(sources: RefSources): Map<string, number> {
  const counts = new Map<string, number>()
  const add = (placeId: string | null | undefined) => {
    if (placeId) counts.set(placeId, (counts.get(placeId) ?? 0) + 1)
  }
  for (const day of sources.days) for (const stop of day.stops) add(stop.placeId)
  for (const item of sources.wishlist) add(item.placeId)
  for (const lodging of sources.lodgings) add(lodging.placeId)
  for (const booking of sources.bookings) {
    const details = (booking.details ?? {}) as Record<string, unknown>
    const ids = new Set<string>()
    for (const field of BOOKING_PLACE_FIELDS) {
      const value = details[field]
      if (typeof value === 'string' && value) ids.add(value)
    }
    for (const id of ids) add(id)
  }
  return counts
}

export type PlaceSort = 'name' | 'refs' | 'unused'

export interface LibraryQuery {
  /** Matched against both names and the address, ignoring case, accents and punctuation */
  text: string
  /** `all` or one category */
  category: PlaceCategory | 'all'
  sort: PlaceSort
}

/** Lower case, accents and width folded, punctuation and spaces dropped: for search and dedupe */
export function foldText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
}

/** The name to show: the English one in English when there is one, else the local name */
export function displayName(place: Pick<Place, 'nameLocal' | 'nameEn'>, locale: Locale): string {
  return locale === 'en' && place.nameEn ? place.nameEn : place.nameLocal
}

/**
 * The places the list shows: matching the search and category, sorted by name (in the UI
 * language), by most referenced (then name), or unused first (then name)
 */
export function filterAndSort(
  places: readonly Place[],
  refs: ReadonlyMap<string, number>,
  query: LibraryQuery,
  locale: Locale,
): Place[] {
  const needle = foldText(query.text)
  const collator = new Intl.Collator(locale)
  const byName = (a: Place, b: Place) =>
    collator.compare(displayName(a, locale), displayName(b, locale)) || a.id.localeCompare(b.id)
  const count = (place: Place) => refs.get(place.id) ?? 0
  const list = places.filter((place) => {
    if (query.category !== 'all' && placeCategory(place.category) !== query.category) return false
    if (!needle) return true
    return [place.nameLocal, place.nameEn, place.address].some((field) =>
      foldText(field).includes(needle),
    )
  })
  if (query.sort === 'refs') return list.sort((a, b) => count(b) - count(a) || byName(a, b))
  if (query.sort === 'unused') {
    return list.sort((a, b) => Number(count(a) > 0) - Number(count(b) > 0) || byName(a, b))
  }
  return list.sort(byName)
}

/** Coordinates as the list writes them: five decimals (about a metre) */
export function coordsText(place: Pick<Place, 'lat' | 'lng'>): string {
  return `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`
}
