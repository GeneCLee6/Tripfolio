import type { Map as MapLibreMap } from 'maplibre-gl'
import { palette } from '../styles/tokens.ts'
import { MAP_STYLE_URL } from './config.ts'
import type { MapScheme } from './types.ts'

// The basemap (docs/ARCHITECTURE.md §4.5, E3 設計方向): OpenFreeMap `liberty` fetched at runtime and
// recoloured to our tokens: paper-toned land, low-contrast roads, water in the glacier tone, POI
// icons and shields hidden so the day-coloured pins and routes stand out. The same overrides are
// applied to a running map when the theme switches, so our own layers survive (no setStyle).
//
// Only type imports from maplibre-gl here: this module is safe to import outside the map chunk.

export type StyleSpecification = Exclude<Parameters<MapLibreMap['setStyle']>[0], string | null>
type LayerSpecification = StyleSpecification['layers'][number]
export type PaintProperty = Parameters<MapLibreMap['setPaintProperty']>[1]
type LayoutProperty = Parameters<MapLibreMap['setLayoutProperty']>[1]

export interface StyleOverride {
  layer: string
  kind: 'paint' | 'layout'
  property: string
  value: string | number
}

const HEX = /^#([0-9a-f]{6})$/i

/** Mixes two #rrggbb colours: t = 0 is `a`, 1 is `b` */
export function mix(a: string, b: string, t: number): string {
  const [ma, mb] = [HEX.exec(a), HEX.exec(b)]
  if (!ma || !mb) throw new Error(`mix() takes #rrggbb colours, got ${a} and ${b}`)
  const channel = (hex: string, i: number) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  const out = [0, 1, 2].map((i) => {
    const value = Math.round(channel(ma[1], i) * (1 - t) + channel(mb[1], i) * t)
    return value.toString(16).padStart(2, '0')
  })
  return `#${out.join('')}`
}

/** The basemap colours of one scheme, all derived from src/styles/tokens.ts */
export function basemapColors(scheme: MapScheme) {
  const p = palette[scheme]
  const light = scheme === 'light'
  return {
    land: p.paper,
    landuse: mix(p.paper, p.line, 0.35),
    green: mix(p.paper, p.success, light ? 0.14 : 0.1),
    ice: mix(p.card, p.glacier, 0.35),
    sand: mix(p.paper, p.tussockSoft, 0.5),
    water: p.glacier,
    waterway: mix(p.glacier, p.fjord, light ? 0.25 : 0.2),
    roadMajor: light ? p.card : mix(p.card, p.line, 0.6),
    roadMinor: mix(p.paper, p.card, 0.6),
    casing: p.line,
    rail: p.line,
    building: mix(p.paper, p.line, 0.6),
    boundary: mix(p.line, p.muted, 0.5),
    label: p.ink,
    labelMuted: p.muted,
    waterLabel: mix(p.fjord, p.muted, 0.4),
    halo: p.paper,
  }
}

const HIDDEN = [/^poi_/, /^road_one_way/, /shield/, /^road_area_pattern$/, /^building-3d$/]

const isRoadMajor = (id: string) => /motorway|trunk|primary|secondary|tertiary|link/.test(id)

/** The overrides for one layer of the base style; unknown layers are left alone */
function layerOverrides(layer: LayerSpecification, scheme: MapScheme): StyleOverride[] {
  const c = basemapColors(scheme)
  const { id } = layer
  const paint = (property: string, value: string | number): StyleOverride => ({ layer: id, kind: 'paint', property, value })
  if (HIDDEN.some((pattern) => pattern.test(id))) {
    return [{ layer: id, kind: 'layout', property: 'visibility', value: 'none' }]
  }
  switch (layer.type) {
    case 'background':
      return [paint('background-color', c.land)]
    case 'raster':
      return [paint('raster-saturation', -1), paint('raster-opacity', scheme === 'light' ? 0.22 : 0.12)]
    case 'fill': {
      const fill = (value: string) => [paint('fill-color', value), paint('fill-outline-color', value)]
      if (id === 'water') return fill(c.water)
      if (/park|wood|grass|wetland/.test(id)) return fill(c.green)
      if (/ice/.test(id)) return fill(c.ice)
      if (/sand/.test(id)) return fill(c.sand)
      if (/building/.test(id)) return [paint('fill-color', c.building), paint('fill-outline-color', c.casing)]
      if (/landuse|aeroway/.test(id)) return fill(c.landuse)
      return []
    }
    case 'line': {
      const line = (value: string) => [paint('line-color', value)]
      if (/^waterway/.test(id)) return line(c.waterway)
      if (/park/.test(id)) return line(c.green)
      if (/boundary/.test(id)) return line(c.boundary)
      if (/casing|rail|hatching/.test(id)) return line(/rail|hatching/.test(id) ? c.rail : c.casing)
      if (/aeroway/.test(id)) return line(c.roadMinor)
      if (/path|pedestrian|service|track|minor|street/.test(id)) return line(c.roadMinor)
      if (isRoadMajor(id)) return line(c.roadMajor)
      return []
    }
    case 'symbol': {
      const water = /water/.test(id)
      const major = /^label_(city|town|country|state)/.test(id)
      return [
        paint('text-color', water ? c.waterLabel : major ? c.label : c.labelMuted),
        paint('text-halo-color', c.halo),
      ]
    }
    default:
      return []
  }
}

/** Every override the base style needs for `scheme` */
export function restyleOverrides(style: StyleSpecification, scheme: MapScheme): StyleOverride[] {
  return style.layers.flatMap((layer) => layerOverrides(layer, scheme))
}

/** A copy of the base style recoloured for `scheme` */
export function restyle(style: StyleSpecification, scheme: MapScheme): StyleSpecification {
  const copy = structuredClone(style)
  const byId = new Map(copy.layers.map((layer) => [layer.id, layer as unknown as Record<string, Record<string, unknown> | undefined>]))
  for (const { layer, kind, property, value } of restyleOverrides(style, scheme)) {
    const target = byId.get(layer)
    if (!target) continue
    target[kind] = { ...target[kind], [property]: value }
  }
  return copy
}

/** Applies the overrides of `scheme` to a running map (theme switch) */
export function applyRestyle(map: MapLibreMap, style: StyleSpecification, scheme: MapScheme): void {
  for (const { layer, kind, property, value } of restyleOverrides(style, scheme)) {
    if (!map.getLayer(layer)) continue
    if (kind === 'paint') map.setPaintProperty(layer, property as PaintProperty, value)
    else map.setLayoutProperty(layer, property as LayoutProperty, value)
  }
}

let baseStyle: Promise<StyleSpecification> | null = null

/** Fetches the base style once per page (MAP_STYLE_URL); a failure is retried on the next call */
export function loadBaseStyle(url: string = MAP_STYLE_URL): Promise<StyleSpecification> {
  if (!baseStyle) {
    baseStyle = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`Map style ${url}: HTTP ${response.status}`)
        return response.json() as Promise<StyleSpecification>
      })
      .catch((error: unknown) => {
        baseStyle = null
        throw error
      })
  }
  return baseStyle
}
