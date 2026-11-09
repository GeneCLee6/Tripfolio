// Map settings (docs/ARCHITECTURE.md §4.5, §5). The basemap style is a setting: switching to the
// Protomaps fallback (pmtiles on R2) or another host is a VITE_MAP_STYLE_URL change at build time.

/** OpenFreeMap's `liberty` style; restyled to our tokens by restyle() in style.ts */
export const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

export const MAP_STYLE_URL: string =
  (import.meta.env.VITE_MAP_STYLE_URL as string | undefined) || DEFAULT_MAP_STYLE_URL

/** The font cluster counts are drawn in; must exist on the style's glyph server */
export const MAP_LABEL_FONT = ['Noto Sans Bold']

export const CLUSTER_RADIUS = 36
export const CLUSTER_MAX_ZOOM = 12

/** Padding around fitted bounds, in CSS px */
export const FIT_PADDING = 56
/** Zoom when there is a single point to fit */
export const SINGLE_POINT_ZOOM = 12
/** Never zoom in further than this when fitting */
export const FIT_MAX_ZOOM = 14

/** Touch hold that drops a manual pin (e3-t02) */
export const LONG_PRESS_MS = 500
/** A touch that moves further than this is a pan, not a long press */
export const LONG_PRESS_SLOP_PX = 10
