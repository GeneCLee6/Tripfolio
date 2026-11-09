import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GeoParseResponse, GeoSearchResponse } from '../../../shared/api/geo.ts'
import { categoryFor } from '../../../worker/proxy/categories.ts'
import { parseCoordinates, parseMapsUrl } from '../../../worker/proxy/parse.ts'
import { createHarness, createTrip, jsonResponse, restoreDeps, type Harness } from './helpers.ts'

const photonFergburger = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        osm_type: 'N',
        osm_id: 336415647,
        osm_key: 'amenity',
        osm_value: 'fast_food',
        type: 'house',
        housenumber: '42',
        name: 'Fergburger',
        street: 'Shotover Street',
        district: 'Boydtown',
        city: 'Queenstown',
        state: 'Otago',
        country: 'New Zealand',
        postcode: '9200',
      },
      geometry: { type: 'Point', coordinates: [168.6594621, -45.0317416] },
    },
    { type: 'Feature', properties: { name: 'No geometry' } },
  ],
}

const nominatimFergburger = [
  {
    osm_type: 'node',
    osm_id: 336415647,
    lat: '-45.0317416',
    lon: '168.6594621',
    category: 'amenity',
    type: 'fast_food',
    name: 'Fergburger',
    display_name: 'Fergburger, 42, Shotover Street, Queenstown, Otago, 9300, New Zealand',
    namedetails: { name: 'Fergburger', 'name:en': 'Fergburger' },
  },
]

let h: Harness
let trip: Awaited<ReturnType<typeof createTrip>>

beforeEach(async () => {
  h = createHarness()
  trip = await createTrip(h)
})
afterEach(restoreDeps)

const search = (q: string, extra = '', token = trip.member) =>
  h.call<GeoSearchResponse>(
    'GET',
    `/api/trips/${trip.tripId}/geo/search?q=${encodeURIComponent(q)}${extra}`,
    { token },
  )

const usage = () =>
  h.sqlite.prepare('SELECT provider, tripId, count FROM apiUsage ORDER BY provider').all()

describe('geo search', () => {
  it('normalises Photon results and passes bias and language', async () => {
    h.on('photon.komoot.io', () => jsonResponse(photonFergburger))
    const res = await search('Fergburger Queenstown', '&lat=-45.03&lng=168.66&lang=zh-TW')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      source: 'photon',
      cached: false,
      results: [
        {
          nameLocal: 'Fergburger',
          nameEn: '',
          lat: -45.0317416,
          lng: 168.6594621,
          address: '42 Shotover Street, Boydtown, Queenstown, Otago, 9200, New Zealand',
          category: 'food',
          source: 'photon',
          externalId: 'osm:N336415647',
        },
      ],
    })
    const url = new URL(h.calls[0].url)
    expect(url.searchParams.get('lang')).toBe('default')
    expect(url.searchParams.get('lat')).toBe('-45.03')
    expect(url.searchParams.get('lon')).toBe('168.66')
    expect(url.searchParams.get('limit')).toBe('8')
    expect(new Headers(h.calls[0].init?.headers).get('user-agent')).toMatch(/^Tripfolio\//)
    expect(usage()).toEqual([{ provider: 'photon', tripId: trip.tripId, count: 1 }])
  })

  it('fills nameEn when searching in English', async () => {
    h.on('photon.komoot.io', () => jsonResponse(photonFergburger))
    const res = await search('Fergburger', '&lang=en')
    expect(res.body.results[0]).toMatchObject({ nameLocal: 'Fergburger', nameEn: 'Fergburger' })
  })

  it('falls back to Nominatim when Photon fails, with UA, Referer and language', async () => {
    h.on('photon.komoot.io', () => new Response('down', { status: 503 }))
    h.on('nominatim.openstreetmap.org', () => jsonResponse(nominatimFergburger))
    const res = await search('Fergburger', '&lang=zh-TW&lat=-45&lng=168.6')
    expect(res.status).toBe(200)
    expect(res.body.source).toBe('nominatim')
    expect(res.body.results[0]).toEqual({
      nameLocal: 'Fergburger',
      nameEn: 'Fergburger',
      lat: -45.0317416,
      lng: 168.6594621,
      address: '42, Shotover Street, Queenstown, Otago, 9300, New Zealand',
      category: 'food',
      source: 'nominatim',
      externalId: 'osm:N336415647',
    })
    const call = h.calls[1]
    const url = new URL(call.url)
    expect(url.searchParams.get('format')).toBe('jsonv2')
    expect(url.searchParams.get('accept-language')).toBe('zh-tw')
    expect(url.searchParams.get('viewbox')).toBe('168.1,-44.5,169.1,-45.5')
    const headers = new Headers(call.init?.headers)
    expect(headers.get('user-agent')).toContain('Tripfolio')
    expect(headers.get('referer')).toBe('https://trip.test/')
    expect(usage()).toEqual([
      { provider: 'nominatim', tripId: trip.tripId, count: 1 },
      { provider: 'photon', tripId: trip.tripId, count: 1 },
    ])
  })

  it('also falls back when Photon finds nothing', async () => {
    h.on('photon.komoot.io', () => jsonResponse({ type: 'FeatureCollection', features: [] }))
    h.on('nominatim.openstreetmap.org', () => jsonResponse(nominatimFergburger))
    const res = await search('Fergburger')
    expect(res.body.source).toBe('nominatim')
    expect(res.body.results).toHaveLength(1)
  })

  it('keeps Nominatim to one request per second across requests', async () => {
    h.on('photon.komoot.io', () => new Response('down', { status: 503 }))
    h.on('nominatim.openstreetmap.org', () => jsonResponse(nominatimFergburger))
    const start = h.clock.now
    await search('first')
    await search('second')
    // The second Nominatim call waited for its slot
    expect(h.clock.now - start).toBeGreaterThanOrEqual(1000)
    expect(h.calls.filter((c) => c.url.includes('nominatim'))).toHaveLength(2)
  })

  it('answers the second identical search from geoCache without fetching', async () => {
    h.on('photon.komoot.io', () => jsonResponse(photonFergburger))
    await search('Fergburger Queenstown', '&lat=-45.031&lng=168.661')
    const again = await search('  fergburger   QUEENSTOWN ', '&lat=-45.04&lng=168.66')
    expect(again.body.cached).toBe(true)
    expect(again.body.results).toHaveLength(1)
    expect(h.calls).toHaveLength(1)
    expect(usage()).toEqual([{ provider: 'photon', tripId: trip.tripId, count: 1 }])
    // Seven days later the entry has expired
    h.clock.now += 7 * 24 * 3600 * 1000 + 1
    const later = await search('Fergburger Queenstown', '&lat=-45.031&lng=168.661')
    expect(later.body.cached).toBe(false)
    expect(h.calls).toHaveLength(2)
  })

  it('is 502 when every provider fails', async () => {
    h.on('photon.komoot.io', () => new Response('down', { status: 500 }))
    h.on('nominatim.openstreetmap.org', () => new Response('down', { status: 500 }))
    const res = await search('anything')
    expect(res.status).toBe(502)
    expect(res.body).toMatchObject({ error: { code: 'geo_unavailable' } })
  })

  it('limits each member to 30 requests a minute with a 429 and Retry-After', async () => {
    h.on('photon.komoot.io', () => jsonResponse(photonFergburger))
    for (let i = 0; i < 30; i++) expect((await search('Fergburger')).status).toBe(200)
    const limited = await search('Fergburger')
    expect(limited.status).toBe(429)
    expect(limited.body).toEqual({
      error: {
        code: 'rate_limited',
        message: 'at most 30 requests per minute',
        details: { retryAfterS: 60 },
      },
    })
    expect(limited.headers.get('retry-after')).toBe('60')
    // Another member is not affected; the next minute starts afresh
    expect((await search('Fergburger', '', trip.owner)).status).toBe(200)
    h.clock.now += 60_000
    expect((await search('Fergburger')).status).toBe(200)
  })

  it('requires a member token and a query', async () => {
    const anon = await h.call('GET', `/api/trips/${trip.tripId}/geo/search?q=x`)
    expect(anon.status).toBe(401)
    const empty = await search('   ')
    expect(empty.status).toBe(422)
    const halfBias = await search('x', '&lat=1')
    expect(halfBias.status).toBe(422)
  })
})

describe('categories', () => {
  it('maps OSM tags', () => {
    expect(categoryFor('amenity', 'restaurant')).toBe('food')
    expect(categoryFor('tourism', 'camp_site')).toBe('lodging')
    expect(categoryFor('tourism', 'viewpoint')).toBe('sight')
    expect(categoryFor('shop', 'supermarket')).toBe('supplies')
    expect(categoryFor('shop', 'clothes')).toBe('shopping')
    expect(categoryFor('amenity', 'fuel')).toBe('fuel')
    expect(categoryFor('natural', 'peak')).toBe('nature')
    expect(categoryFor('boundary', 'national_park')).toBe('nature')
    expect(categoryFor('boundary', 'administrative')).toBe('other')
    expect(categoryFor('aeroway', 'aerodrome')).toBe('transport')
    expect(categoryFor('place', 'city')).toBe('other')
  })
})

describe('location parsing', () => {
  it('parses plain coordinates', () => {
    expect(parseCoordinates('-45.0317, 168.6595')).toEqual({ lat: -45.0317, lng: 168.6595 })
    expect(parseCoordinates('(-45.0317 168.6595)')).toEqual({ lat: -45.0317, lng: 168.6595 })
    expect(parseCoordinates('25.03，121.56')).toEqual({ lat: 25.03, lng: 121.56 })
    expect(parseCoordinates('95, 10')).toBeNull()
    expect(parseCoordinates('Fergburger')).toBeNull()
  })

  it('parses the Google Maps URL forms', () => {
    const pin = parseMapsUrl(
      new URL(
        'https://www.google.com/maps/place/Fergburger/@-45.0316,168.6580,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-45.0317416!4d168.6594621',
      ),
    )
    expect(pin).toEqual({ lat: -45.0317416, lng: 168.6594621, name: 'Fergburger' })
    const at = parseMapsUrl(new URL('https://www.google.com/maps/@-45.0316,168.658,15z'))
    expect(at).toEqual({ lat: -45.0316, lng: 168.658 })
    const q = parseMapsUrl(new URL('https://maps.google.com/?q=-45.0317,168.6595'))
    expect(q).toEqual({ lat: -45.0317, lng: 168.6595 })
    const named = parseMapsUrl(
      new URL('https://www.google.com/maps/place/Lake+Tekapo/@-43.98,170.46,12z'),
    )
    expect(named).toEqual({ lat: -43.98, lng: 170.46, name: 'Lake Tekapo' })
    expect(parseMapsUrl(new URL('https://www.google.com/maps/search/fergburger'))).toBeNull()
  })

  it('POST /geo/parse handles coordinates, long URLs and text around them', async () => {
    const path = `/api/trips/${trip.tripId}/geo/parse`
    const coords = await h.call<GeoParseResponse>('POST', path, {
      token: trip.member,
      body: { text: '-45.0317, 168.6595' },
    })
    expect(coords.body).toEqual({ lat: -45.0317, lng: 168.6595, source: 'coords' })
    const url = await h.call<GeoParseResponse>('POST', path, {
      token: trip.member,
      body: { text: 'Lunch here https://www.google.com/maps?q=-45.0317,168.6595 ok?' },
    })
    expect(url.body).toEqual({ lat: -45.0317, lng: 168.6595, source: 'link' })
    expect(h.calls).toHaveLength(0)
  })

  it('follows maps.app.goo.gl redirects server-side (at most 2 hops, Google hosts only)', async () => {
    h.on(
      'maps.app.goo.gl/abc',
      () =>
        new Response(null, {
          status: 302,
          headers: {
            location: 'https://www.google.com/maps/place/Fergburger/data=!4m2!3m1!1s0x0?entry=tts',
          },
        }),
    )
    h.on(
      'www.google.com/maps/place/Fergburger',
      () =>
        new Response(null, {
          status: 301,
          headers: {
            location:
              'https://www.google.com/maps/place/Fergburger/@-45.03,168.65,17z/data=!3d-45.0317416!4d168.6594621',
          },
        }),
    )
    const path = `/api/trips/${trip.tripId}/geo/parse`
    const res = await h.call<GeoParseResponse>('POST', path, {
      token: trip.member,
      body: { text: 'https://maps.app.goo.gl/abc' },
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      lat: -45.0317416,
      lng: 168.6594621,
      name: 'Fergburger',
      source: 'link',
    })
    expect(h.calls).toHaveLength(2)
    expect(h.calls[0].init?.redirect).toBe('manual')

    // A redirect off Google is not followed
    h.on(
      'maps.app.goo.gl/evil',
      () => new Response(null, { status: 302, headers: { location: 'https://evil.test/x' } }),
    )
    const evil = await h.call('POST', path, {
      token: trip.member,
      body: { text: 'https://maps.app.goo.gl/evil' },
    })
    expect(evil.status).toBe(422)
    expect(evil.body).toMatchObject({ error: { code: 'no_coordinates' } })
    expect(h.calls).toHaveLength(3)
  })

  it('is 422 when there are no coordinates', async () => {
    const res = await h.call('POST', `/api/trips/${trip.tripId}/geo/parse`, {
      token: trip.member,
      body: { text: 'somewhere nice' },
    })
    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({ error: { code: 'no_coordinates' } })
  })
})
