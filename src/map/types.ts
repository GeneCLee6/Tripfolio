import type { LineStringGeometry } from '../../shared/api/geo.ts'

// Props shapes of TripMap. Coordinates are WGS84 degrees; GeoJSON coordinates are [lng, lat].

/** A stop of the itinerary: coloured by its day, numbered by its order in that day */
export interface MapStop {
  id: string
  /** 0-based day of the trip (the day colour) */
  dayIndex: number
  /** 1-based order within the day (the number on the pin) */
  order: number
  lat: number
  lng: number
  /** Place category (shared/api/geo.ts GeoCategory, or another string shown as "other") */
  type: string
  name: string
  /** Local start time `HH:mm`, shown on the card */
  time?: string | null
}

/** A place of another layer (pocket list, lodging, picks, fuel and supplies) */
export interface MapPlace {
  id: string
  lat: number
  lng: number
  name: string
  type?: string
  /** Day the place belongs to, when it has one (lodging night, a pick planned for a day) */
  dayIndex?: number
}

export interface MapRoute {
  dayIndex: number
  geometry: LineStringGeometry
  /** 'estimate' is the straight-line fallback: drawn dotted and lighter (AC-3.3) */
  source: 'ors' | 'estimate'
}

export interface MapPoint {
  lat: number
  lng: number
}

/** Whole-trip view: the line between one night's lodging and the next (E3 需求 路線) */
export interface OvernightLink {
  dayIndex: number
  from: MapPoint
  to: MapPoint
}

export type MapLayerKey = 'itinerary' | 'pocket' | 'lodging' | 'picks' | 'fuel'
export const MAP_LAYER_KEYS: readonly MapLayerKey[] = ['itinerary', 'pocket', 'lodging', 'picks', 'fuel']
export type MapLayers = Record<MapLayerKey, boolean>

export type MapMode = 'trip' | { day: number }

export type MapAction = 'schedule' | 'openGoogleMaps'

export type MapScheme = 'light' | 'dark'
