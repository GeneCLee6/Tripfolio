import type { PlaceRefsResponse } from '../../../shared/api/types.ts'
import type { MessageKey } from '../../../shared/i18n/t.ts'
import type { PlaceSource, StopType } from '../../../shared/schema/index.ts'
import type { DuplicateReason } from '../../lib/places/dedupe.ts'
import type { PlaceCategory, PlaceSort } from '../../lib/places/library.ts'

// Message keys and small mappings the place library shares

export const CATEGORY_LABEL: Record<PlaceCategory, MessageKey> = {
  sight: 'places.category.sight',
  food: 'places.category.food',
  shopping: 'places.category.shopping',
  lodging: 'places.category.lodging',
  transport: 'places.category.transport',
  fuel: 'places.category.fuel',
  supplies: 'places.category.supplies',
  nature: 'places.category.nature',
  rest: 'places.category.rest',
  other: 'places.category.other',
}

export const SOURCE_LABEL: Record<PlaceSource, MessageKey> = {
  photon: 'places.source.photon',
  nominatim: 'places.source.nominatim',
  manual: 'places.source.manual',
  link: 'places.source.link',
  coords: 'places.source.coords',
}

export const SORT_LABEL: Record<PlaceSort, MessageKey> = {
  name: 'places.sort.name',
  refs: 'places.sort.refs',
  unused: 'places.sort.unused',
}

export const REASON_LABEL: Record<DuplicateReason, MessageKey> = {
  externalId: 'places.dupes.reason.externalId',
  name: 'places.dupes.reason.name',
  distance: 'places.dupes.reason.distance',
}

/** The glyph a category is drawn with (`nature` has no glyph of its own: it is a sight) */
export function glyphOf(category: PlaceCategory): StopType {
  return category === 'nature' ? 'sight' : category
}

/** How many items GET /places/:pid/refs listed */
export function refsTotal(refs: PlaceRefsResponse): number {
  return refs.stops.length + refs.wishlistItems.length + refs.lodgings.length + refs.bookings.length
}
