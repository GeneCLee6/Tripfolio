import { GEO_LIMITS, type RouteMode, type RouteRequest } from '../../../shared/api/geo.ts'
import type { LegOverride as ApiLegOverride, Place, Stop } from '../../../shared/api/types.ts'
import {
  deriveLegs,
  legKey,
  summarizeDay,
  type DaySummary,
  type Leg,
  type LegOverride,
  type LatLng,
} from '../../../shared/itinerary/legs.ts'
import type { ItineraryStop, LegMode, TripStyle } from '../../../shared/itinerary/types.ts'

// The legs of a day for the itinerary page (e2-t02): derived from consecutive stops with
// coordinates (shared/itinerary/legs.ts), with routed values for drive / walk / cycle legs once
// POST /geo/routes has answered. Transit, flight, ferry and other legs are never sent: they stay
// client-side estimates (docs/NEXT.md, #proxy).

/**
 * The modes a leg override can be saved with (shared/schema legModes; kept here so the page does
 * not pull zod into the app). On a campervan trip `drive` is shown as the campervan.
 */
export const OVERRIDE_MODES = ['drive', 'walk', 'transit', 'flight', 'ferry', 'other'] as const
export type OverrideMode = (typeof OVERRIDE_MODES)[number]

/** The override mode a shown leg mode is saved as (campervan → drive; cycle has none: other) */
export function overrideModeOf(mode: LegMode): OverrideMode {
  if (mode === 'campervan') return 'drive'
  if (mode === 'cycle') return 'other'
  return mode
}

/** The routing mode for a leg mode, or null when the leg is only ever estimated */
export function routeModeFor(mode: LegMode): RouteMode | null {
  if (mode === 'drive' || mode === 'campervan') return 'drive'
  if (mode === 'walk' || mode === 'cycle') return mode
  return null
}

const r5 = (n: number) => n.toFixed(5)

/** Cache key of a routed leg: mode and both ends at 5 decimals (like the Worker's routeCache) */
export function routeKey(from: LatLng, to: LatLng, mode: RouteMode): string {
  return `${mode}:${r5(from.lat)},${r5(from.lng)}>${r5(to.lat)},${r5(to.lng)}`
}

export interface CachedRoute {
  distanceM: number
  durationS: number
  source: 'ors' | 'estimate'
}

export type RouteCache = ReadonlyMap<string, CachedRoute>

/** A leg as the page shows it: `estimated` puts 「估」 next to it, `overridden` 「手動」 */
export interface DisplayLeg extends Leg {
  estimated: boolean
  /** A leg override exists (mode and/or minutes set by hand) */
  overridden: boolean
  /** The override's minutes, or null when only the mode is set (or there is no override) */
  overrideMinutes: number | null
}

/** Stops in the shape the shared leg functions want, with coordinates from their places */
export function toItineraryStops(
  stops: readonly Stop[],
  places: ReadonlyMap<string, Place>,
): ItineraryStop[] {
  return stops.map((stop) => {
    const place = stop.placeId ? places.get(stop.placeId) : undefined
    return {
      id: stop.id,
      lat: place?.lat ?? null,
      lng: place?.lng ?? null,
      isBackup: stop.isBackup,
      category: place?.category,
      durationMin: stop.durationMin,
    }
  })
}

/**
 * The leg mode an override stands for. The API knows one road mode, `drive`: on a campervan trip
 * it is the campervan (same totals, campervan speed for estimates).
 */
export function legModeFromApi(mode: LegMode, style: TripStyle | undefined): LegMode {
  return mode === 'drive' && style === 'campervan' ? 'campervan' : mode
}

/** The API's leg overrides keyed by legKey (a null `minutes` keeps the routed time) */
export function overridesByKey(
  legs: readonly ApiLegOverride[],
  style?: TripStyle,
): Record<string, LegOverride> {
  const out: Record<string, LegOverride> = {}
  for (const leg of legs) {
    const mode = legModeFromApi(leg.mode, style)
    out[legKey(leg.fromStopId, leg.toStopId)] =
      leg.minutes === null ? { mode } : { mode, minutes: leg.minutes }
  }
  return out
}

export interface DayLegs {
  legs: DisplayLeg[]
  summary: DaySummary
  /** Routable legs with nothing in the cache yet (unique) */
  missing: RouteRequest[]
}

export interface AssembleOptions {
  style: TripStyle
  /** The trip's daily driving limit in minutes (null: the style's default) */
  limitMinutes: number | null
  overrides: Readonly<Record<string, LegOverride>>
  cache: RouteCache
}

/** One day's legs, its totals, and which legs still need POST /geo/routes */
export function assembleDay(
  stops: readonly Stop[],
  places: ReadonlyMap<string, Place>,
  options: AssembleOptions,
): DayLegs {
  const items = toItineraryStops(stops, places)
  const missing = new Map<string, RouteRequest>()
  const legs = deriveLegs(items, options.overrides, {
    style: options.style,
    routeLookup: (from, to, mode) => {
      const routeMode = routeModeFor(mode)
      if (!routeMode) return null
      const key = routeKey(from, to, routeMode)
      const cached = options.cache.get(key)
      if (!cached) {
        missing.set(key, { from, to, mode: routeMode })
        return null
      }
      return cached
    },
  })
  // deriveLegs does not say which lookups were estimates: look the routed ones up again
  const display = legs.map((leg): DisplayLeg => {
    const override = options.overrides[legKey(leg.fromStopId, leg.toStopId)]
    const flags = { overridden: Boolean(override), overrideMinutes: override?.minutes ?? null }
    if (leg.source === 'estimate') return { ...leg, ...flags, estimated: true }
    if (leg.source === 'manual') return { ...leg, ...flags, estimated: false }
    const from = items.find((item) => item.id === leg.fromStopId)
    const to = items.find((item) => item.id === leg.toStopId)
    const routeMode = routeModeFor(leg.mode)
    const cached =
      from && to && routeMode
        ? options.cache.get(
            routeKey({ lat: from.lat!, lng: from.lng! }, { lat: to.lat!, lng: to.lng! }, routeMode),
          )
        : undefined
    return { ...leg, ...flags, estimated: cached?.source === 'estimate' }
  })
  const summary = summarizeDay(items, legs, {
    style: options.style,
    limitMinutes: options.limitMinutes ?? undefined,
  })
  return { legs: display, summary, missing: [...missing.values()] }
}

/** Requests in POST /geo/routes batches (at most 30 legs each) */
export function routeBatches(requests: readonly RouteRequest[]): RouteRequest[][] {
  const size = GEO_LIMITS.routesPerBatch
  const batches: RouteRequest[][] = []
  for (let i = 0; i < requests.length; i += size) batches.push(requests.slice(i, i + size))
  return batches
}

/** Max minutes the API takes (shared/schema stop.ts: one week) */
const MAX_MINUTES = 7 * 24 * 60

/** The typed minutes: null for empty, NaN for anything that is not 0..MAX whole minutes */
export function parseMinutes(text: string): number | null {
  const value = text.trim()
  if (!value) return null
  if (!/^\d+$/.test(value)) return Number.NaN
  const n = Number(value)
  return n <= MAX_MINUTES ? n : Number.NaN
}
