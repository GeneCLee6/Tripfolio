import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthTripsResponse, MemberLinkResponse } from '../../shared/api/auth.ts'
import {
  authDeps,
  GOOGLE_JWKS_URL,
  GOOGLE_TOKEN_URL,
  resetJwksCache,
  STATE_COOKIE,
} from '../../worker/auth-google.ts'
import { bytesToBase64Url, hashToken, SESSION_COOKIE, sessionDeps } from '../../worker/auth.ts'
import { createHarness, restoreClock, setupTrip, type Harness } from './security/helpers.ts'

// e1-t06 optional Google sign-in: OAuth start/callback with PKCE and a signed state cookie, id_token
// checks against a mocked Google (token endpoint + JWKS), sessions, member links and token minting.

const CLIENT_ID = 'client-123.apps.googleusercontent.com'
const ORIGIN = 'https://tripfolio.example'
const enc = new TextEncoder()
const b64json = (v: unknown) => bytesToBase64Url(enc.encode(JSON.stringify(v)))

let keys: CryptoKeyPair
let jwk: JsonWebKey
beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  jwk = (await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey
})

async function idToken(claims: Record<string, unknown>, kid = 'k1'): Promise<string> {
  const head = b64json({ alg: 'RS256', kid, typ: 'JWT' })
  const body = b64json(claims)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, enc.encode(`${head}.${body}`))
  return `${head}.${body}.${bytesToBase64Url(new Uint8Array(sig))}`
}

let h: Harness
const realFetch = authDeps.fetch
const realNow = sessionDeps.now
let google: { idToken: string; tokenStatus: number; tokenBodies: URLSearchParams[]; jwksCalls: number }

beforeEach(() => {
  h = createHarness()
  Object.assign(h.env, {
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'shh-secret',
    APP_ORIGIN: ORIGIN,
  })
  sessionDeps.now = () => h.clock.now
  resetJwksCache()
  google = { idToken: '', tokenStatus: 200, tokenBodies: [], jwksCalls: 0 }
  authDeps.fetch = async (url, init) => {
    if (url === GOOGLE_JWKS_URL) {
      google.jwksCalls++
      return Response.json(
        { keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] },
        { headers: { 'cache-control': 'public, max-age=3600' } },
      )
    }
    if (url === GOOGLE_TOKEN_URL) {
      google.tokenBodies.push(new URLSearchParams(String(init?.body)))
      if (google.tokenStatus !== 200) return Response.json({ error: 'invalid_grant' }, { status: google.tokenStatus })
      return Response.json({ id_token: google.idToken, access_token: 'x' })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  authDeps.fetch = realFetch
  sessionDeps.now = realNow
  restoreClock()
  vi.restoreAllMocks()
})

const nowS = () => Math.floor(h.clock.now / 1000)
const goodClaims = (nonce: string, extra: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT_ID,
  sub: 'google-sub-1',
  email: 'gene@example.com',
  name: 'Gene',
  picture: 'https://lh3.googleusercontent.com/a/x',
  iat: nowS(),
  exp: nowS() + 3600,
  nonce,
  ...extra,
})

function cookieFrom(response: Response, name: string): string | null {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';')
    if (pair.startsWith(`${name}=`)) return pair.slice(name.length + 1)
  }
  return null
}
const setCookieLine = (response: Response, name: string) =>
  response.headers.getSetCookie().find((l) => l.startsWith(`${name}=`)) ?? ''

async function start() {
  const response = await h.raw('GET', '/api/auth/google/start')
  expect(response.status).toBe(302)
  const location = new URL(response.headers.get('location')!)
  const stateCookie = cookieFrom(response, STATE_COOKIE)!
  const payload = JSON.parse(
    Buffer.from(stateCookie.split('.')[0], 'base64url').toString('utf8'),
  ) as { state: string; nonce: string; verifier: string }
  return { response, location, stateCookie, payload }
}

/** A full sign-in; returns the tf_session cookie value */
async function signIn(claims?: (nonce: string) => Record<string, unknown>): Promise<Response> {
  const s = await start()
  google.idToken = await idToken(claims ? claims(s.payload.nonce) : goodClaims(s.payload.nonce))
  return h.raw('GET', `/api/auth/google/callback?code=abc&state=${s.payload.state}`, {
    headers: { cookie: `${STATE_COOKIE}=${s.stateCookie}` },
  })
}

async function session(): Promise<string> {
  const response = await signIn()
  expect(response.headers.get('location')).toBe(`${ORIGIN}/`)
  return cookieFrom(response, SESSION_COOKIE)!
}

const withSession = (cookie: string) => ({ headers: { cookie: `${SESSION_COOKIE}=${cookie}` } })

describe('unconfigured', () => {
  it('answers 503 auth_disabled without GOOGLE_CLIENT_ID (and without the secret)', async () => {
    h.env.GOOGLE_CLIENT_ID = ''
    for (const path of ['/api/auth/google/start', '/api/auth/me', '/api/auth/google/callback']) {
      const r = await h.call('GET', path)
      expect(r.status).toBe(503)
      expect(r.body).toMatchObject({ error: { code: 'auth_disabled' } })
    }
    h.env.GOOGLE_CLIENT_ID = CLIENT_ID
    h.env.GOOGLE_CLIENT_SECRET = undefined
    expect((await h.call('GET', '/api/auth/google/start')).status).toBe(503)
  })
})

describe('start', () => {
  it('redirects to Google with PKCE, nonce and state, and sets a signed state cookie', async () => {
    const { response, location, payload } = await start()
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const q = location.searchParams
    expect(q.get('client_id')).toBe(CLIENT_ID)
    expect(q.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/google/callback`)
    expect(q.get('scope')).toBe('openid email profile')
    expect(q.get('response_type')).toBe('code')
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('state')).toBe(payload.state)
    expect(q.get('nonce')).toBe(payload.nonce)
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(payload.verifier))
    expect(q.get('code_challenge')).toBe(bytesToBase64Url(new Uint8Array(digest)))
    const line = setCookieLine(response, STATE_COOKIE)
    expect(line).toMatch(/HttpOnly/)
    expect(line).toMatch(/Secure/)
    expect(line).toMatch(/SameSite=Lax/)
    expect(line).toMatch(/Max-Age=600/)
    expect(line).toMatch(/Path=\/api\/auth\/google/)
  })

  it('builds redirect_uri from APP_ORIGIN, not from the request host', async () => {
    const response = await h.raw('GET', '/api/auth/google/start', {
      headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' },
    })
    const location = new URL(response.headers.get('location')!)
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/google/callback`)
  })
})

describe('callback', () => {
  it('exchanges the code with the verifier, creates the user and a session cookie', async () => {
    const response = await signIn()
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`${ORIGIN}/`)
    const body = google.tokenBodies[0]
    expect(body.get('code')).toBe('abc')
    expect(body.get('client_secret')).toBe('shh-secret')
    expect(body.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/google/callback`)
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const line = setCookieLine(response, SESSION_COOKIE)
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/;', `Max-Age=${30 * 86400}`])
      expect(line).toContain(flag)
    expect(setCookieLine(response, STATE_COOKIE)).toContain('Max-Age=0')
    const cookie = cookieFrom(response, SESSION_COOKIE)!
    const users = h.sqlite.prepare('SELECT * FROM users').all()
    expect(users).toHaveLength(1)
    expect(users[0]).toMatchObject({ googleSub: 'google-sub-1', email: 'gene@example.com' })
    const sessions = h.sqlite.prepare('SELECT * FROM sessions').all()
    expect(sessions).toHaveLength(1)
    // Only the hash is stored
    expect(sessions[0].id).toBe(await hashToken(cookie))
    expect(JSON.stringify(sessions)).not.toContain(cookie)
  })

  it('reuses the user on a second sign-in and refreshes the profile', async () => {
    await signIn()
    await signIn((nonce) => goodClaims(nonce, { name: 'Gene L' }))
    const users = h.sqlite.prepare('SELECT * FROM users').all()
    expect(users).toHaveLength(1)
    expect(users[0].name).toBe('Gene L')
    expect(h.sqlite.prepare('SELECT * FROM sessions').all()).toHaveLength(2)
  })

  const rejects: [string, (nonce: string) => Record<string, unknown>][] = [
    ['a wrong audience', (n) => goodClaims(n, { aud: 'someone-else' })],
    ['an expired token', (n) => goodClaims(n, { exp: nowS() - 3600 })],
    ['a wrong nonce', (n) => goodClaims(`${n}x`)],
    ['a wrong issuer', (n) => goodClaims(n, { iss: 'https://evil.example' })],
  ]
  for (const [what, claims] of rejects) {
    it(`rejects ${what}`, async () => {
      const response = await signIn(claims)
      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe(`${ORIGIN}/?signin=failed`)
      expect(cookieFrom(response, SESSION_COOKIE)).toBeNull()
      expect(h.sqlite.prepare('SELECT * FROM users').all()).toHaveLength(0)
    })
  }

  it('rejects a token signed by another key', async () => {
    const s = await start()
    const other = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair
    const head = b64json({ alg: 'RS256', kid: 'k1' })
    const body = b64json(goodClaims(s.payload.nonce))
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', other.privateKey, enc.encode(`${head}.${body}`))
    google.idToken = `${head}.${body}.${bytesToBase64Url(new Uint8Array(sig))}`
    const response = await h.raw('GET', `/api/auth/google/callback?code=abc&state=${s.payload.state}`, {
      headers: { cookie: `${STATE_COOKIE}=${s.stateCookie}` },
    })
    expect(response.headers.get('location')).toBe(`${ORIGIN}/?signin=failed`)
  })

  it('rejects a missing, tampered or mismatched state without calling Google', async () => {
    const s = await start()
    const cases = [
      { query: `code=abc&state=${s.payload.state}`, cookie: '' },
      { query: `code=abc&state=wrong`, cookie: `${STATE_COOKIE}=${s.stateCookie}` },
      { query: `code=abc&state=${s.payload.state}`, cookie: `${STATE_COOKIE}=${s.stateCookie}x` },
    ]
    for (const c of cases) {
      const response = await h.raw('GET', `/api/auth/google/callback?${c.query}`, {
        headers: c.cookie ? { cookie: c.cookie } : {},
      })
      expect(response.headers.get('location')).toBe(`${ORIGIN}/?signin=failed`)
    }
    expect(google.tokenBodies).toHaveLength(0)
  })

  it('rejects an expired state cookie and a failed code exchange', async () => {
    const s = await start()
    h.clock.now += 11 * 60_000
    const late = await h.raw('GET', `/api/auth/google/callback?code=abc&state=${s.payload.state}`, {
      headers: { cookie: `${STATE_COOKIE}=${s.stateCookie}` },
    })
    expect(late.headers.get('location')).toBe(`${ORIGIN}/?signin=failed`)
    google.tokenStatus = 400
    const failed = await signIn()
    expect(failed.headers.get('location')).toBe(`${ORIGIN}/?signin=failed`)
  })

  it('caches the JWKS between sign-ins', async () => {
    await signIn()
    await signIn()
    expect(google.jwksCalls).toBe(1)
  })
})

describe('me and logout', () => {
  it('answers the user for a session, 401 without one', async () => {
    expect((await h.call('GET', '/api/auth/me')).status).toBe(401)
    const cookie = await session()
    const me = await h.raw('GET', '/api/auth/me', withSession(cookie))
    expect(me.status).toBe(200)
    expect(me.headers.get('cache-control')).toBe('no-store')
    const body = (await me.json()) as { user: Record<string, unknown> }
    expect(body.user).toMatchObject({ email: 'gene@example.com', name: 'Gene' })
    expect(body.user).not.toHaveProperty('googleSub')
  })

  it('expires after 30 days and slides when used', async () => {
    const cookie = await session()
    h.clock.now += 20 * 86_400_000
    const slid = await h.raw('GET', '/api/auth/me', withSession(cookie))
    expect(slid.status).toBe(200)
    expect(setCookieLine(slid, SESSION_COOKIE)).toContain('HttpOnly')
    h.clock.now += 20 * 86_400_000 // 40 days after sign-in, 20 after the slide
    expect((await h.raw('GET', '/api/auth/me', withSession(cookie))).status).toBe(200)
    h.clock.now += 31 * 86_400_000
    expect((await h.raw('GET', '/api/auth/me', withSession(cookie))).status).toBe(401)
  })

  it('logout deletes the session and clears the cookie', async () => {
    const cookie = await session()
    const out = await h.raw('POST', '/api/auth/logout', withSession(cookie))
    expect(out.status).toBe(200)
    expect(setCookieLine(out, SESSION_COOKIE)).toContain('Max-Age=0')
    expect(h.sqlite.prepare('SELECT * FROM sessions').all()).toHaveLength(0)
    expect((await h.raw('GET', '/api/auth/me', withSession(cookie))).status).toBe(401)
  })
})

describe('member links and my trips', () => {
  async function callJson<T>(method: string, path: string, opts: { token?: string; cookie?: string; tokens?: string[] }) {
    const headers: Record<string, string> = {}
    if (opts.cookie) headers.cookie = `${SESSION_COOKIE}=${opts.cookie}`
    if (opts.tokens) headers['x-member-tokens'] = opts.tokens.join(',')
    const r = await h.raw(method, path, { token: opts.token, headers })
    return { status: r.status, body: (await r.json()) as T }
  }

  it('links and unlinks the caller’s member; needs both the token and the session', async () => {
    const s = await setupTrip(h)
    const cookie = await session()
    const link = `${s.base}/members/me/link`
    expect((await callJson('POST', link, { token: s.editor })).status).toBe(401)
    expect((await callJson('POST', link, { cookie })).status).toBe(401)
    expect((await callJson<MemberLinkResponse>('GET', link, { token: s.editor, cookie })).body).toEqual({
      linked: false,
      linkedToOther: false,
    })
    expect((await callJson('POST', link, { token: s.editor, cookie })).status).toBe(200)
    expect((await callJson<MemberLinkResponse>('GET', link, { token: s.editor, cookie })).body.linked).toBe(true)
    // Another member of the same trip sees that the account is linked elsewhere
    expect((await callJson<MemberLinkResponse>('GET', link, { token: s.viewer, cookie })).body).toEqual({
      linked: false,
      linkedToOther: true,
    })
    // Linking the other member replaces the first link (one member per trip per account)
    await callJson('POST', link, { token: s.viewer, cookie })
    expect(h.sqlite.prepare('SELECT * FROM userMembers').all()).toHaveLength(1)
    expect((await callJson<MemberLinkResponse>('GET', link, { token: s.editor, cookie })).body).toEqual({
      linked: false,
      linkedToOther: true,
    })
    await callJson('POST', link, { token: s.editor, cookie })
    const off = await callJson<MemberLinkResponse>('DELETE', link, { token: s.editor, cookie })
    expect(off.body.linked).toBe(false)
    expect(h.sqlite.prepare('SELECT * FROM userMembers').all()).toHaveLength(0)
  })

  it('mints fresh tokens only for linked members, and none when the device already holds one for the trip', async () => {
    const s = await setupTrip(h)
    const other = await setupTrip(h) // not linked
    const cookie = await session()
    await callJson('POST', `${s.base}/members/me/link`, { token: s.editor, cookie })

    expect((await callJson('POST', '/api/auth/trips', {})).status).toBe(401)
    const fresh = await callJson<AuthTripsResponse>('POST', '/api/auth/trips', { cookie })
    expect(fresh.status).toBe(200)
    expect(fresh.body.trips).toHaveLength(1)
    const entry = fresh.body.trips[0]
    expect(entry.trip.id).toBe(s.tripId)
    expect(entry.member.name).toBe('Amy')
    expect(entry.memberToken).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(entry.memberToken).not.toBe(s.editor)
    // The minted token acts as that member
    const read = await h.call<{ me: { name: string } }>('GET', s.base, { token: entry.memberToken! })
    expect(read.body.me.name).toBe('Amy')
    expect(JSON.stringify(fresh.body)).not.toContain(other.tripId)

    // Already holding a valid token for the member: nothing minted
    const before = h.sqlite.prepare('SELECT COUNT(*) AS n FROM memberTokens').all()[0].n
    const again = await callJson<AuthTripsResponse>('POST', '/api/auth/trips', {
      cookie,
      tokens: [entry.memberToken!],
    })
    expect(again.body.trips[0].memberToken).toBeNull()
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM memberTokens').all()[0].n).toBe(before)
    // A device that is someone else in that trip keeps its own identity: nothing minted either
    const kid = await callJson<AuthTripsResponse>('POST', '/api/auth/trips', { cookie, tokens: [s.viewer] })
    expect(kid.body.trips[0].memberToken).toBeNull()
  })

  it('leaves out removed members and deleted trips', async () => {
    const s = await setupTrip(h)
    const cookie = await session()
    await callJson('POST', `${s.base}/members/me/link`, { token: s.editor, cookie })
    await h.call('DELETE', s.base, { token: s.owner })
    const r = await callJson<AuthTripsResponse>('POST', '/api/auth/trips', { cookie })
    expect(r.body.trips).toEqual([])
  })

  it('rate-limits token minting to 10 per minute per account', async () => {
    const cookie = await session()
    for (let i = 0; i < 10; i++)
      expect((await callJson('POST', '/api/auth/trips', { cookie })).status).toBe(200)
    const limited = await h.raw('POST', '/api/auth/trips', withSession(cookie))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
  })
})
