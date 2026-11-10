import type { Map as MapLibreMap } from 'maplibre-gl'
import { FIT_MAX_ZOOM, FIT_PADDING } from './config.ts'
import type { FitTarget } from './geojson.ts'

// Camera moves (DESIGN.md §6, AC-10.5): with prefers-reduced-motion every move jumps (duration 0)
// instead of flying. Kept apart from TripMap so the duration path is unit tested without MapLibre.

/** The part of a MapLibre map the camera moves need */
export type CameraMap = Pick<MapLibreMap, 'fitBounds' | 'easeTo' | 'getContainer'>

/** How long a camera move takes: `ms`, or 0 when the person asked for less motion */
export const cameraDuration = (reducedMotion: boolean, ms: number): number => (reducedMotion ? 0 : ms)

/** Fits the map to `target` (bounds or a center and zoom) */
export function moveCamera(map: CameraMap, target: FitTarget, reducedMotion: boolean): void {
  if (!target) return
  const duration = cameraDuration(reducedMotion, 600)
  if ('bounds' in target) {
    const { width, height } = map.getContainer().getBoundingClientRect()
    const padding = Math.max(8, Math.min(FIT_PADDING, width / 5, height / 5))
    map.fitBounds(target.bounds, { padding, maxZoom: FIT_MAX_ZOOM, duration })
  } else {
    map.easeTo({ center: target.center, zoom: target.zoom, duration })
  }
}
