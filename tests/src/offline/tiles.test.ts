import { describe, expect, it } from 'vitest'
import {
  BYTES_PER_TILE,
  MAX_BYTES,
  countTiles,
  downloadTiles,
  enumerateTiles,
  planSize,
  resolveStyle,
  tileOf,
  tileUrls,
  tripBounds,
  type Bounds,
} from '../../../src/lib/offline/tiles.ts'

// Offline tiles (e3-t06): bounds with 20 km padding, XYZ tile maths, the 150 MB plan, the style's
// resources, and the download into a cache.

const queenstown = { lat: -45.0312, lng: 168.6626 }
const wanaka = { lat: -44.7032, lng: 169.1321 }

describe('tripBounds', () => {
  it('is null without points and pads every side by about 20 km', () => {
    expect(tripBounds([])).toBeNull()
    const [west, south, east, north] = tripBounds([queenstown, wanaka])!
    expect(north - wanaka.lat).toBeCloseTo(20 / 111.32, 5)
    expect(queenstown.lat - south).toBeCloseTo(20 / 111.32, 5)
    // At ~45° S a degree of longitude is ~78.6 km
    expect(queenstown.lng - west).toBeGreaterThan(0.25)
    expect(queenstown.lng - west).toBeLessThan(0.27)
    expect(east - wanaka.lng).toBeCloseTo(queenstown.lng - west, 10)
  })

  it('stays inside the world and Web Mercator', () => {
    const [west, south, east, north] = tripBounds([
      { lat: 89, lng: 179.9 },
      { lat: -89, lng: -179.9 },
    ])!
    expect(west).toBe(-180)
    expect(east).toBe(180)
    expect(north).toBeLessThanOrEqual(85.06)
    expect(south).toBeGreaterThanOrEqual(-85.06)
  })
})

describe('tile maths', () => {
  it('finds the XYZ tile of a point', () => {
    expect(tileOf(0, 0, 1)).toEqual({ x: 1, y: 1 })
    expect(tileOf(-180, 85, 2)).toEqual({ x: 0, y: 0 })
    expect(tileOf(180, -85, 2)).toEqual({ x: 3, y: 3 })
    // Queenstown at z12 (the OSM slippy-map formula)
    expect(tileOf(168.6626, -45.0312, 12)).toEqual({ x: 3967, y: 2623 })
  })

  it('enumerates exactly the counted tiles, zoom by zoom', () => {
    const bounds = tripBounds([queenstown, wanaka])!
    const all = [...enumerateTiles(bounds, 5, 8)]
    expect(all).toHaveLength(countTiles(bounds, 5, 8))
    expect(new Set(all.map((tile) => `${tile.z}/${tile.x}/${tile.y}`)).size).toBe(all.length)
    expect(all[0].z).toBe(5)
    expect(all.at(-1)!.z).toBe(8)
    // The whole world at z0–z2: 1 + 4 + 16
    expect(countTiles([-180, -85, 180, 85], 0, 2)).toBe(21)
  })
})

describe('planSize', () => {
  const sources = [{ templates: ['t/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 }]

  it('estimates 25 kB a tile and passes a small trip', () => {
    const bounds = tripBounds([queenstown, wanaka])!
    const plan = planSize(bounds, sources)
    expect(plan.tiles).toBe(countTiles(bounds, 5, 12))
    expect(plan.bytes).toBe(plan.tiles * BYTES_PER_TILE)
    expect(plan.ok).toBe(true)
    expect(plan.suggestedMaxZoom).toBe(12)
  })

  it('refuses over 150 MB and suggests a lower max zoom', () => {
    // A whole-country trip: Auckland to Bluff
    const bounds = tripBounds([
      { lat: -36.85, lng: 174.76 },
      { lat: -46.6, lng: 168.35 },
    ])!
    const plan = planSize(bounds, sources)
    expect(plan.bytes).toBeGreaterThan(MAX_BYTES)
    expect(plan.ok).toBe(false)
    expect(plan.suggestedMaxZoom).toBe(11)
    expect(planSize(bounds, sources, 5, 11).ok).toBe(true)
  })

  it('counts each source only within its own zooms', () => {
    const bounds: Bounds = [168, -46, 170, -44]
    const raster = { templates: ['r/{z}/{x}/{y}.png'], minzoom: 0, maxzoom: 6 }
    expect(planSize(bounds, [...sources, raster]).tiles).toBe(
      countTiles(bounds, 5, 12) + countTiles(bounds, 5, 6),
    )
    expect([...tileUrls(bounds, [raster], 5, 6)].every((url) => /^r\/[56]\//.test(url))).toBe(true)
  })
})

const STYLE_URL = 'https://tiles.example/styles/liberty'
const style = {
  sources: {
    openmaptiles: { type: 'vector', url: 'https://tiles.example/planet' },
    ne2_shaded: { type: 'raster', maxzoom: 6, tiles: ['https://tiles.example/ne/{z}/{x}/{y}.png'] },
    geojson: { type: 'geojson', data: {} },
  },
  sprite: 'https://tiles.example/sprites/ofm',
  glyphs: 'https://tiles.example/fonts/{fontstack}/{range}.pbf',
  layers: [
    { id: 'a', layout: { 'text-font': ['Noto Sans Regular'] } },
    { id: 'b', layout: { 'text-font': ['Noto Sans Bold'] } },
    { id: 'c', layout: { 'text-font': ['get', 'font'] } },
  ],
}
const tileJson = { tiles: ['https://tiles.example/planet/v1/{z}/{x}/{y}.pbf'], maxzoom: 14 }
const json: Record<string, unknown> = {
  [STYLE_URL]: style,
  'https://tiles.example/planet': tileJson,
}

describe('resolveStyle', () => {
  it('reads tile templates through the TileJSON and lists the files the map needs', async () => {
    const { sources, extras } = await resolveStyle(STYLE_URL, async (url) => json[url] as never)
    expect(sources).toEqual([
      { templates: ['https://tiles.example/planet/v1/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 },
      { templates: ['https://tiles.example/ne/{z}/{x}/{y}.png'], minzoom: 0, maxzoom: 6 },
    ])
    expect(extras).toContain(STYLE_URL)
    expect(extras).toContain('https://tiles.example/planet')
    expect(extras).toContain('https://tiles.example/sprites/ofm@2x.png')
    expect(extras).toContain('https://tiles.example/fonts/Noto%20Sans%20Bold/0-255.pbf')
    // 2 font stacks × 3 ranges, 4 sprite files, style, TileJSON
    expect(extras).toHaveLength(12)
  })
})

/** A CacheStorage stand-in: enough of open/match/put/keys/has/delete */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>()
  const storage = {
    async open(name: string) {
      const map = stores.get(name) ?? new Map<string, Response>()
      stores.set(name, map)
      return {
        match: async (url: string) => map.get(url),
        put: async (url: string, response: Response) => void map.set(url, response),
        keys: async () => [...map.keys()],
      }
    },
    has: async (name: string) => stores.has(name),
    delete: async (name: string) => stores.delete(name),
  }
  return { storage: storage as unknown as CacheStorage, stores }
}

describe('downloadTiles', () => {
  it('fetches every file, at most 6 at a time, into tiles-<tripId>; skips what is cached', async () => {
    const { storage, stores } = fakeCaches()
    let active = 0
    let peak = 0
    const fetched: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (json[url]) return Response.json(json[url])
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      fetched.push(url)
      return new Response('tile')
    }) as typeof fetch
    const bounds = tripBounds([queenstown])!
    const progress: number[] = []
    const result = await downloadTiles('trip1', bounds, STYLE_URL, {
      maxZoom: 8,
      fetchImpl,
      cacheStorage: storage,
      onProgress: (p) => progress.push(p.done),
    })
    const files = countTiles(bounds, 5, 8) + countTiles(bounds, 5, 6) + 12
    expect(result).toEqual({ done: files, failed: 0, total: files })
    expect(stores.get('tiles-trip1')!.size).toBe(files)
    expect(peak).toBeLessThanOrEqual(6)
    expect(peak).toBeGreaterThan(1)
    expect(progress.at(-1)).toBe(files)

    fetched.length = 0
    await downloadTiles('trip1', bounds, STYLE_URL, { maxZoom: 8, fetchImpl, cacheStorage: storage })
    expect(fetched).toEqual([])
  })

  it('counts files that failed and keeps going', async () => {
    const { storage, stores } = fakeCaches()
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (json[url]) return Response.json(json[url])
      return url.includes('/ne/') ? new Response('', { status: 404 }) : new Response('tile')
    }) as typeof fetch
    const bounds = tripBounds([queenstown])!
    const result = await downloadTiles('t2', bounds, STYLE_URL, {
      maxZoom: 6,
      fetchImpl,
      cacheStorage: storage,
    })
    expect(result.failed).toBe(countTiles(bounds, 5, 6))
    expect(stores.get('tiles-t2')!.size).toBe(result.done)
  })
})
