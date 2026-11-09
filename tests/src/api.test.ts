import { afterEach, describe, expect, it } from 'vitest'
import { api, ApiError, request, setFetch } from '../../src/lib/api.ts'
import { clearTokens, getToken, setToken } from '../../src/lib/tokens.ts'

interface Call {
  url: string
  init: RequestInit
}

function fake(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(body === undefined ? '' : JSON.stringify(body), { status })
  }) as typeof fetch
}

const header = (call: Call, name: string) => new Headers(call.init.headers).get(name)

afterEach(() => {
  setFetch(null)
  clearTokens()
})

describe('request', () => {
  it('maps the error shape to ApiError', async () => {
    setFetch(fake(403, { error: { code: 'trip_archived', message: 'the trip is archived' } }))
    const error = await request('PATCH', '/api/trips/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 403,
      code: 'trip_archived',
      message: 'the trip is archived',
    })
  })

  it('keeps zod details of a 422', async () => {
    setFetch(
      fake(422, { error: { code: 'invalid', message: 'bad', details: [{ path: ['name'] }] } }),
    )
    await expect(request('POST', '/api/trips', { body: {} })).rejects.toMatchObject({
      details: [{ path: ['name'] }],
    })
  })

  it('reports a dead network and a non-JSON failure', async () => {
    setFetch((async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch)
    await expect(request('GET', '/api/trips')).rejects.toMatchObject({ status: 0, code: 'network' })
    setFetch((async () => new Response('<html>', { status: 502 })) as typeof fetch)
    await expect(request('GET', '/api/trips')).rejects.toMatchObject({
      status: 502,
      code: 'http_error',
    })
  })
})

describe('api', () => {
  it('stores the memberToken from createTrip and sends it as a Bearer token afterwards', async () => {
    const calls: Call[] = []
    setFetch(
      fake(
        201,
        { trip: { id: 'trip1' }, member: {}, memberToken: 'secret', rev: 1, days: [] },
        calls,
      ),
    )
    await api.createTrip({
      name: 'NZ',
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      tz: 'Pacific/Auckland',
      owner: { name: 'Gene', color: '#0F6E74' },
    })
    expect(getToken('trip1')).toBe('secret')
    expect(header(calls[0], 'content-type')).toBe('application/json')
    expect(header(calls[0], 'authorization')).toBeNull()

    setFetch(fake(200, { trip: {}, me: {}, members: [], rev: 1 }, calls))
    await api.getTrip('trip1')
    expect(calls[1].url).toBe('/api/trips/trip1')
    expect(header(calls[1], 'authorization')).toBe('Bearer secret')
  })

  it('fails without a token instead of calling the server', async () => {
    const calls: Call[] = []
    setFetch(fake(200, {}, calls))
    await expect(api.getTrip('nope')).rejects.toMatchObject({ status: 401, code: 'unauthorized' })
    expect(calls).toHaveLength(0)
  })

  it('lists with X-Member-Tokens and prunes the tokens left out', async () => {
    setToken('a', 'ka')
    setToken('b', 'kb')
    const calls: Call[] = []
    // Sent newest first: kb (index 0), ka (index 1); only ka still works
    setFetch(fake(200, { trips: [{ tokenIndex: 1, trip: { id: 'a' }, member: {} }] }, calls))
    const response = await api.listTrips()
    expect(header(calls[0], 'x-member-tokens')).toBe('kb,ka')
    expect(response.trips).toHaveLength(1)
    expect(getToken('a')).toBe('ka')
    expect(getToken('b')).toBeNull()
  })

  it('skips the list call when the device has no tokens', async () => {
    const calls: Call[] = []
    setFetch(fake(200, {}, calls))
    expect(await api.listTrips()).toEqual({ trips: [] })
    expect(calls).toHaveLength(0)
  })

  it('stores the token from joining', async () => {
    const calls: Call[] = []
    setFetch(
      fake(
        201,
        { trip: { id: 'trip9' }, member: { name: 'Mia' }, memberToken: 'joined', rev: 2 },
        calls,
      ),
    )
    await api.join('invite token', { memberId: 'm1' })
    expect(calls[0].url).toBe('/api/join/invite%20token')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ memberId: 'm1' })
    expect(getToken('trip9')).toBe('joined')
  })
})
