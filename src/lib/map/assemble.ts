import {
  GEO_LIMITS,
  type RouteMode,
  type RouteRequest,
  type RouteResponse,
} from '../../../shared/api/geo.ts'
import type {
  DayWithStops,
  LegOverride,
  Place,
  Stop,
  WishlistItemView,
} from '../../../shared/api/types.ts'
import type { Locale } from '../../../shared/i18n/t.ts'
import {
  defaultModeForStyle,
  haversineM,
  legKey,
  type LatLng,
} from '../../../shared/itinerary/legs.ts'
import type { LegMode, TripStyle } from '../../../shared/itinerary/types.ts'
import { formatHm } from '../../../shared/time/tz.ts'
import type { MapPlace, MapRoute, MapStop, OvernightLink } from '../../map/types.ts'

// Pure assembly of the map page's data (e3-t04 frontend, e3-t05 layers): the API's days, stops,
// leg overrides and places become TripMap's props, and the day's legs become route requests for
// POST /geo/routes (batched, deduplicated, cached for the session).

/** Legs shorter than this are not drawn or routed (two stops at the same car park) */
export const MIN_LEG_M = 50

/** Stop types that also show on the fuel and supplies layer */
const FUEL_TYPES: ReadonlySet<string> = new Set(['fuel', 'supplies'])

/** Prefix of fuel-layer ids: the same stop is also an itinerary pin, and ids must not collide */
export const FUEL_ID_PREFIX = 'fuel:'

/** Prefix of picks-layer ids (wishlist items) */
export const PICK_ID_PREFIX = 'pick:'

export interface MapDay {
  id: string
  /** 0-based (the day colour; TripMap's `{ day }`) */
  dayIndex: number
  date: string | null
  title: string
}

/** A leg between consecutive stops of a day, ready to be routed or estimated */
export interface PlannedLeg {
  /** shared/itinerary legKey: `from>to` */
  key: string
  dayIndex: number
  fromStopId: string
  toStopId: string
  from: LatLng
  to: LatLng
  mode: LegMode
  /** What POST /geo/routes is asked for; null for transit / flight / ferry / other (estimate only) */
  routeMode: RouteMode | null
}

export interface TripMapData {
  days: MapDay[]
  stops: MapStop[]
  overnightLinks: OvernightLink[]
  pocket: MapPlace[]
  fuel: MapPlace[]
  /** E4 fills this from lodgings */
  lodging: MapPlace[]
  /** E5 fills this from the wishlist */
  picks: MapPlace[]
  legs: PlannedLeg[]
}

export interface AssembleOptions {
  tz: string
  locale: Locale
  style?: TripStyle
}

/** The name to show for a place: English when the interface is English and there is one */
export function placeName(place: Pick<Place, 'nameLocal' | 'nameEn'>, locale: Locale): string {
  if (locale === 'en' && place.nameEn.trim()) return place.nameEn
  return place.nameLocal || place.nameEn
}

/** The routing mode for a leg mode, or null when the leg is only ever estimated */
export function routeModeFor(mode: LegMode): RouteMode | null {
  if (mode === 'drive' || mode === 'campervan') return 'drive'
  if (mode === 'walk' || mode === 'cycle') return mode
  return null
}

/** Local `HH:mm` of a UTC instant in the trip's zone, or null */
export function localTime(iso: string | null, tz: string): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  try {
    return formatHm(ms, tz)
  } catch {
    return null
  }
}

interface LocatedStop {
  stop: Stop
  point: LatLng
}

export function buildTripMapData(
  days: readonly DayWithStops[],
  places: readonly Place[],
  overrides: readonly LegOverride[],
  options: AssembleOptions,
  wishlist: readonly WishlistItemView[] = [],
): TripMapData {
  const placeById = new Map(places.map((place) => [place.id, place]))
  const overrideByKey = new Map(overrides.map((leg) => [legKey(leg.fromStopId, leg.toStopId), leg]))
  const baseMode = defaultModeForStyle(options.style)
  const referenced = new Set<string>()

  const mapDays: MapDay[] = []
  const stops: MapStop[] = []
  const fuel: MapPlace[] = []
  const legs: PlannedLeg[] = []
  /** Per assigned day with located stops: its first and last non-backup located stop */
  const ends: { dayIndex: number; first: LatLng; last: LatLng }[] = []

  for (const day of days) {
    for (const stop of day.stops) if (stop.placeId) referenced.add(stop.placeId)
    // Unassigned days (idx null) are outside the trip's dates: not on the map
    if (day.idx === null) continue
    const dayIndex = day.idx - 1
    mapDays.push({ id: day.id, dayIndex, date: day.date, title: day.title })

    const ordered = [...day.stops].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    const located: LocatedStop[] = []
    ordered.forEach((stop, position) => {
      const place = stop.placeId ? placeById.get(stop.placeId) : undefined
      if (!place) return
      const point = { lat: place.lat, lng: place.lng }
      const name = stop.title.trim() || placeName(place, options.locale)
      // The pin number is the stop's place in the day's list, so it matches the itinerary page
      stops.push({
        id: stop.id,
        dayIndex,
        order: position + 1,
        lat: point.lat,
        lng: point.lng,
        type: stop.type,
        name,
        time: localTime(stop.startAt, options.tz),
      })
      if (FUEL_TYPES.has(stop.type)) {
        fuel.push({ id: `${FUEL_ID_PREFIX}${stop.id}`, ...point, name, type: stop.type, dayIndex })
      }
      if (!stop.isBackup) located.push({ stop, point })
    })

    for (let i = 0; i + 1 < located.length; i++) {
      const a = located[i]!
      const b = located[i + 1]!
      if (haversineM(a.point, b.point) < MIN_LEG_M) continue
      const key = legKey(a.stop.id, b.stop.id)
      const mode = overrideByKey.get(key)?.mode ?? baseMode
      legs.push({
        key,
        dayIndex,
        fromStopId: a.stop.id,
        toStopId: b.stop.id,
        from: a.point,
        to: b.point,
        mode,
        routeMode: routeModeFor(mode),
      })
    }
    if (located.length > 0) {
      ends.push({ dayIndex, first: located[0]!.point, last: located[located.length - 1]!.point })
    }
  }

  // Whole-trip view: night-to-night lines. Until lodgings exist (E4), a night is stood in for by
  // the last stop of the day and the next morning by the first stop of the next day that has
  // located stops; a day without located stops is skipped, so the line stays continuous.
  const overnightLinks: OvernightLink[] = []
  const sortedEnds = [...ends].sort((a, b) => a.dayIndex - b.dayIndex)
  for (let i = 0; i + 1 < sortedEnds.length; i++) {
    const night = sortedEnds[i]!
    const morning = sortedEnds[i + 1]!
    if (haversineM(night.last, morning.first) < MIN_LEG_M) continue
    overnightLinks.push({ dayIndex: night.dayIndex, from: night.last, to: morning.first })
  }

  // Pocket list: places no stop points at (lodgings and the wishlist will count as references too)
  const pocket: MapPlace[] = places
    .filter((place) => !referenced.has(place.id))
    .map((place) => ({
      id: place.id,
      lat: place.lat,
      lng: place.lng,
      name: placeName(place, options.locale),
      type: place.category,
    }))

  // Picks (e5-t03): wishlist items with a located place, except dropped ones; a scheduled item
  // carries its stop's day (assigned days only). Ids are prefixed: the place may also be a pin.
  const dayOfStop = new Map<string, number>()
  for (const day of days) {
    if (day.idx !== null) for (const stop of day.stops) dayOfStop.set(stop.id, day.idx - 1)
  }
  const picks: MapPlace[] = wishlist
    .filter((item) => item.place && item.status !== 'dropped')
    .map((item) => {
      const dayIndex = item.stopId ? dayOfStop.get(item.stopId) : undefined
      return {
        id: PICK_ID_PREFIX + item.id,
        lat: item.place!.lat,
        lng: item.place!.lng,
        name: item.name,
        type: item.category,
        ...(dayIndex !== undefined ? { dayIndex } : {}),
      }
    })

  mapDays.sort((a, b) => a.dayIndex - b.dayIndex)
  return { days: mapDays, stops, overnightLinks, pocket, fuel, lodging: [], picks, legs }
}

// ---- routes ----------------------------------------------------------------------------------

const fixed5 = (n: number) => n.toFixed(5)

/** The Worker's routeCache key (worker/proxy/route.ts routeKey): mode and both ends at 5 decimals */
export function routeCacheKey(r: RouteRequest): string {
  return `${r.mode}|${fixed5(r.from.lat)},${fixed5(r.from.lng)}|${fixed5(r.to.lat)},${fixed5(r.to.lng)}`
}

export type RouteCache = Map<string, RouteResponse>

/** Answers for the whole session (until reload): switching days back and forth costs no request */
export const sessionRouteCache: RouteCache = new Map()

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const requestOf = (leg: PlannedLeg): RouteRequest | null =>
  leg.routeMode ? { from: leg.from, to: leg.to, mode: leg.routeMode } : null

/** The routed requests not in the cache yet, deduplicated, in batches of at most 30 */
export function pendingRouteBatches(
  legs: readonly PlannedLeg[],
  cache: RouteCache,
  size: number = GEO_LIMITS.routesPerBatch,
): RouteRequest[][] {
  const pending = new Map<string, RouteRequest>()
  for (const leg of legs) {
    const req = requestOf(leg)
    if (!req) continue
    const key = routeCacheKey(req)
    if (!cache.has(key) && !pending.has(key)) pending.set(key, req)
  }
  return chunk([...pending.values()], size)
}

/**
 * The lines of these legs from what the cache knows. A routed leg uses its answer (ORS solid,
 * estimate dotted); a leg without one — not answered yet, the request failed, or a transit /
 * flight / ferry / other leg that is never routed — is a straight dotted estimate, like the
 * itinerary page marks estimates with 「估」.
 */
export function routesFromCache(legs: readonly PlannedLeg[], cache: RouteCache): MapRoute[] {
  return legs.map((leg) => {
    const req = requestOf(leg)
    const answer = req ? cache.get(routeCacheKey(req)) : undefined
    if (answer && answer.geometry.coordinates.length >= 2) {
      return { dayIndex: leg.dayIndex, geometry: answer.geometry, source: answer.source }
    }
    return {
      dayIndex: leg.dayIndex,
      geometry: {
        type: 'LineString',
        coordinates: [
          [leg.from.lng, leg.from.lat],
          [leg.to.lng, leg.to.lat],
        ],
      },
      source: 'estimate',
    }
  })
}

export type FetchRoutes = (legs: RouteRequest[]) => Promise<RouteResponse[]>

/**
 * Asks for the legs the cache does not know, one batch after another, and stores the answers.
 * The first failing batch stops the rest (a 429 will not get better a second later); its error is
 * returned so the page can say so, and the legs it covered stay estimates (not cached).
 */
export async function resolveRoutes(
  legs: readonly PlannedLeg[],
  fetchRoutes: FetchRoutes,
  cache: RouteCache = sessionRouteCache,
): Promise<{ routes: MapRoute[]; error: unknown }> {
  let error: unknown = null
  for (const batch of pendingRouteBatches(legs, cache)) {
    try {
      const answers = await fetchRoutes(batch)
      batch.forEach((req, i) => {
        const answer = answers[i]
        if (answer) cache.set(routeCacheKey(req), answer)
      })
    } catch (caught) {
      error = caught
      break
    }
  }
  return { routes: routesFromCache(legs, cache), error }
}
