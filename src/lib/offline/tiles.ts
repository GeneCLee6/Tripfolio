// Offline map tiles for one trip (e3-t06, docs/PRD/e3-places-map.md 離線): the bounding box of
// every point of the trip plus 20 km, zoom 5–12, fetched six at a time into the Cache Storage
// cache `tiles-<tripId>`; the Service Worker (sw/sw.ts) answers tile requests from any cache
// first. The basemap style, its TileJSON, the sprite and the Latin glyph ranges are saved with the
// tiles, so the map can start offline and the tile URLs match the version that was downloaded.
// CJK labels need no glyphs: MapLibre draws ideographs with a local font.
//
// The pure parts (bounds, tile maths, the plan) are unit-tested (tests/src/offline/tiles.test.ts).

export interface LngLat {
  lat: number
  lng: number
}

/** [west, south, east, north] in degrees */
export type Bounds = [number, number, number, number]

export const MIN_ZOOM = 5
export const MAX_ZOOM = 12
/** The size estimate per tile (vector tiles average well under this at z ≤ 12) */
export const BYTES_PER_TILE = 25_000
export const MAX_BYTES = 150 * 1024 * 1024
export const PADDING_KM = 20
export const CONCURRENCY = 6
const MAX_LAT = 85.0511287798
const KM_PER_DEGREE = 111.32
/** Basic Latin, Latin-1/Extended-A, General Punctuation: what the place names around need */
const GLYPH_RANGES = ['0-255', '256-511', '8192-8447']

export const tilesCacheName = (tripId: string): string => `tiles-${tripId}`

const clampLat = (lat: number) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))

/** The box around every point plus `padKm` on each side; null without points */
export function tripBounds(points: readonly LngLat[], padKm = PADDING_KM): Bounds | null {
  const valid = points.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90,
  )
  if (valid.length === 0) return null
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const { lat, lng } of valid) {
    west = Math.min(west, lng)
    east = Math.max(east, lng)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  const dLat = padKm / KM_PER_DEGREE
  // Longitude degrees shrink towards the poles: pad with the widest latitude of the box
  const widest = Math.min(89, Math.max(Math.abs(south), Math.abs(north)))
  const dLng = padKm / (KM_PER_DEGREE * Math.cos((widest * Math.PI) / 180))
  return [
    Math.max(-180, west - dLng),
    clampLat(south - dLat),
    Math.min(180, east + dLng),
    clampLat(north + dLat),
  ]
}

/** Web Mercator tile column and row of a point at zoom z (XYZ scheme) */
export function tileOf(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z
  const rad = (clampLat(lat) * Math.PI) / 180
  const x = Math.floor(((lng + 180) / 360) * n)
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, v))
  return { x: clamp(x), y: clamp(y) }
}

export function tileRange(bounds: Bounds, z: number) {
  const [west, south, east, north] = bounds
  const a = tileOf(west, north, z)
  const b = tileOf(east, south, z)
  return { minX: a.x, maxX: b.x, minY: a.y, maxY: b.y }
}

export function countTiles(bounds: Bounds, minZoom: number, maxZoom: number): number {
  let count = 0
  for (let z = minZoom; z <= maxZoom; z++) {
    const r = tileRange(bounds, z)
    count += (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1)
  }
  return count
}

export function* enumerateTiles(
  bounds: Bounds,
  minZoom: number,
  maxZoom: number,
): Generator<{ z: number; x: number; y: number }> {
  for (let z = minZoom; z <= maxZoom; z++) {
    const r = tileRange(bounds, z)
    for (let x = r.minX; x <= r.maxX; x++) for (let y = r.minY; y <= r.maxY; y++) yield { z, x, y }
  }
}

/** A tile source of the style, limited to the zooms it has */
export interface TileSource {
  templates: string[]
  minzoom: number
  maxzoom: number
}

/** OpenFreeMap liberty's sources, for an estimate before the style is fetched */
export const DEFAULT_SOURCES: readonly TileSource[] = [
  { templates: [''], minzoom: 0, maxzoom: 14 },
  { templates: [''], minzoom: 0, maxzoom: 6 },
]

export interface SizePlan {
  tiles: number
  bytes: number
  /** Within MAX_BYTES */
  ok: boolean
  /** The highest max zoom (≤ requested) that fits, or null when even MIN_ZOOM does not */
  suggestedMaxZoom: number | null
}

const sourceZooms = (source: TileSource, minZoom: number, maxZoom: number) => ({
  from: Math.max(minZoom, source.minzoom),
  to: Math.min(maxZoom, source.maxzoom),
})

/** Tiles over all sources for zooms minZoom..maxZoom (one source when none are known yet) */
export function tileCount(
  bounds: Bounds,
  sources: readonly TileSource[],
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM,
): number {
  const list = sources.length ? sources : [{ templates: [''], minzoom: 0, maxzoom: 22 }]
  return list.reduce((sum, source) => {
    const { from, to } = sourceZooms(source, minZoom, maxZoom)
    return from > to ? sum : sum + countTiles(bounds, from, to)
  }, 0)
}

export function planSize(
  bounds: Bounds,
  sources: readonly TileSource[] = DEFAULT_SOURCES,
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM,
): SizePlan {
  const tiles = tileCount(bounds, sources, minZoom, maxZoom)
  const bytes = tiles * BYTES_PER_TILE
  let suggestedMaxZoom: number | null = null
  for (let z = maxZoom; z >= minZoom; z--) {
    if (tileCount(bounds, sources, minZoom, z) * BYTES_PER_TILE <= MAX_BYTES) {
      suggestedMaxZoom = z
      break
    }
  }
  return { tiles, bytes, ok: bytes <= MAX_BYTES, suggestedMaxZoom }
}

export const tileUrl = (template: string, z: number, x: number, y: number): string =>
  template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))

/** Every tile URL of the plan, in zoom order */
export function* tileUrls(
  bounds: Bounds,
  sources: readonly TileSource[],
  minZoom = MIN_ZOOM,
  maxZoom = MAX_ZOOM,
): Generator<string> {
  for (const source of sources) {
    const { from, to } = sourceZooms(source, minZoom, maxZoom)
    if (from > to) continue
    for (const { z, x, y } of enumerateTiles(bounds, from, to)) {
      const template = source.templates[(x + y) % source.templates.length]
      yield tileUrl(template, z, x, y)
    }
  }
}

// --- the style's resources -----------------------------------------------------------------------

type Json = Record<string, unknown>
export type FetchJson = (url: string) => Promise<Json>

export interface StyleResources {
  sources: TileSource[]
  /** Style, TileJSON, sprite and glyph URLs to save with the tiles */
  extras: string[]
}

/** Resolves a relative URL against the style's; keeps {z}/{x}/{y} placeholders unescaped */
const absolute = (url: string, base: string) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(url)
    ? url
    : new URL(url, base).href.replace(/%7B/gi, '{').replace(/%7D/gi, '}')

/** Reads the style (and each source's TileJSON) for tile templates and the files the map needs */
export async function resolveStyle(styleUrl: string, fetchJson: FetchJson): Promise<StyleResources> {
  const style = await fetchJson(styleUrl)
  const extras = [styleUrl]
  const sources: TileSource[] = []
  for (const value of Object.values((style.sources ?? {}) as Record<string, Json>)) {
    if (value.type !== 'vector' && value.type !== 'raster') continue
    let spec: Json = value
    if (typeof value.url === 'string') {
      const tileJsonUrl = absolute(value.url, styleUrl)
      extras.push(tileJsonUrl)
      spec = { ...(await fetchJson(tileJsonUrl)), ...stripUrl(value) }
    }
    const tiles = Array.isArray(spec.tiles) ? (spec.tiles as unknown[]).filter(isString) : []
    if (tiles.length === 0) continue
    sources.push({
      templates: tiles.map((tile) => absolute(tile, styleUrl)),
      minzoom: typeof spec.minzoom === 'number' ? spec.minzoom : 0,
      maxzoom: typeof spec.maxzoom === 'number' ? spec.maxzoom : 22,
    })
  }
  for (const sprite of spriteBases(style.sprite)) {
    const base = absolute(sprite, styleUrl)
    extras.push(`${base}.json`, `${base}.png`, `${base}@2x.json`, `${base}@2x.png`)
  }
  if (typeof style.glyphs === 'string') {
    for (const stack of fontStacks(style.layers)) {
      for (const range of GLYPH_RANGES) {
        const url = style.glyphs.replace('{fontstack}', stack).replace('{range}', range)
        // Normalised like the map's own request (spaces become %20)
        extras.push(new URL(url, styleUrl).href)
      }
    }
  }
  return { sources, extras: [...new Set(extras)] }
}

const isString = (value: unknown): value is string => typeof value === 'string'

function stripUrl(source: Json): Json {
  const { url: _url, type: _type, ...rest } = source
  return rest
}

function spriteBases(sprite: unknown): string[] {
  if (typeof sprite === 'string') return [sprite]
  if (Array.isArray(sprite)) {
    return sprite.map((item) => (item as { url?: unknown }).url).filter(isString)
  }
  return []
}

const EXPRESSION_OPS = new Set(['get', 'literal', 'case', 'match', 'coalesce', 'step', 'concat', 'to-string'])

function fontStacks(layers: unknown): string[] {
  const stacks = new Set<string>()
  if (!Array.isArray(layers)) return []
  for (const layer of layers as Json[]) {
    const font = (layer.layout as Json | undefined)?.['text-font']
    // A literal font list; expressions (['get', …], ['literal', …]) are skipped
    if (Array.isArray(font) && font.every(isString) && !EXPRESSION_OPS.has(font[0])) {
      stacks.add(font.join(','))
    }
  }
  return [...stacks]
}

// --- download and clear --------------------------------------------------------------------------

export interface DownloadProgress {
  done: number
  failed: number
  total: number
}

export interface DownloadOptions {
  minZoom?: number
  maxZoom?: number
  onProgress?: (progress: DownloadProgress) => void
  signal?: AbortSignal
  concurrency?: number
  fetchImpl?: typeof fetch
  cacheStorage?: CacheStorage
}

/** Downloads the trip's tiles and the style's files into `tiles-<tripId>`; skips what is there */
export async function downloadTiles(
  tripId: string,
  bounds: Bounds,
  styleUrl: string,
  options: DownloadOptions = {},
): Promise<DownloadProgress> {
  const doFetch = options.fetchImpl ?? fetch.bind(globalThis)
  const storage = options.cacheStorage ?? caches
  const fetchJson: FetchJson = async (url) => {
    const response = await doFetch(url, { signal: options.signal })
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    return (await response.json()) as Json
  }
  const { sources, extras } = await resolveStyle(styleUrl, fetchJson)
  const plan = planSize(bounds, sources, options.minZoom, options.maxZoom)
  if (!plan.ok) throw new TooLargeError(plan)
  // Ask the browser not to evict it under storage pressure (best effort)
  await navigator.storage?.persist?.().catch(() => false)

  const cache = await storage.open(tilesCacheName(tripId))
  const urls = [
    ...extras,
    ...tileUrls(bounds, sources, options.minZoom ?? MIN_ZOOM, options.maxZoom ?? MAX_ZOOM),
  ]
  const progress: DownloadProgress = { done: 0, failed: 0, total: urls.length }
  options.onProgress?.({ ...progress })
  let next = 0
  const worker = async () => {
    while (next < urls.length) {
      if (options.signal?.aborted) return
      const url = urls[next++]
      try {
        if (!(await cache.match(url))) {
          const response = await doFetch(url, { mode: 'cors', signal: options.signal })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          await cache.put(url, response)
        }
        progress.done += 1
      } catch {
        if (options.signal?.aborted) return
        progress.failed += 1
      }
      options.onProgress?.({ ...progress })
    }
  }
  await Promise.all(Array.from({ length: options.concurrency ?? CONCURRENCY }, worker))
  return progress
}

export class TooLargeError extends Error {
  readonly plan: SizePlan
  constructor(plan: SizePlan) {
    super(`offline map too large: ${plan.bytes} bytes`)
    this.name = 'TooLargeError'
    this.plan = plan
  }
}

/** How many files the trip's offline map has (0: none) */
export async function offlineTileCount(tripId: string, storage: CacheStorage = caches): Promise<number> {
  if (!(await storage.has(tilesCacheName(tripId)))) return 0
  return (await (await storage.open(tilesCacheName(tripId))).keys()).length
}

export function clearTiles(tripId: string, storage: CacheStorage = caches): Promise<boolean> {
  return storage.delete(tilesCacheName(tripId))
}

/** What this site uses of the device's storage, when the browser says */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  const estimate = await navigator.storage?.estimate?.().catch(() => null)
  if (!estimate || estimate.usage === undefined || estimate.quota === undefined) return null
  return { usage: estimate.usage, quota: estimate.quota }
}

export const offlineMapsSupported = (): boolean =>
  typeof caches !== 'undefined' && typeof navigator !== 'undefined'
