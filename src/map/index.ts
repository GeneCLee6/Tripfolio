import { lazy } from 'react'

// The map module (e3-t03). Everything exported here is free of maplibre-gl except through
// LazyTripMap, so importing this file never pulls the `maplibre` chunk into a first screen.

/** The trip map, loaded on demand with the `maplibre` chunk; wrap it in <Suspense> */
export const LazyTripMap = lazy(() => import('./TripMap.tsx'))
export type { TripMapProps } from './TripMap.tsx'

export { DEFAULT_MAP_STYLE_URL, MAP_STYLE_URL } from './config.ts'
export {
  boundsOf,
  fitTarget,
  googleMapsUrl,
  lineFeatures,
  overnightFeatures,
  pinFeatures,
  routeFeatures,
  type Bounds,
} from './geojson.ts'
export { LAYER_LABEL_KEYS, typeLabelKey } from './labels.ts'
export {
  SAMPLE_DAY_COUNT,
  sampleFuel,
  sampleLodging,
  sampleOvernightLinks,
  samplePicks,
  samplePocket,
  sampleRoutes,
  sampleStops,
} from './sample.ts'
export { dayPinDataUrls, glyphPinId, itineraryPinId, pinDataUrl, pinImageFromId } from './sprite.ts'
export { exportStaticPng, type StaticPngOptions } from './static.ts'
export { loadBaseStyle, restyle, restyleOverrides } from './style.ts'
export {
  MAP_LAYER_KEYS,
  type MapAction,
  type MapLayerKey,
  type MapLayers,
  type MapMode,
  type MapPlace,
  type MapPoint,
  type MapRoute,
  type MapScheme,
  type MapStop,
  type OvernightLink,
} from './types.ts'
