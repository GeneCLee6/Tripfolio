import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GeoUsageResponse, OgResponse } from '../../../shared/api/geo.ts'
import {
  decodeEntities,
  fetchable,
  headOf,
  OG_LIMITS,
  parseOg,
  readCapped,
} from '../../../worker/proxy/og.ts'
import { createHarness, createTrip, restoreDeps, type Harness } from './helpers.ts'

const SAMPLE = `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>Fergburger | Queenstown</title>
  <meta property="og:site_name" content="Fergburger">
  <meta property="og:title" content="Fergburger &amp; Co &#8211; Queenstown">
  <meta content='/img/burger.jpg' property='og:image'>
  <meta name="twitter:image" content="https://cdn.example.com/twitter.jpg">
</head>
<body><meta property="og:title" content="Not in the head"></body></html>`

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } })

describe('og parsing', () => {
  const base = new URL('https://fergburger.example.com/menu')

  it('reads og:title, og:image (made absolute) and site name from the head', () => {
    expect(parseOg(SAMPLE, base)).toEqual({
      title: 'Fergburger & Co – Queenstown',
      imageUrl: 'https://fergburger.example.com/img/burger.jpg',
      siteName: 'Fergburger',
    })
  })

  it('falls back to twitter:image and <title>, and ignores the body', () => {
    const page = `<head><title> Plain  title </title><meta name="twitter:image" content="https://cdn.example.com/t.jpg"></head><body><meta property="og:image" content="https://evil.example.com/x.jpg"></body>`
    expect(parseOg(page, base)).toEqual({
      title: 'Plain title',
      imageUrl: 'https://cdn.example.com/t.jpg',
      siteName: null,
    })
  })

  it('drops non-http images and returns nulls for an empty head', () => {
    expect(parseOg('<head><meta property="og:image" content="javascript:alert(1)"></head>', base).imageUrl).toBeNull()
    expect(parseOg('', base)).toEqual({ title: null, imageUrl: null, siteName: null })
  })

  it('cuts at </head> or <body>', () => {
    expect(headOf('<head>a</head><body>b')).toBe('<head>a')
    expect(headOf('<title>x</title><body class="y">z')).toBe('<title>x</title>')
  })

  it('decodes entities', () => {
    expect(decodeEntities('a &amp; b &#x4E2D; &#25991; &unknown;')).toBe('a & b 中 文 &unknown;')
  })

  it('reads at most the cap and stops after the head', async () => {
    const big = 'x'.repeat(3 * 1024 * 1024)
    const capped = await readCapped(new Response(big), OG_LIMITS.maxBytes)
    expect(capped.length).toBe(OG_LIMITS.maxBytes)
    const early = await readCapped(new Response(`<head><title>t</title></head><body>${big}`), 5000)
    expect(early.length).toBeLessThanOrEqual(5000)
  })

  it('only allows public http(s) hosts', () => {
    const ok = (u: string) => fetchable(new URL(u))
    expect(ok('https://www.fergburger.com/')).toBe(true)
    expect(ok('http://example.co.nz/page')).toBe(true)
    expect(ok('ftp://example.com/')).toBe(false)
    expect(ok('http://localhost:8787/')).toBe(false)
    expect(ok('http://127.0.0.1/')).toBe(false)
    expect(ok('http://169.254.169.254/latest')).toBe(false)
    expect(ok('http://[::1]/')).toBe(false)
    expect(ok('http://printer.local/')).toBe(false)
    expect(ok('https://example.com:8443/')).toBe(false)
    expect(ok('https://user:pw@example.com/')).toBe(false)
  })
})

describe('POST /api/trips/:id/og', () => {
  let h: Harness
  let trip: Awaited<ReturnType<typeof createTrip>>

  beforeEach(async () => {
    h = createHarness()
    trip = await createTrip(h)
  })
  afterEach(restoreDeps)

  const og = (url: string, token = trip.owner) =>
    h.call<OgResponse & { error?: { code: string } }>('POST', `/api/trips/${trip.tripId}/og`, {
      token,
      body: { url },
    })

  it('returns the preview, following a redirect', async () => {
    h.on('short.example.com', () =>
      new Response(null, { status: 301, headers: { location: 'https://fergburger.example.com/menu' } }),
    )
    h.on('fergburger.example.com', () => html(SAMPLE))
    const res = await og('https://short.example.com/x')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      url: 'https://fergburger.example.com/menu',
      title: 'Fergburger & Co – Queenstown',
      imageUrl: 'https://fergburger.example.com/img/burger.jpg',
      siteName: 'Fergburger',
    })
    expect(h.calls[0]!.init?.redirect).toBe('manual')
  })

  it('refuses private hosts, also behind a redirect', async () => {
    expect((await og('http://127.0.0.1/admin')).body.error?.code).toBe('url_not_allowed')
    h.on('bounce.example.com', () =>
      new Response(null, { status: 302, headers: { location: 'http://localhost/secret' } }),
    )
    const res = await og('https://bounce.example.com/')
    expect(res.status).toBe(422)
    expect(h.calls.map((c) => c.url)).toEqual(['https://bounce.example.com/'])
  })

  it('502 when the page fails; an image link previews itself', async () => {
    h.on('down.example.com', () => new Response('nope', { status: 500 }))
    expect((await og('https://down.example.com/')).status).toBe(502)
    h.on('img.example.com', () => new Response('x', { headers: { 'content-type': 'image/jpeg' } }))
    expect((await og('https://img.example.com/a.jpg')).body.imageUrl).toBe('https://img.example.com/a.jpg')
  })

  it('caches a preview for 7 days in geoCache and counts real fetches as og in apiUsage', async () => {
    h.on('fergburger.example.com', () => html(SAMPLE))
    const first = await og('https://fergburger.example.com/#menu')
    const second = await og('https://fergburger.example.com/')
    expect(second.body).toEqual(first.body)
    expect(h.calls).toHaveLength(1)
    const cached = h.sqlite
      .prepare("SELECT provider, expiresAt FROM geoCache WHERE key LIKE 'og:%'")
      .all()
    expect(cached).toEqual([{ provider: 'og', expiresAt: h.clock.now + 7 * 24 * 3600 * 1000 }])
    const usage = await h.call<GeoUsageResponse>('GET', `/api/trips/${trip.tripId}/geo/usage`, {
      token: trip.owner,
    })
    expect(usage.body.trip).toEqual({ photon: 0, nominatim: 0, ors: 0, fx: 0, og: 1 })
    expect(usage.body.all.og).toBe(1)

    // a failed fetch is counted too, and not cached
    h.on('down.example.com', () => new Response('nope', { status: 500 }))
    expect((await og('https://down.example.com/')).status).toBe(502)
    expect((await og('https://down.example.com/')).status).toBe(502)
    const after = await h.call<GeoUsageResponse>('GET', `/api/trips/${trip.tripId}/geo/usage`, {
      token: trip.owner,
    })
    expect(after.body.trip.og).toBe(3)

    // after 7 days the page is fetched again
    h.clock.now += 7 * 24 * 3600 * 1000 + 1
    await og('https://fergburger.example.com/')
    expect(h.calls.filter((c) => c.url.includes('fergburger'))).toHaveLength(2)
  })

  it('needs an editor and limits each member to 20 a minute', async () => {
    h.on('fergburger.example.com', () => html(SAMPLE))
    expect((await og('https://fergburger.example.com/', 'nope')).status).toBe(401)
    for (let i = 0; i < OG_LIMITS.perMemberPerMinute; i++) {
      expect((await og('https://fergburger.example.com/')).status).toBe(200)
    }
    const limited = await og('https://fergburger.example.com/')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
  })
})
