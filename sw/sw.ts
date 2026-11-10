/// <reference lib="webworker" />
// Tripfolio's Service Worker (e10-t05, e3-t06; docs/ARCHITECTURE.md §4.2). Built by Vite as the
// client entry `sw`, emitted to dist/client/sw.js; vite.config.ts replaces __SW_PRECACHE__ (every
// file of the client build) and __SW_VERSION__ (APP_VERSION + a hash of those file names).
// Self-contained on purpose: no imports, so the output is one classic script.
//
//   app shell     precached per version; navigations network-first, offline → cached /index.html;
//                 /assets/* (hashed) cache-first
//   trip data     GET /api/trips, /api/trips/:id and /api/trips/:id/* network-first, falling back
//                 to the cache when the network fails (see note below); only the 3 most recently
//                 opened trips are kept; POST …/geo/route(s) is a read and is cached by body hash
//   writes        never cached (POST/PATCH/PUT/DELETE pass straight through; the app queues them)
//   media         /api/media/*: cache-first, max 200 entries; responses marked no-store
//                 (documents, receipts) are never stored
//   map           OpenFreeMap tiles cache-first from any cache (tiles-<tripId> filled by the app's
//                 下載離線地圖); style, TileJSON, sprite, glyphs network-first with a fallback that
//                 prefers the copy saved next to the offline tiles; Google Fonts cache-first
//   update        a new version waits; the app shows 「有新版本」 and posts {type:'skip-waiting'}
//
// Why trip data is network-first, not stale-while-revalidate: the app re-reads a list right after
// writing (e.g. the expense list after 記一筆); a stale answer there would hide the write until the
// next load. Offline (or when the network errors) the cached copy answers, marked with the header
// x-tripfolio-offline: 1.

declare const self: ServiceWorkerGlobalScope
declare const __SW_PRECACHE__: string[]
declare const __SW_VERSION__: string

const VERSION = __SW_VERSION__
const SHELL = `shell-${VERSION}`
const MAP_STATIC = 'map-static-v1'
const FONTS = 'fonts-v1'
const MEDIA = 'media-v1'
const META = 'meta-v1'
const DATA_PREFIX = 'data-'
const DATA_INDEX = 'data-index'
const TILES_PREFIX = 'tiles-'
const RECENT_KEY = '/__sw/recent-trips'
const MAX_TRIPS = 3
const MAX_MEDIA = 200
const MAP_HOSTS = new Set(['tiles.openfreemap.org'])
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])
/** Files outside the bundle (public/) that the shell needs */
const PUBLIC_FILES = ['/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png']

const TRIP_PATH = /^\/api\/trips\/([^/]+)(\/.*)?$/
const ROUTE_PATH = /^\/api\/trips\/([^/]+)\/geo\/routes?$/
/** Vector and raster tiles: …/{z}/{x}/{y}.pbf|png */
const TILE_PATH = /\/\d+\/\d+\/\d+\.(pbf|mvt|png|jpg|webp)$/

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll([...new Set([...__SW_PRECACHE__, ...PUBLIC_FILES])])),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('shell-') && name !== SHELL) await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

type Message =
  | { type: 'skip-waiting' }
  | { type: 'trip-opened'; tripId: string }
  | { type: 'forget-trip'; tripId: string }
  | { type: 'version' }

self.addEventListener('message', (event) => {
  const message = event.data as Message | null
  if (!message || typeof message !== 'object') return
  switch (message.type) {
    case 'skip-waiting':
      void self.skipWaiting()
      break
    case 'trip-opened':
      if (typeof message.tripId === 'string') event.waitUntil(touchTrip(message.tripId))
      break
    case 'forget-trip':
      if (typeof message.tripId === 'string') event.waitUntil(forgetTrip(message.tripId))
      break
    case 'version':
      event.ports[0]?.postMessage({ version: VERSION })
      break
  }
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (url.origin === self.location.origin) {
    if (request.method === 'POST') {
      const route = ROUTE_PATH.exec(url.pathname)
      if (route) event.respondWith(routeRead(request, decodeURIComponent(route[1])))
      return
    }
    if (request.method !== 'GET') return
    const path = url.pathname
    if (path.startsWith('/api/')) {
      if (path.startsWith('/api/media/')) {
        event.respondWith(media(request))
        return
      }
      if (path === '/api/trips') {
        event.respondWith(networkFirst(request, DATA_INDEX))
        return
      }
      const trip = TRIP_PATH.exec(path)
      // Search answers are not worth keeping; everything else under the trip is its data
      if (trip && !(trip[2] ?? '').startsWith('/geo/')) {
        const tripId = decodeURIComponent(trip[1])
        event.respondWith(networkFirst(request, DATA_PREFIX + tripId, tripId))
      }
      return
    }
    // The share page and WebSockets are never the app shell
    if (path.startsWith('/s/') || path.startsWith('/ws/')) return
    if (request.mode === 'navigate') {
      event.respondWith(navigation(request))
      return
    }
    if (path.startsWith('/assets/') || path.startsWith('/icons/') || PUBLIC_FILES.includes(path)) {
      event.respondWith(cacheFirst(request, SHELL))
    }
    return
  }

  if (request.method !== 'GET') return
  if (MAP_HOSTS.has(url.hostname)) {
    event.respondWith(TILE_PATH.test(url.pathname) ? tile(request) : mapResource(request))
    return
  }
  if (FONT_HOSTS.has(url.hostname)) event.respondWith(cacheFirst(request, FONTS))
})

// --- strategies ---------------------------------------------------------------------------------

async function navigation(request: Request): Promise<Response> {
  try {
    return await fetch(request)
  } catch (error) {
    const shell = await caches.open(SHELL)
    const cached = (await shell.match('/index.html')) ?? (await shell.match('/'))
    if (cached) return cached
    throw error
  }
}

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok || response.type === 'opaque') {
    const cache = await caches.open(cacheName)
    await cache.put(request, response.clone())
  }
  return response
}

function offlineResponse(cached: Response): Response {
  const headers = new Headers(cached.headers)
  headers.set('x-tripfolio-offline', '1')
  return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers })
}

const offlineError = () =>
  new Response(
    JSON.stringify({ error: { code: 'offline', message: 'offline and not cached on this device' } }),
    { status: 503, headers: { 'content-type': 'application/json', 'x-tripfolio-offline': '1' } },
  )

async function networkFirst(request: Request, cacheName: string, tripId?: string): Promise<Response> {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const copy = response.clone()
      void (async () => {
        if (tripId) await touchTrip(tripId)
        const cache = await caches.open(cacheName)
        await cache.put(request, copy)
      })()
    }
    return response
  } catch {
    const cache = await caches.open(cacheName)
    const cached = await cache.match(request, { ignoreVary: true })
    return cached ? offlineResponse(cached) : offlineError()
  }
}

/** POST /geo/route(s) only reads (ORS behind the Worker): keep the answer under a hash of the body */
async function routeRead(request: Request, tripId: string): Promise<Response> {
  const body = await request.clone().text()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.url + body))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const key = new Request(`${self.location.origin}/__sw/routes/${encodeURIComponent(tripId)}/${hex}`)
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(DATA_PREFIX + tripId)
      await cache.put(key, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(key)
    return cached ? offlineResponse(cached) : offlineError()
  }
}

async function media(request: Request): Promise<Response> {
  const cache = await caches.open(MEDIA)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  const cacheControl = response.headers.get('cache-control') ?? ''
  // Documents and receipts say no-store: they never touch the disk cache (RULES.md §4)
  if (response.ok && !/no-store/i.test(cacheControl)) {
    await cache.put(request, response.clone())
    const keys = await cache.keys()
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_MEDIA))) await cache.delete(old)
  }
  return response
}

/** Tiles: whatever cache has it (an offline download, or one seen before), else the network */
async function tile(request: Request): Promise<Response> {
  const cached = await caches.match(request)
  if (cached) return cached
  return fetch(request)
}

/**
 * Style, TileJSON, sprite, glyphs: the network, saved to map-static; offline, prefer the copy saved
 * with an offline download (its TileJSON points at the tile version that was downloaded).
 */
async function mapResource(request: Request): Promise<Response> {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(MAP_STATIC)
      await cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    for (const name of await caches.keys()) {
      if (!name.startsWith(TILES_PREFIX)) continue
      const cached = await (await caches.open(name)).match(request)
      if (cached) return cached
    }
    const cached = await (await caches.open(MAP_STATIC)).match(request)
    if (cached) return cached
    throw error
  }
}

// --- the 3 most recently opened trips ----------------------------------------------------------

let recent: string[] | null = null

async function loadRecent(): Promise<string[]> {
  if (recent) return recent
  const cached = await (await caches.open(META)).match(RECENT_KEY)
  try {
    const list: unknown = cached ? await cached.json() : []
    recent = Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []
  } catch {
    recent = []
  }
  return recent
}

async function saveRecent(list: string[]): Promise<void> {
  recent = list
  const meta = await caches.open(META)
  await meta.put(
    RECENT_KEY,
    new Response(JSON.stringify(list), { headers: { 'content-type': 'application/json' } }),
  )
}

async function touchTrip(tripId: string): Promise<void> {
  const list = await loadRecent()
  if (list[0] === tripId) return
  const next = [tripId, ...list.filter((id) => id !== tripId)]
  for (const dropped of next.slice(MAX_TRIPS)) await caches.delete(DATA_PREFIX + dropped)
  await saveRecent(next.slice(0, MAX_TRIPS))
}

async function forgetTrip(tripId: string): Promise<void> {
  const list = await loadRecent()
  await caches.delete(DATA_PREFIX + tripId)
  await saveRecent(list.filter((id) => id !== tripId))
}
