import { dayColor } from '../styles/tokens.ts'
import { SINGLE_POINT_ZOOM } from './config.ts'
import { glyphPinId, itineraryPinId, type GlyphKind } from './sprite.ts'
import type {
  MapLayerKey,
  MapLayers,
  MapMode,
  MapPlace,
  MapPoint,
  MapRoute,
  MapScheme,
  MapStop,
  OvernightLink,
} from './types.ts'

// Pure builders from TripMap's props to the GeoJSON its sources draw, and the bounds to fit.
// Minimal GeoJSON types (RFC 7946) so this module needs no map library; coordinates are [lng, lat].

export type Position = [number, number]

export interface PointFeature<P> {
  type: 'Feature'
  id?: number
  geometry: { type: 'Point'; coordinates: Position }
  properties: P
}

export interface LineFeature<P> {
  type: 'Feature'
  geometry: { type: 'LineString'; coordinates: Position[] }
  properties: P
}

export interface FeatureCollection<F> {
  type: 'FeatureCollection'
  features: F[]
}

export interface PinProperties {
  id: string
  kind: MapLayerKey
  /** -1 for places without a day */
  dayIndex: number
  /** 0 for places outside the itinerary */
  order: number
  name: string
  icon: string
  /** Draw order: later days and stops on top */
  sortKey: number
}

export type LineKind = 'route' | 'estimate' | 'overnight'

export interface LineProperties {
  dayIndex: number
  color: string
  kind: LineKind
}

export interface MapData {
  stops: readonly MapStop[]
  pocket?: readonly MapPlace[]
  lodging?: readonly MapPlace[]
  picks?: readonly MapPlace[]
  fuel?: readonly MapPlace[]
}

export const dayOf = (mode: MapMode): number | null => (mode === 'trip' ? null : mode.day)

const validPoint = (point: MapPoint) =>
  Number.isFinite(point.lat) &&
  Number.isFinite(point.lng) &&
  Math.abs(point.lat) <= 90 &&
  Math.abs(point.lng) <= 180

const pointFeature = <P>(point: MapPoint, properties: P, id: number): PointFeature<P> => ({
  type: 'Feature',
  id,
  geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
  properties,
})

/** Stops (of the shown day, or all in the whole-trip view) and the places of the enabled layers */
export function pinFeatures(
  data: MapData,
  options: { mode: MapMode; layers: MapLayers; scheme: MapScheme },
): FeatureCollection<PointFeature<PinProperties>> {
  const day = dayOf(options.mode)
  const features: PointFeature<PinProperties>[] = []
  const push = (point: MapPoint, properties: PinProperties) => {
    if (validPoint(point)) features.push(pointFeature(point, properties, features.length))
  }
  if (options.layers.itinerary) {
    for (const stop of data.stops) {
      if (day !== null && stop.dayIndex !== day) continue
      push(stop, {
        id: stop.id,
        kind: 'itinerary',
        dayIndex: stop.dayIndex,
        order: stop.order,
        name: stop.name,
        icon: itineraryPinId(options.scheme, stop.dayIndex, stop.order),
        sortKey: 1000 + stop.dayIndex * 100 + stop.order,
      })
    }
  }
  const glyphLayers: GlyphKind[] = ['pocket', 'lodging', 'picks', 'fuel']
  for (const kind of glyphLayers) {
    if (!options.layers[kind]) continue
    for (const place of data[kind] ?? []) {
      push(place, {
        id: place.id,
        kind,
        dayIndex: place.dayIndex ?? -1,
        order: 0,
        name: place.name,
        icon: glyphPinId(options.scheme, kind),
        sortKey: 0,
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

/** Day routes, only in the single-day view; an estimate is its own kind (drawn dotted) */
export function routeFeatures(
  routes: readonly MapRoute[],
  mode: MapMode,
): FeatureCollection<LineFeature<LineProperties>> {
  const day = dayOf(mode)
  if (day === null) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: routes
      .filter((route) => route.dayIndex === day && route.geometry.coordinates.length >= 2)
      .map((route) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: route.geometry.coordinates.map(([lng, lat]) => [lng, lat]) },
        properties: {
          dayIndex: route.dayIndex,
          color: dayColor(route.dayIndex),
          kind: route.source === 'estimate' ? 'estimate' : 'route',
        },
      })),
  }
}

/** Night-to-night lines, only in the whole-trip view (E3 需求 路線) */
export function overnightFeatures(
  links: readonly OvernightLink[],
  mode: MapMode,
): FeatureCollection<LineFeature<LineProperties>> {
  if (mode !== 'trip') return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: links
      .filter((link) => validPoint(link.from) && validPoint(link.to))
      .map((link) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [link.from.lng, link.from.lat],
            [link.to.lng, link.to.lat],
          ],
        },
        properties: { dayIndex: link.dayIndex, color: dayColor(link.dayIndex), kind: 'overnight' },
      })),
  }
}

/** Lines drawn on the map: day routes in a day, overnight links in the whole trip */
export const lineFeatures = (
  routes: readonly MapRoute[],
  links: readonly OvernightLink[],
  mode: MapMode,
): FeatureCollection<LineFeature<LineProperties>> => ({
  type: 'FeatureCollection',
  features: [...routeFeatures(routes, mode).features, ...overnightFeatures(links, mode).features],
})

/** [[west, south], [east, north]] */
export type Bounds = [Position, Position]

/** The box around `positions`, or null when there are none */
export function boundsOf(positions: readonly Position[]): Bounds | null {
  if (positions.length === 0) return null
  let [west, south] = positions[0]
  let [east, north] = positions[0]
  for (const [lng, lat] of positions) {
    west = Math.min(west, lng)
    east = Math.max(east, lng)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  return [
    [west, south],
    [east, north],
  ]
}

export type FitTarget = { bounds: Bounds } | { center: Position; zoom: number } | null

/**
 * What the camera should show. `fitTo: 'day'` in a day fits that day's stops and routes; `'all'`
 * (and the whole-trip view) fits every pin and line on the map. A single point centres on it.
 */
export function fitTarget(
  pins: FeatureCollection<PointFeature<PinProperties>>,
  lines: FeatureCollection<LineFeature<LineProperties>>,
  fitTo: 'all' | 'day',
  mode: MapMode,
): FitTarget {
  const day = dayOf(mode)
  const onlyDay = fitTo === 'day' && day !== null
  const positions: Position[] = [
    ...pins.features
      .filter((feature) => !onlyDay || (feature.properties.kind === 'itinerary' && feature.properties.dayIndex === day))
      .map((feature) => feature.geometry.coordinates),
    ...lines.features.flatMap((feature) => feature.geometry.coordinates),
  ]
  const bounds = boundsOf(positions)
  if (!bounds) return null
  const [[west, south], [east, north]] = bounds
  if (west === east && south === north) return { center: [west, south], zoom: SINGLE_POINT_ZOOM }
  return { bounds }
}

/** Google Maps link for a coordinate (the card's "open in Google Maps") */
export const googleMapsUrl = (point: MapPoint): string =>
  `https://www.google.com/maps/search/?api=1&query=${point.lat.toFixed(6)},${point.lng.toFixed(6)}`
