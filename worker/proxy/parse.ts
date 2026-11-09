// Coordinates from pasted text (e3-t02): `lat, lng`, Google Maps URLs (`!3dLAT!4dLNG`, `/@lat,lng,`,
// `?q=lat,lng`) and maps.app.goo.gl short links, which are followed server-side (at most 2 hops,
// 3 s in all, only to Google hosts).

import { z } from 'zod'
import { GEO_LIMITS, type GeoParseResponse } from '../../shared/api/geo.ts'
import { authTrip } from '../auth.ts'
import { ApiError, json, readBody } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { providerHeaders, proxyDeps } from './deps.ts'
import { enforceRateLimit, withRetryAfter } from './limits.ts'

export interface ParsedLocation {
  lat: number
  lng: number
  name?: string
}

const MAX_HOPS = 2
const TIMEOUT_MS = 3000

const NUM = String.raw`[-+]?\d{1,3}(?:\.\d+)?`
// "-45.03, 168.65", "-45.03 168.65", "(-45.03,168.65)", full-width comma U+FF0C
const COORDS = new RegExp(String.raw`^\(?\s*(${NUM})\s*(?:[,，;]\s*|\s+)(${NUM})\s*\)?$`)

function valid(lat: number, lng: number): ParsedLocation | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat: Math.round(lat * 1e7) / 1e7, lng: Math.round(lng * 1e7) / 1e7 }
}

export function parseCoordinates(text: string): ParsedLocation | null {
  const m = text.trim().match(COORDS)
  return m ? valid(Number(m[1]), Number(m[2])) : null
}

function placeName(url: URL): string | undefined {
  const m = url.pathname.match(/\/maps\/place\/([^/]+)/)
  if (!m) return undefined
  try {
    const name = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim()
    // /place/-45.03,168.65 is a coordinate, not a name
    return name && !parseCoordinates(name) ? name : undefined
  } catch {
    return undefined
  }
}

/** Coordinates in a (long) Google Maps URL; the pin (!3d!4d) wins over the viewport (@) */
export function parseMapsUrl(url: URL): ParsedLocation | null {
  const full = decodeSafe(url.href)
  const name = placeName(url)
  const withName = (loc: ParsedLocation | null) => (loc && name ? { ...loc, name } : loc)
  const pin = full.match(new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`))
  if (pin) return withName(valid(Number(pin[1]), Number(pin[2])))
  for (const param of ['q', 'query', 'll', 'destination', 'center', 'daddr']) {
    const value = url.searchParams.get(param)
    const loc = value ? parseCoordinates(value.replace(/^loc:/, '')) : null
    if (loc) return withName(loc)
  }
  const at = full.match(new RegExp(String.raw`/@(${NUM}),(${NUM})(?:[,/]|$)`))
  if (at) return withName(valid(Number(at[1]), Number(at[2])))
  const placeCoords = url.pathname.match(/\/maps\/place\/([^/]+)/)
  if (placeCoords) return parseCoordinates(decodeSafe(placeCoords[1]))
  // consent.google.com/?continue=<the real URL>
  const next = url.searchParams.get('continue')
  if (next) {
    try {
      return parseMapsUrl(new URL(next))
    } catch {
      return null
    }
  }
  return null
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Short links that only resolve by following their redirect */
export function isShortLink(url: URL): boolean {
  return (
    url.hostname === 'maps.app.goo.gl' ||
    (url.hostname === 'goo.gl' && url.pathname.startsWith('/maps'))
  )
}

/** Hosts a redirect may be followed to (no fetching arbitrary URLs from user input) */
function followable(url: URL): boolean {
  if (url.protocol !== 'https:') return false
  return (
    isShortLink(url) ||
    /^(www\.|maps\.|consent\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(url.hostname)
  )
}

async function resolveShortLink(start: URL, origin: string): Promise<ParsedLocation | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  let current = start
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!followable(current)) return null
    let response: Response
    try {
      response = await proxyDeps.fetch(current.toString(), {
        redirect: 'manual',
        headers: providerHeaders(origin),
        signal,
      })
    } catch {
      return null
    }
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) return null
    let next: URL
    try {
      next = new URL(location, current)
    } catch {
      return null
    }
    const parsed = parseMapsUrl(next)
    if (parsed) return parsed
    current = next
  }
  return null
}

/** The location in pasted text: plain coordinates, or the first URL in it */
export async function resolveLocationText(
  text: string,
  origin: string,
): Promise<GeoParseResponse | null> {
  const coords = parseCoordinates(text)
  if (coords) return { ...coords, source: 'coords' }
  const match = text.match(/https?:\/\/[^\s<>"']+/)
  if (!match) return null
  let url: URL
  try {
    url = new URL(match[0])
  } catch {
    return null
  }
  const parsed =
    parseMapsUrl(url) ?? (isShortLink(url) ? await resolveShortLink(url, origin) : null)
  return parsed ? { ...parsed, source: 'link' } : null
}

const parseBodySchema = z.object({ text: z.string().trim().min(1).max(2000) })

/** POST /api/trips/:id/geo/parse { text } → { lat, lng, name?, source } or 422 no_coordinates */
export function geoParse(c: RouteContext): Promise<Response> {
  return withRetryAfter(async () => {
    const auth = await authTrip(c.request, c.env.DB, c.params.id, 'viewer')
    const { text } = await readBody(c.request, parseBodySchema)
    await enforceRateLimit(c.env.DB, `geo:${auth.member.id}`, GEO_LIMITS.geoPerMemberPerMinute)
    const result = await resolveLocationText(text, c.url.origin)
    if (!result) throw new ApiError(422, 'no_coordinates', 'no coordinates found in the text')
    return json(result)
  })
}
