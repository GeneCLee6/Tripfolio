// Place search (e3-t02): Photon first, Nominatim as the fallback (ARCHITECTURE.md §5: the order of
// `providers` is the switch). Results are normalised to GeoResult and cached in geoCache for 7 days;
// provider calls are counted in apiUsage; each member gets 30 search/parse requests per minute.

import {
  GEO_LIMITS,
  type GeoProvider,
  type GeoResult,
  type GeoSearchResponse,
} from '../../shared/api/geo.ts'
import { authTrip } from '../auth.ts'
import type { Env } from '../env.ts'
import { ApiError, invalid, json } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { categoryFor } from './categories.ts'
import { nowIsoFrom, providerHeaders, proxyDeps } from './deps.ts'
import { claimSlot, countUsage, enforceRateLimit, withRetryAfter } from './limits.ts'

export const DEFAULT_PHOTON_URL = 'https://photon.komoot.io/api/'
export const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

const LIMIT = 8
const TIMEOUT_MS = 4000
const CACHE_TTL_MS = GEO_LIMITS.geoCacheDays * 24 * 3600 * 1000
/** Languages the public Photon instance accepts; others get `default` (local names) */
const PHOTON_LANGS = new Set(['en', 'de', 'fr'])

export interface SearchQuery {
  q: string
  lang: string
  bias: { lat: number; lng: number } | null
}

const providers: GeoProvider[] = ['photon', 'nominatim']

/** Case, width and spacing do not make a different query */
export function normaliseQuery(q: string): string {
  return q.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function cacheKey(provider: GeoProvider, query: SearchQuery): string {
  // Bias rounded to 0.1° (~11 km): nearby searches share entries
  const bias = query.bias ? `${query.bias.lat.toFixed(1)},${query.bias.lng.toFixed(1)}` : '-'
  return `${provider}|${query.lang}|${normaliseQuery(query.q)}|${bias}`
}

export function parseSearchQuery(url: URL): SearchQuery {
  const q = (url.searchParams.get('q') ?? '').trim()
  if (q.length === 0 || q.length > 200) throw invalid('q: 1–200 characters')
  const lang = (url.searchParams.get('lang') ?? 'en').trim().toLowerCase()
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(lang)) throw invalid('lang: a BCP 47 tag such as zh-TW')
  const latRaw = url.searchParams.get('lat')
  const lngRaw = url.searchParams.get('lng')
  let bias: SearchQuery['bias'] = null
  if (latRaw || lngRaw) {
    const lat = Number(latRaw)
    const lng = Number(lngRaw)
    if (!latRaw || !lngRaw || !Number.isFinite(lat) || !Number.isFinite(lng))
      throw invalid('lat and lng: both numbers, or neither')
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw invalid('lat/lng out of range')
    bias = { lat, lng }
  }
  return { q, lang, bias }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const round7 = (n: number) => Math.round(n * 1e7) / 1e7

/** Joins address parts, dropping blanks and repeats */
function joinParts(parts: unknown[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const s = str(p).trim()
    if (s && !seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out.join(', ')
}

const osmLetter = (t: string) => (t ? t[0].toUpperCase() : '')

// --- Photon -------------------------------------------------------------------------------------

interface PhotonFeature {
  geometry?: { coordinates?: unknown }
  properties?: Record<string, unknown>
}

export function normalisePhoton(body: unknown, lang: string): GeoResult[] {
  const features = (body as { features?: unknown })?.features
  if (!Array.isArray(features)) throw new Error('photon: no features')
  const out: GeoResult[] = []
  for (const f of features as PhotonFeature[]) {
    const coords = f.geometry?.coordinates
    const p = f.properties ?? {}
    if (!Array.isArray(coords) || typeof coords[0] !== 'number' || typeof coords[1] !== 'number')
      continue
    const street = joinParts([[str(p.housenumber), str(p.street)].filter(Boolean).join(' ')])
    const address = joinParts([street, p.district, p.city, p.state, p.postcode, p.country])
    const name = str(p.name) || street || str(p.city) || address
    if (!name) continue
    out.push({
      nameLocal: name,
      nameEn: lang.startsWith('en') ? name : '',
      lat: round7(coords[1]),
      lng: round7(coords[0]),
      address,
      category: categoryFor(str(p.osm_key), str(p.osm_value)),
      source: 'photon',
      externalId: `osm:${osmLetter(str(p.osm_type))}${String(p.osm_id ?? '')}`,
    })
  }
  return out
}

async function searchPhoton(env: Env, query: SearchQuery, origin: string): Promise<GeoResult[]> {
  const url = new URL(env.PHOTON_URL || DEFAULT_PHOTON_URL)
  url.searchParams.set('q', query.q)
  url.searchParams.set('limit', String(LIMIT))
  const primary = query.lang.split('-')[0]
  url.searchParams.set('lang', PHOTON_LANGS.has(primary) ? primary : 'default')
  if (query.bias) {
    url.searchParams.set('lat', String(query.bias.lat))
    url.searchParams.set('lon', String(query.bias.lng))
  }
  const response = await proxyDeps.fetch(url.toString(), {
    headers: providerHeaders(origin),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`photon: HTTP ${response.status}`)
  return normalisePhoton(await response.json(), primary)
}

// --- Nominatim ----------------------------------------------------------------------------------

interface NominatimPlace {
  lat?: unknown
  lon?: unknown
  name?: unknown
  display_name?: unknown
  category?: unknown
  type?: unknown
  osm_type?: unknown
  osm_id?: unknown
  namedetails?: Record<string, unknown> | null
}

export function normaliseNominatim(body: unknown): GeoResult[] {
  if (!Array.isArray(body)) throw new Error('nominatim: not a list')
  const out: GeoResult[] = []
  for (const p of body as NominatimPlace[]) {
    const lat = Number(p.lat)
    const lng = Number(p.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const display = str(p.display_name)
    const local = str(p.namedetails?.name) || str(p.name)
    const shown = str(p.name) || local
    // display_name starts with the name in the requested language; the rest is the address
    const address =
      shown && display.startsWith(`${shown}, `) ? display.slice(shown.length + 2) : display
    const nameLocal = local || shown || display
    if (!nameLocal) continue
    out.push({
      nameLocal,
      nameEn: str(p.namedetails?.['name:en']),
      lat: round7(lat),
      lng: round7(lng),
      address,
      category: categoryFor(str(p.category), str(p.type)),
      source: 'nominatim',
      externalId: `osm:${osmLetter(str(p.osm_type))}${String(p.osm_id ?? '')}`,
    })
  }
  return out
}

async function searchNominatim(env: Env, query: SearchQuery, origin: string): Promise<GeoResult[]> {
  const url = new URL(env.NOMINATIM_URL || DEFAULT_NOMINATIM_URL)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('q', query.q)
  url.searchParams.set('accept-language', query.lang)
  url.searchParams.set('limit', String(LIMIT))
  url.searchParams.set('namedetails', '1')
  if (query.bias) {
    // Nominatim has no point bias: prefer (not restrict to) a box of ±0.5° around it
    const { lat, lng } = query.bias
    url.searchParams.set('viewbox', `${lng - 0.5},${lat + 0.5},${lng + 0.5},${lat - 0.5}`)
  }
  const response = await proxyDeps.fetch(url.toString(), {
    headers: providerHeaders(origin),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`nominatim: HTTP ${response.status}`)
  return normaliseNominatim(await response.json())
}

// --- Search -------------------------------------------------------------------------------------

async function readCache(db: D1Database, key: string): Promise<GeoResult[] | null> {
  const row = await db
    .prepare('SELECT results FROM geoCache WHERE key = ? AND expiresAt > ?')
    .bind(key, proxyDeps.now())
    .first<{ results: string }>()
  if (!row) return null
  try {
    return JSON.parse(row.results) as GeoResult[]
  } catch {
    return null
  }
}

async function writeCache(
  db: D1Database,
  key: string,
  provider: GeoProvider,
  results: GeoResult[],
): Promise<void> {
  const now = proxyDeps.now()
  await db.batch([
    db.prepare('DELETE FROM geoCache WHERE expiresAt <= ?').bind(now),
    db
      .prepare(
        `INSERT OR REPLACE INTO geoCache (key, provider, results, createdAt, expiresAt)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(key, provider, JSON.stringify(results), nowIsoFrom(now), now + CACHE_TTL_MS),
  ])
}

/**
 * Cached answer from any provider first; then the providers in order. A provider that fails or
 * finds nothing hands over to the next one; only the last provider's empty answer is cached.
 */
export async function searchPlaces(
  env: Env,
  tripId: string,
  query: SearchQuery,
  origin: string,
): Promise<GeoSearchResponse> {
  const db = env.DB
  for (const provider of providers) {
    const results = await readCache(db, cacheKey(provider, query))
    if (results) return { results, source: provider, cached: true }
  }
  let answered: GeoProvider | null = null
  for (const [i, provider] of providers.entries()) {
    const last = i === providers.length - 1
    try {
      if (provider === 'nominatim' && !(await claimSlot(db, 'nominatim', 1000))) continue
      await countUsage(db, tripId, provider)
      const results =
        provider === 'photon'
          ? await searchPhoton(env, query, origin)
          : await searchNominatim(env, query, origin)
      answered = provider
      if (results.length === 0 && !last) continue
      await writeCache(db, cacheKey(provider, query), provider, results)
      return { results, source: results.length ? provider : null, cached: false }
    } catch (error) {
      console.warn(`geo search: ${provider} failed`, error)
    }
  }
  if (answered) return { results: [], source: null, cached: false }
  throw new ApiError(502, 'geo_unavailable', 'place search is unavailable, try again later')
}

/** GET /api/trips/:id/geo/search?q=&lat=&lng=&lang= (any member) */
export function geoSearch(c: RouteContext): Promise<Response> {
  return withRetryAfter(async () => {
    const auth = await authTrip(c.request, c.env.DB, c.params.id, 'viewer')
    const query = parseSearchQuery(c.url)
    await enforceRateLimit(c.env.DB, `geo:${auth.member.id}`, GEO_LIMITS.geoPerMemberPerMinute)
    return json(await searchPlaces(c.env, auth.trip.id, query, c.url.origin))
  })
}
