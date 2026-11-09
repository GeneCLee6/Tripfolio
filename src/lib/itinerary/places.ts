import type { GeoResult } from '../../../shared/api/geo.ts'
import type { Place } from '../../../shared/api/types.ts'
import type { Locale } from '../../../shared/i18n/t.ts'
import type { PlaceCreate, StopType } from '../../../shared/schema/index.ts'

// Place helpers for the picker (e3-t02): which name to show, how a search result becomes a places
// row, how to find a row we already have, and whether typed text is a location rather than a query.

/** The name to show: the English one in English when there is one, else the local name */
export function placeName(place: Pick<Place, 'nameLocal' | 'nameEn'>, locale: Locale): string {
  return locale === 'en' && place.nameEn ? place.nameEn : place.nameLocal
}

// The stop types a search category can be as-is (kept here, not imported from shared/schema, so the
// picker does not pull zod into the app's first screen)
const DIRECT: ReadonlySet<string> = new Set<StopType>([
  'sight',
  'food',
  'shopping',
  'lodging',
  'transport',
  'fuel',
  'supplies',
  'rest',
  'other',
])

/** Search categories → stop types (`nature` has no stop type of its own: it is a sight) */
export function stopTypeForCategory(category: string): StopType {
  if (category === 'nature') return 'sight'
  return DIRECT.has(category) ? (category as StopType) : 'other'
}

const OSM_KINDS: Record<string, string> = { N: 'node', W: 'way', R: 'relation' }

/**
 * The OpenStreetMap page of a search result (`osm:N336415647` → …/node/336415647). Places have no
 * externalId column, so this link is what marks a row as coming from that result.
 */
export function osmUrl(externalId: string): string | null {
  const match = /^osm:([NWR])(\d+)$/.exec(externalId)
  return match ? `https://www.openstreetmap.org/${OSM_KINDS[match[1]]}/${match[2]}` : null
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-5

/** A place of the trip that is this search result already (same OSM element, or same name and spot) */
export function findExistingPlace(places: readonly Place[], result: GeoResult): Place | null {
  const url = osmUrl(result.externalId)
  if (url) {
    const byLink = places.find((place) => place.links.some((link) => link.url === url))
    if (byLink) return byLink
  }
  return (
    places.find(
      (place) =>
        place.nameLocal === result.nameLocal &&
        near(place.lat, result.lat) &&
        near(place.lng, result.lng),
    ) ?? null
  )
}

/** The POST /places body for a search result */
export function placeFromResult(result: GeoResult): PlaceCreate {
  const url = osmUrl(result.externalId)
  return {
    nameLocal: result.nameLocal || result.nameEn || result.address || `${result.lat}, ${result.lng}`,
    nameEn: result.nameEn,
    lat: result.lat,
    lng: result.lng,
    address: result.address,
    category: result.category,
    source: result.source,
    hours: null,
    links: url ? [{ url, label: 'OpenStreetMap' }] : [],
  }
}

// Separators between latitude and longitude: comma, the full-width comma, or spaces
const SEP = '[,\\uFF0C\\s]'
const COORDS = new RegExp(
  `^\\s*\\(?\\s*(-?\\d{1,2}(?:\\.\\d+)?)\\s*${SEP}\\s*(-?\\d{1,3}(?:\\.\\d+)?)\\s*\\)?\\s*$`,
)
const MAPS_URL =
  /(?:https?:\/\/)?(?:maps\.app\.goo\.gl\/|goo\.gl\/maps\/|(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+\/)/i

/** True when the text is coordinates or a Google Maps link (sent to /geo/parse, not searched) */
export function looksLikeLocation(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  const coords = COORDS.exec(value)
  if (coords) return Math.abs(Number(coords[1])) <= 90 && Math.abs(Number(coords[2])) <= 180
  return MAPS_URL.test(value)
}
