import { afterEach, describe, expect, it } from 'vitest'
import type { AuthTripsResponse } from '../../../shared/api/auth.ts'
import type { Member, Trip } from '../../../shared/api/types.ts'
import { setFetch } from '../../../src/lib/api.ts'
import { mergedTokens } from '../../../src/lib/auth/api.ts'
import { loadAuth, resetAuth, signOut, syncAuthTrips } from '../../../src/lib/auth/auth.ts'
import { clearTokens, getTokens, setToken } from '../../../src/lib/tokens.ts'

// e1-t06 frontend: /api/auth/me states and merging the tokens POST /api/auth/trips mints.

const entry = (tripId: string, memberToken: string | null) =>
  ({
    trip: { id: tripId } as Trip,
    member: { id: `m-${tripId}`, tripId } as Member,
    memberToken,
  }) satisfies AuthTripsResponse['trips'][number]

const user = { id: 'u1', email: 'gene@example.com', name: 'Gene', picture: null }

interface Call {
  method: string
  path: string
  headers: Record<string, string>
}

function mockFetch(routes: Record<string, () => Response>): Call[] {
  const calls: Call[] = []
  setFetch(async (input, init) => {
    const path = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, path, headers: (init?.headers ?? {}) as Record<string, string> })
    const route = routes[`${method} ${path}`]
    if (!route) throw new Error(`unexpected ${method} ${path}`)
    return route()
  })
  return calls
}

const error = (status: number, code: string) =>
  Response.json({ error: { code, message: code } }, { status })

afterEach(() => {
  setFetch(null)
  resetAuth()
  clearTokens()
})

describe('mergedTokens', () => {
  it('stores minted tokens and keeps everything else', () => {
    const merged = mergedTokens({ a: 'tokA', b: 'stale' }, {
      trips: [entry('a', null), entry('b', 'freshB'), entry('c', 'newC')],
    })
    expect(merged).toEqual({ a: 'tokA', b: 'freshB', c: 'newC' })
  })

  it('is a no-op for an empty answer', () => {
    expect(mergedTokens({ a: 'tokA' }, { trips: [] })).toEqual({ a: 'tokA' })
  })
})

describe('loadAuth', () => {
  it('is signed in on 200, once per page load', async () => {
    const calls = mockFetch({ 'GET /api/auth/me': () => Response.json({ user }) })
    expect(await loadAuth()).toEqual({ status: 'signedIn', user })
    await loadAuth()
    expect(calls).toHaveLength(1)
  })

  it('is signed out on 401 and disabled on 503 or network errors', async () => {
    mockFetch({ 'GET /api/auth/me': () => error(401, 'unauthorized') })
    expect((await loadAuth()).status).toBe('signedOut')
    resetAuth()
    mockFetch({ 'GET /api/auth/me': () => error(503, 'auth_disabled') })
    expect((await loadAuth()).status).toBe('disabled')
    resetAuth()
    setFetch(async () => {
      throw new TypeError('offline')
    })
    expect((await loadAuth()).status).toBe('disabled')
  })

  it('signs out', async () => {
    mockFetch({
      'GET /api/auth/me': () => Response.json({ user }),
      'POST /api/auth/logout': () => Response.json({ ok: true }),
    })
    await loadAuth()
    await signOut()
    expect((await loadAuth()).status).toBe('signedOut')
  })
})

describe('syncAuthTrips', () => {
  it('sends the device tokens and stores the minted ones before listing', async () => {
    setToken('a', 'A'.repeat(22))
    const calls = mockFetch({
      'GET /api/auth/me': () => Response.json({ user }),
      'POST /api/auth/trips': () =>
        Response.json({ trips: [entry('a', null), entry('b', 'B'.repeat(22))] }),
    })
    await syncAuthTrips()
    expect(calls[1].headers['x-member-tokens']).toBe('A'.repeat(22))
    expect(getTokens()).toEqual({ a: 'A'.repeat(22), b: 'B'.repeat(22) })
    await syncAuthTrips() // once per page load
    expect(calls).toHaveLength(2)
  })

  it('does nothing signed out, and never throws', async () => {
    const calls = mockFetch({ 'GET /api/auth/me': () => error(401, 'unauthorized') })
    await syncAuthTrips()
    expect(calls.map((c) => c.path)).toEqual(['/api/auth/me'])
    resetAuth()
    mockFetch({
      'GET /api/auth/me': () => Response.json({ user }),
      'POST /api/auth/trips': () => error(429, 'rate_limited'),
    })
    await expect(syncAuthTrips()).resolves.toBeUndefined()
    expect(getTokens()).toEqual({})
  })
})
