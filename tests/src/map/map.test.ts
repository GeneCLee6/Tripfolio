import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  fitTarget,
  googleMapsUrl,
  lineFeatures,
  overnightFeatures,
  pinFeatures,
  routeFeatures,
} from '../../../src/map/geojson.ts'
import { LAYER_LABEL_KEYS, typeLabelKey } from '../../../src/map/labels.ts'
import {
  sampleFuel,
  sampleLodging,
  sampleOvernightLinks,
  samplePicks,
  samplePocket,
  sampleRoutes,
  sampleStops,
  SAMPLE_DAY_COUNT,
} from '../../../src/map/sample.ts'
import {
  dayPinDataUrls,
  glyphPin,
  glyphPinId,
  itineraryPin,
  itineraryPinId,
  pinDataUrl,
  pinImageFromId,
  PIN_PIXEL_RATIO,
  PIN_SIZE,
} from '../../../src/map/sprite.ts'
import { basemapColors, mix, restyle, restyleOverrides, type StyleSpecification } from '../../../src/map/style.ts'
import { MAP_LAYER_KEYS, type MapLayers } from '../../../src/map/types.ts'
import { dayColor, dayColors, palette } from '../../../src/styles/tokens.ts'

const ALL: MapLayers = { itinerary: true, pocket: true, lodging: true, picks: true, fuel: true }
const ONLY_ITINERARY: MapLayers = { itinerary: true, pocket: false, lodging: false, picks: false, fuel: false }
const data = { stops: sampleStops, pocket: samplePocket, lodging: sampleLodging, picks: samplePicks, fuel: sampleFuel }

describe('pin sprites', () => {
  it('draws an itinerary pin in the day colour with the order number', () => {
    const pin = itineraryPin('light', 3, 7)
    expect(pin.svg).toContain(`fill="${dayColors[3]}"`)
    expect(pin.svg).toContain('>7</text>')
    expect(pin.svg).toContain(`stroke="${palette.light.card}"`)
    expect(pin.width).toBe(PIN_SIZE * PIN_PIXEL_RATIO)
  })

  it('cycles day colours after ten and rings in the card colour of the scheme', () => {
    expect(itineraryPin('dark', 12, 1).svg).toContain(`fill="${dayColor(12)}"`)
    expect(dayColor(12)).toBe(dayColors[2])
    expect(itineraryPin('dark', 0, 1).svg).toContain(`stroke="${palette.dark.card}"`)
  })

  it('returns one data URL per day colour', () => {
    const urls = dayPinDataUrls('light')
    expect(urls).toHaveLength(10)
    expect(new Set(urls).size).toBe(10)
    urls.forEach((url, day) => {
      expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
      expect(decodeURIComponent(url)).toContain(`fill="${dayColors[day]}"`)
    })
  })

  it('draws glyph pins for the other layers', () => {
    for (const kind of ['pocket', 'lodging', 'picks', 'fuel'] as const) {
      const pin = glyphPin('light', kind)
      expect(pin.svg).toContain('<path d=')
      expect(pinImageFromId(glyphPinId('light', kind))).toEqual(pin)
    }
  })

  it('round-trips image ids and rejects foreign ones', () => {
    expect(pinImageFromId(itineraryPinId('dark', 4, 12))).toEqual(itineraryPin('dark', 4, 12))
    expect(pinDataUrl('tf-pin:light:0:1')).toMatch(/^data:image\/svg\+xml/)
    expect(pinImageFromId('marker-15')).toBeNull()
    expect(pinImageFromId('tf-pin:sepia:0:1')).toBeNull()
    expect(pinImageFromId('tf-pin:light:x:1')).toBeNull()
    expect(pinImageFromId('tf-glyph:light:castle')).toBeNull()
  })
})

describe('GeoJSON builders', () => {
  it('puts every stop and enabled layer on the whole-trip map, numbered and coloured by day', () => {
    const pins = pinFeatures(data, { mode: 'trip', layers: ALL, scheme: 'light' })
    const expected =
      sampleStops.length + samplePocket.length + sampleLodging.length + samplePicks.length + sampleFuel.length
    expect(pins.features).toHaveLength(expected)
    const first = pins.features[0]
    expect(first.geometry.coordinates).toEqual([sampleStops[0].lng, sampleStops[0].lat])
    expect(first.properties).toMatchObject({
      id: 'd1s1',
      kind: 'itinerary',
      dayIndex: 0,
      order: 1,
      icon: 'tf-pin:light:0:1',
    })
    const lodging = pins.features.find((feature) => feature.properties.kind === 'lodging')
    expect(lodging?.properties.icon).toBe('tf-glyph:light:lodging')
    // Numeric, unique feature ids
    expect(new Set(pins.features.map((feature) => feature.id)).size).toBe(expected)
  })

  it('shows one day and only the enabled layers', () => {
    const pins = pinFeatures(data, { mode: { day: 7 }, layers: ONLY_ITINERARY, scheme: 'dark' })
    expect(pins.features.map((feature) => feature.properties.name)).toEqual([
      'Arrowtown',
      'Queenstown',
      'Skyline Queenstown',
    ])
    expect(pins.features.every((feature) => feature.properties.icon.startsWith('tf-pin:dark:7:'))).toBe(true)
    const noItinerary = pinFeatures(data, { mode: 'trip', layers: { ...ALL, itinerary: false }, scheme: 'light' })
    expect(noItinerary.features.some((feature) => feature.properties.kind === 'itinerary')).toBe(false)
  })

  it('skips places with invalid coordinates', () => {
    const stops = [{ ...sampleStops[0], lat: Number.NaN }, { ...sampleStops[1], lng: 200 }, sampleStops[2]]
    expect(pinFeatures({ stops }, { mode: 'trip', layers: ALL, scheme: 'light' }).features).toHaveLength(1)
  })

  it('draws day routes only in a day view, estimates as their own kind', () => {
    expect(routeFeatures(sampleRoutes, 'trip').features).toHaveLength(0)
    const day1 = routeFeatures(sampleRoutes, { day: 1 }).features
    expect(day1).toHaveLength(1)
    expect(day1[0].properties).toEqual({ dayIndex: 1, color: dayColors[1], kind: 'route' })
    expect(routeFeatures(sampleRoutes, { day: 4 }).features[0].properties.kind).toBe('estimate')
  })

  it('draws overnight links only in the whole-trip view', () => {
    expect(overnightFeatures(sampleOvernightLinks, { day: 2 }).features).toHaveLength(0)
    const links = overnightFeatures(sampleOvernightLinks, 'trip').features
    expect(links).toHaveLength(SAMPLE_DAY_COUNT - 2)
    expect(links[0].geometry.coordinates).toEqual([
      [sampleOvernightLinks[0].from.lng, sampleOvernightLinks[0].from.lat],
      [sampleOvernightLinks[0].to.lng, sampleOvernightLinks[0].to.lat],
    ])
    expect(links[0].properties).toEqual({ dayIndex: 1, color: dayColors[1], kind: 'overnight' })
    expect(lineFeatures(sampleRoutes, sampleOvernightLinks, 'trip').features).toHaveLength(links.length)
  })
})

describe('fit bounds', () => {
  it('boxes positions', () => {
    expect(boundsOf([])).toBeNull()
    expect(
      boundsOf([
        [170, -45],
        [168.5, -44],
        [172, -43.5],
      ]),
    ).toEqual([
      [168.5, -45],
      [172, -43.5],
    ])
  })

  it('fits every stop and overnight link in the whole-trip view', () => {
    const pins = pinFeatures(data, { mode: 'trip', layers: ONLY_ITINERARY, scheme: 'light' })
    const lines = lineFeatures(sampleRoutes, sampleOvernightLinks, 'trip')
    const target = fitTarget(pins, lines, 'all', 'trip')
    if (!target || !('bounds' in target)) throw new Error('expected bounds')
    const points = [...sampleStops, ...sampleOvernightLinks.flatMap((link) => [link.from, link.to])]
    const lats = points.map((point) => point.lat)
    const lngs = points.map((point) => point.lng)
    expect(target.bounds).toEqual([
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ])
  })

  it('fits one day to its own stops and route, ignoring other layers', () => {
    const mode = { day: 7 }
    const pins = pinFeatures(data, { mode, layers: ALL, scheme: 'light' })
    const lines = lineFeatures(sampleRoutes, sampleOvernightLinks, mode)
    const target = fitTarget(pins, lines, 'day', mode)
    if (!target || !('bounds' in target)) throw new Error('expected bounds')
    const [[west, south], [east, north]] = target.bounds
    expect(west).toBeGreaterThan(168.6)
    expect(east).toBeLessThan(169.2)
    expect(south).toBeGreaterThan(-45.1)
    expect(north).toBeLessThan(-44.6)
    // 'all' in a day also takes in the other layers (Akaroa, Kaikoura are far east)
    const all = fitTarget(pins, lines, 'all', mode)
    expect(all && 'bounds' in all && all.bounds[1][0]).toBeGreaterThan(173)
  })

  it('centres on a single point and has nothing to fit when empty', () => {
    const one = pinFeatures({ stops: [sampleStops[0]] }, { mode: 'trip', layers: ALL, scheme: 'light' })
    const empty = { type: 'FeatureCollection' as const, features: [] }
    expect(fitTarget(one, empty, 'all', 'trip')).toEqual({ center: [172.5322, -43.4894], zoom: 12 })
    expect(fitTarget(empty, empty, 'all', 'trip')).toBeNull()
  })
})

describe('basemap restyle', () => {
  const base = {
    version: 8,
    sources: {},
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f8f4f0' } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#9ebdff' } },
      { id: 'road_trunk_primary', type: 'line', source: 'omt', 'source-layer': 'transportation', paint: {} },
      { id: 'road_minor_casing', type: 'line', source: 'omt', 'source-layer': 'transportation', paint: {} },
      { id: 'poi_r1', type: 'symbol', source: 'omt', 'source-layer': 'poi', layout: {} },
      { id: 'label_city', type: 'symbol', source: 'omt', 'source-layer': 'place', paint: { 'text-color': '#000' } },
    ],
  } as unknown as StyleSpecification

  const paintOf = (style: StyleSpecification, id: string) =>
    (style.layers.find((layer) => layer.id === id) as { paint?: Record<string, unknown> }).paint ?? {}

  it('mixes token colours', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mix('#0f6e74', '#0f6e74', 0.3)).toBe('#0f6e74')
    expect(() => mix('red', '#ffffff', 0.5)).toThrow()
  })

  it('paints land in paper, water in glacier, hides POIs, and leaves the input untouched', () => {
    const light = restyle(base, 'light')
    expect(paintOf(light, 'background')['background-color']).toBe(palette.light.paper)
    expect(paintOf(light, 'water')['fill-color']).toBe(palette.light.glacier)
    expect(paintOf(light, 'road_trunk_primary')['line-color']).toBe(palette.light.card)
    expect(paintOf(light, 'road_minor_casing')['line-color']).toBe(palette.light.line)
    expect(paintOf(light, 'label_city')['text-color']).toBe(palette.light.ink)
    expect((light.layers[4] as { layout: Record<string, unknown> }).layout.visibility).toBe('none')
    expect(paintOf(base, 'background')['background-color']).toBe('#f8f4f0')
  })

  it('has a dark variant from the dark tokens, with the same overrides to apply in place', () => {
    const dark = restyle(base, 'dark')
    expect(paintOf(dark, 'background')['background-color']).toBe(palette.dark.paper)
    expect(paintOf(dark, 'water')['fill-color']).toBe(palette.dark.glacier)
    expect(basemapColors('dark').halo).toBe(palette.dark.paper)
    const keys = (scheme: 'light' | 'dark') =>
      restyleOverrides(base, scheme).map(({ layer, kind, property }) => `${layer}/${kind}/${property}`)
    expect(keys('dark')).toEqual(keys('light'))
  })
})

describe('labels and links', () => {
  it('maps place types to label keys, unknown types to other', () => {
    expect(typeLabelKey('food')).toBe('map.type.food')
    expect(typeLabelKey('viewpoint')).toBe('map.type.other')
    expect(typeLabelKey(undefined)).toBe('map.type.other')
    expect(new Set(MAP_LAYER_KEYS.map((key) => LAYER_LABEL_KEYS[key])).size).toBe(5)
  })

  it('links a coordinate to Google Maps', () => {
    expect(googleMapsUrl({ lat: -45.0312, lng: 168.6626 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=-45.031200,168.662600',
    )
  })
})
