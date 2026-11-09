// Link previews for wishlist items (e5-t02): POST /api/trips/:id/og { url } fetches the page and reads
// og:title / og:image (and twitter:* / <title> fallbacks) from its <head> only. Guard rails: http(s)
// URLs on public host names only (no IP literals, no localhost), redirects followed by hand (at most
// 3, each re-checked), 3 s for the whole thing, at most 1 MB read, 20 requests per member per minute.
// Answers are cached in geoCache (provider 'og', key `og:<url>`) for 7 days and every real fetch is
// counted in apiUsage (provider 'og'), like the other proxies (CLAUDE.md rule 3).

import { z } from 'zod'
import type { OgResponse } from '../../shared/api/geo.ts'
import { authTrip } from '../auth.ts'
import { ApiError, json, readBody } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { nowIsoFrom, proxyDeps } from './deps.ts'
import { countUsage, enforceRateLimit, withRetryAfter } from './limits.ts'

export const OG_LIMITS = {
  perMemberPerMinute: 20,
  timeoutMs: 3000,
  maxBytes: 1024 * 1024,
  maxRedirects: 3,
  /** Days a preview stays in geoCache */
  cacheDays: 7,
} as const

/** apiUsage and geoCache provider name */
export const OG_PROVIDER = 'og'

/** geoCache key of a preview: the requested URL without its fragment */
export function ogCacheKey(url: URL): string {
  const copy = new URL(url.href)
  copy.hash = ''
  return `og:${copy.href}`
}

async function readOgCache(db: D1Database, key: string): Promise<OgResponse | null> {
  const row = await db
    .prepare('SELECT results FROM geoCache WHERE key = ? AND expiresAt > ?')
    .bind(key, proxyDeps.now())
    .first<{ results: string }>()
  if (!row) return null
  try {
    return JSON.parse(row.results) as OgResponse
  } catch {
    return null
  }
}

async function writeOgCache(db: D1Database, key: string, preview: OgResponse): Promise<void> {
  const now = proxyDeps.now()
  await db
    .prepare(
      `INSERT OR REPLACE INTO geoCache (key, provider, results, createdAt, expiresAt)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      key,
      OG_PROVIDER,
      JSON.stringify(preview),
      nowIsoFrom(now),
      now + OG_LIMITS.cacheDays * 24 * 3600 * 1000,
    )
    .run()
}

/** Whether the proxy may fetch `url`: http(s), a public-looking host name, default ports */
export function fetchable(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  if (host.startsWith('[') || host.includes(':')) return false // IPv6 literal
  if (!host.includes('.')) return false // localhost, intranet names
  if (/^[\d.]+$/.test(host)) return false // IPv4 literal (any notation)
  if (/(^|\.)(localhost|local|internal|lan|home\.arpa)$/.test(host)) return false
  if (url.port && url.port !== '80' && url.port !== '443') return false
  return true
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return NAMED[body.toLowerCase()] ?? whole
  })
}

const HEAD_END = /<\/head\s*>|<body[\s>]/i

/** The part of the document before </head> (or <body>) */
export function headOf(html: string): string {
  const end = html.search(HEAD_END)
  return end >= 0 ? html.slice(0, end) : html
}

function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /([a-z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi
  for (const m of tag.matchAll(re)) {
    out.set(m[1]!.toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '')
  }
  return out
}

function clean(value: string | undefined, max: number): string | null {
  if (value === undefined) return null
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : null
}

/** Reads the preview fields from a document's <head>; `base` resolves relative image URLs */
export function parseOg(html: string, base: URL): Omit<OgResponse, 'url'> {
  const head = headOf(html)
  const meta = new Map<string, string>()
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(m[0])
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase()
    const content = attrs.get('content')
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content)
  }
  const titleTag = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const title =
    clean(meta.get('og:title'), 300) ??
    clean(meta.get('twitter:title'), 300) ??
    clean(titleTag, 300)
  let imageUrl: string | null = null
  for (const key of ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image']) {
    const raw = clean(meta.get(key), 2000)
    if (!raw) continue
    try {
      const resolved = new URL(raw, base)
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        imageUrl = resolved.href.slice(0, 2000)
        break
      }
    } catch {
      // not a URL: try the next one
    }
  }
  return { title, imageUrl, siteName: clean(meta.get('og:site_name'), 200) }
}

/** Reads at most `max` bytes of the body, stopping early once the head has ended */
export async function readCapped(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  try {
    while (bytes < max) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = value.byteLength + bytes > max ? value.subarray(0, max - bytes) : value
      bytes += chunk.byteLength
      text += decoder.decode(chunk, { stream: true })
      if (HEAD_END.test(text)) break
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  return text + decoder.decode()
}

const unreachable = (message: string) => new ApiError(502, 'og_unavailable', message)
const notAllowed = () => new ApiError(422, 'url_not_allowed', 'this URL cannot be fetched')

function discard(response: Response): void {
  response.body?.cancel().catch(() => {})
}

/** Fetches `start` (following redirects by hand, each one checked) and returns its preview */
export async function fetchOg(start: URL): Promise<OgResponse> {
  const signal = AbortSignal.timeout(OG_LIMITS.timeoutMs)
  let current = start
  for (let hop = 0; hop <= OG_LIMITS.maxRedirects; hop++) {
    if (!fetchable(current)) throw notAllowed()
    let response: Response
    try {
      response = await proxyDeps.fetch(current.href, {
        redirect: 'manual',
        signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; TripfolioLinkPreview/1.0)',
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        },
      })
    } catch {
      throw unreachable('the page did not answer in time')
    }
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      discard(response)
      try {
        current = new URL(location, current)
      } catch {
        throw unreachable('bad redirect')
      }
      continue
    }
    if (!response.ok) {
      discard(response)
      throw unreachable(`the page answered ${response.status}`)
    }
    const type = response.headers.get('content-type') ?? ''
    if (type && !/html|xml/i.test(type)) {
      discard(response)
      // A link straight to an image is its own preview
      const imageUrl = /^image\//i.test(type) ? current.href : null
      return { url: current.href, title: null, imageUrl, siteName: null }
    }
    let html: string
    try {
      html = await readCapped(response, OG_LIMITS.maxBytes)
    } catch {
      throw unreachable('the page did not answer in time')
    }
    return { url: current.href, ...parseOg(html, current) }
  }
  throw unreachable('too many redirects')
}

const ogBodySchema = z.object({ url: z.url({ protocol: /^https?$/ }).max(2000) })

/** POST /api/trips/:id/og { url } → OgResponse (cached 7 days); 422 url_not_allowed, 502
 * og_unavailable, 429 */
export function ogPreview(c: RouteContext): Promise<Response> {
  return withRetryAfter(async () => {
    const auth = await authTrip(c.request, c.env.DB, c.params.id, 'editor')
    const { url } = await readBody(c.request, ogBodySchema)
    await enforceRateLimit(c.env.DB, `og:${auth.member.id}`, OG_LIMITS.perMemberPerMinute)
    const parsed = new URL(url)
    if (!fetchable(parsed)) throw notAllowed()
    const key = ogCacheKey(parsed)
    const cached = await readOgCache(c.env.DB, key)
    if (cached) return json(cached)
    // Counted before the fetch: a page that fails or times out was still called
    await countUsage(c.env.DB, auth.trip.id, OG_PROVIDER)
    const preview = await fetchOg(parsed)
    await writeOgCache(c.env.DB, key, preview)
    return json(preview)
  })
}
