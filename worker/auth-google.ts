// Optional Google sign-in (e1-t06, ARCHITECTURE.md §4.1, DEPLOY.md §13). Worker-side OAuth 2.0
// authorization code flow with PKCE:
//
//   GET  /api/auth/google/start     → 302 to Google; state + nonce + PKCE verifier in a signed,
//                                      10-minute HttpOnly cookie (tf_oauth, Path=/api/auth/google)
//   GET  /api/auth/google/callback  → checks state, exchanges the code, verifies the id_token
//                                      (Google JWKS: signature, iss, aud, exp, nonce), upserts the
//                                      user, creates a 30-day sliding session (tf_session), 302 /
//   GET  /api/auth/me               → { user } | 401 | 503 auth_disabled
//   POST /api/auth/logout           → deletes the session, clears the cookie
//   POST /api/auth/trips            → the trips whose members are linked to the account, each with
//                                      a fresh memberToken for this device (cross-device recovery)
//   GET/POST/DELETE /api/trips/:id/members/me/link → the caller's member ↔ the account
//
// A login never replaces memberTokens: every /api/trips/:id/* call still needs one. CSRF: the
// cookies are SameSite=Lax (no cross-site POST carries them) and the callback needs the state from
// the signed cookie. redirect_uri is always APP_ORIGIN + the callback path, never the request's
// host. Nothing sensitive (codes, tokens, emails) is logged. Expired sessions rows are left for
// the cleanup cron (worker/cleanup.ts, a later batch: DELETE FROM sessions WHERE expiresAt < now).

import type {
  AuthMeResponse,
  AuthTripEntry,
  AuthTripsResponse,
  MemberLinkResponse,
} from '../shared/api/auth.ts'
import { AUTH_DISABLED } from '../shared/api/auth.ts'
import { MAX_MEMBER_TOKENS, MEMBER_TOKENS_HEADER } from '../shared/api/types.ts'
import {
  authCookie,
  authTrip,
  bytesToBase64Url,
  clearSessionCookie,
  generateToken,
  hashToken,
  isTokenShaped,
  readCookie,
  requireSession,
  sessionCookie,
  sessionDeps,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  timingSafeEqual,
} from './auth.ts'
import { insertStatement, toMember, toTrip, type Row } from './db.ts'
import type { Env } from './env.ts'
import { ApiError, json, noStore, nowIso } from './http.ts'
import type { RouteContext } from './router.ts'
import { clientIp, enforceLimit, MINUTE, type WindowLimit } from './security/ratelimit.ts'

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

export const CALLBACK_PATH = '/api/auth/google/callback'
export const STATE_COOKIE = 'tf_oauth'
const STATE_COOKIE_PATH = '/api/auth/google'
const STATE_TTL_S = 600
/** Allowed clock difference with Google for exp / iat */
const CLOCK_SKEW_S = 60

export const AUTH_LIMITS = {
  /** /api/auth/google/start and /callback: per client IP */
  google: { limit: 30, windowS: MINUTE },
  /** POST /api/auth/trips (mints tokens): per account */
  trips: { limit: 10, windowS: MINUTE },
} as const satisfies Record<string, WindowLimit>

/** The transport to Google, swappable in tests */
export const authDeps = {
  fetch: (input: string, init?: RequestInit): Promise<Response> => fetch(input, init),
}

interface GoogleConfig {
  clientId: string
  clientSecret: string
  origin: string
}

/** null unless GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and a valid APP_ORIGIN are all set */
export function googleConfig(env: Env): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
  const rawOrigin = env.APP_ORIGIN?.trim()
  if (!clientId || !clientSecret || !rawOrigin) return null
  let origin: string
  try {
    origin = new URL(rawOrigin).origin
  } catch {
    return null
  }
  if (!origin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
    return null
  return { clientId, clientSecret, origin }
}

function requireConfig(env: Env): GoogleConfig {
  const config = googleConfig(env)
  if (!config) throw new ApiError(503, AUTH_DISABLED, 'Google sign-in is not configured')
  return config
}

// ---- small crypto helpers --------------------------------------------------------------------

const encoder = new TextEncoder()

function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

const base64UrlJson = (value: unknown) => bytesToBase64Url(encoder.encode(JSON.stringify(value)))

function parseBase64UrlJson(text: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(text)))
  } catch {
    return null
  }
}

const randomUrl = (bytes: number) =>
  bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`tripfolio-oauth-state:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data))),
  )
}

async function pkceChallenge(verifier: string): Promise<string> {
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))),
  )
}

// ---- the signed state cookie -----------------------------------------------------------------

interface OAuthState {
  state: string
  nonce: string
  verifier: string
  /** Epoch seconds */
  exp: number
}

export async function signState(secret: string, value: OAuthState): Promise<string> {
  const payload = base64UrlJson(value)
  return `${payload}.${await hmac(secret, payload)}`
}

export async function readState(secret: string, cookie: string | null): Promise<OAuthState | null> {
  if (!cookie) return null
  const [payload, signature, extra] = cookie.split('.')
  if (!payload || !signature || extra !== undefined) return null
  if (!timingSafeEqual(signature, await hmac(secret, payload))) return null
  const value = parseBase64UrlJson(payload) as Partial<OAuthState> | null
  if (
    !value ||
    typeof value.state !== 'string' ||
    typeof value.nonce !== 'string' ||
    typeof value.verifier !== 'string' ||
    typeof value.exp !== 'number'
  )
    return null
  if (value.exp * 1000 < sessionDeps.now()) return null
  return value as OAuthState
}

// ---- id_token verification (RS256, Google JWKS) ----------------------------------------------

let jwksCache: { keys: Map<string, CryptoKey>; expiresAt: number } | null = null

/** Test hook: forget the cached Google keys */
export function resetJwksCache(): void {
  jwksCache = null
}

async function loadJwks(): Promise<Map<string, CryptoKey>> {
  const response = await authDeps.fetch(GOOGLE_JWKS_URL)
  if (!response.ok) throw new Error(`jwks ${response.status}`)
  const body = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] }
  const keys = new Map<string, CryptoKey>()
  for (const jwk of body.keys ?? []) {
    if (!jwk.kid || jwk.kty !== 'RSA') continue
    keys.set(
      jwk.kid,
      await crypto.subtle.importKey(
        'jwk',
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    )
  }
  const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 3600)
  jwksCache = { keys, expiresAt: sessionDeps.now() + Math.min(maxAge, 86_400) * 1000 }
  return keys
}

/** The key for `kid`, refetching once when the cache is stale or does not know it (rotation) */
async function googleKey(kid: string): Promise<CryptoKey | null> {
  if (jwksCache && jwksCache.expiresAt > sessionDeps.now()) {
    const cached = jwksCache.keys.get(kid)
    if (cached) return cached
  }
  return (await loadJwks()).get(kid) ?? null
}

export interface GoogleClaims {
  sub: string
  email?: string
  name?: string
  picture?: string
}

/** Throws (with a short, non-sensitive reason) unless the id_token is valid for this client */
export async function verifyIdToken(
  idToken: string,
  clientId: string,
  nonce: string,
): Promise<GoogleClaims> {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('malformed')
  const header = parseBase64UrlJson(parts[0]) as { alg?: string; kid?: string } | null
  if (header?.alg !== 'RS256' || !header.kid) throw new Error('alg')
  const key = await googleKey(header.kid)
  if (!key) throw new Error('kid')
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(parts[2]),
    encoder.encode(`${parts[0]}.${parts[1]}`),
  )
  if (!valid) throw new Error('signature')
  const claims = parseBase64UrlJson(parts[1]) as Record<string, unknown> | null
  if (!claims) throw new Error('payload')
  const nowS = sessionDeps.now() / 1000
  if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.has(claims.iss)) throw new Error('iss')
  const aud = claims.aud
  if (aud !== clientId && !(Array.isArray(aud) && aud.includes(clientId))) throw new Error('aud')
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < nowS) throw new Error('exp')
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > nowS) throw new Error('iat')
  if (typeof claims.nonce !== 'string' || !timingSafeEqual(claims.nonce, nonce))
    throw new Error('nonce')
  if (typeof claims.sub !== 'string' || claims.sub === '') throw new Error('sub')
  const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v.slice(0, 500) : undefined)
  return {
    sub: claims.sub,
    email: text(claims.email),
    name: text(claims.name),
    picture: text(claims.picture),
  }
}

// ---- handlers --------------------------------------------------------------------------------

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, ...noStore })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(null, { status: 302, headers })
}

const clearStateCookie = () => authCookie(STATE_COOKIE, '', 0, STATE_COOKIE_PATH)

/** GET /api/auth/google/start */
export async function googleStart(c: RouteContext): Promise<Response> {
  const config = requireConfig(c.env)
  await enforceLimit(c.env.DB, `ip:auth-google:${clientIp(c.request)}`, AUTH_LIMITS.google)
  const state: OAuthState = {
    state: randomUrl(16),
    nonce: randomUrl(16),
    verifier: randomUrl(32),
    exp: Math.floor(sessionDeps.now() / 1000) + STATE_TTL_S,
  }
  const target = new URL(GOOGLE_AUTH_URL)
  target.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.origin + CALLBACK_PATH,
    response_type: 'code',
    scope: 'openid email profile',
    state: state.state,
    nonce: state.nonce,
    code_challenge: await pkceChallenge(state.verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString()
  const cookie = authCookie(
    STATE_COOKIE,
    await signState(config.clientSecret, state),
    STATE_TTL_S,
    STATE_COOKIE_PATH,
  )
  return redirect(target.toString(), [cookie])
}

class CallbackError extends Error {}

/** GET /api/auth/google/callback: always a redirect back to the app (`?signin=failed` on error) */
export async function googleCallback(c: RouteContext): Promise<Response> {
  const config = requireConfig(c.env)
  await enforceLimit(c.env.DB, `ip:auth-google:${clientIp(c.request)}`, AUTH_LIMITS.google)
  try {
    const params = c.url.searchParams
    if (params.get('error')) throw new CallbackError('denied')
    const saved = await readState(config.clientSecret, readCookie(c.request, STATE_COOKIE))
    const state = params.get('state') ?? ''
    if (!saved || !timingSafeEqual(state, saved.state)) throw new CallbackError('state')
    const code = params.get('code')
    if (!code) throw new CallbackError('code')

    const tokenResponse = await authDeps.fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.origin + CALLBACK_PATH,
        grant_type: 'authorization_code',
        code_verifier: saved.verifier,
      }).toString(),
    })
    if (!tokenResponse.ok) throw new CallbackError(`token_${tokenResponse.status}`)
    const tokens = (await tokenResponse.json()) as { id_token?: unknown }
    if (typeof tokens.id_token !== 'string') throw new CallbackError('no_id_token')
    let claims: GoogleClaims
    try {
      claims = await verifyIdToken(tokens.id_token, config.clientId, saved.nonce)
    } catch (error) {
      throw new CallbackError(`id_token_${error instanceof Error ? error.message : 'invalid'}`)
    }

    const db = c.env.DB
    const now = nowIso()
    const user = await db
      .prepare(
        `INSERT INTO users (id, googleSub, email, name, picture, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (googleSub) DO UPDATE SET email = excluded.email, name = excluded.name,
           picture = excluded.picture, updatedAt = excluded.updatedAt
         RETURNING id`,
      )
      .bind(
        crypto.randomUUID(),
        claims.sub,
        claims.email ?? null,
        claims.name ?? null,
        claims.picture ?? null,
        now,
        now,
      )
      .first<{ id: string }>()
    if (!user) throw new CallbackError('user')
    const session = generateToken()
    await insertStatement(db, 'sessions', {
      id: await hashToken(session),
      userId: user.id,
      createdAt: now,
      expiresAt: new Date(sessionDeps.now() + SESSION_TTL_MS).toISOString(),
    }).run()
    return redirect(`${config.origin}/`, [clearStateCookie(), sessionCookie(session)])
  } catch (error) {
    if (!(error instanceof CallbackError)) throw error
    // The reason only: never the code, tokens or claims
    console.warn(JSON.stringify({ event: 'auth_callback_failed', reason: error.message }))
    return redirect(`${config.origin}/?signin=failed`, [clearStateCookie()])
  }
}

/** GET /api/auth/me */
export async function authMe(c: RouteContext): Promise<Response> {
  requireConfig(c.env)
  const session = await requireSession(c.env.DB, c.request)
  const body: AuthMeResponse = { user: session.user }
  const response = json(body)
  if (session.slid) response.headers.append('set-cookie', sessionCookie(session.cookie))
  return response
}

/** POST /api/auth/logout: works signed out or unconfigured too (it only clears) */
export async function authLogout(c: RouteContext): Promise<Response> {
  const cookie = readCookie(c.request, SESSION_COOKIE)
  if (cookie && isTokenShaped(cookie))
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await hashToken(cookie)).run()
  const response = json({ ok: true })
  response.headers.append('set-cookie', clearSessionCookie())
  return response
}

/**
 * POST /api/auth/trips: the trips the account is linked to (not deleted, member not removed). For
 * each, a fresh memberToken is minted for this device — unless X-Member-Tokens already carries a
 * valid token for that trip (whoever the device is there), then `memberToken` is null and nothing
 * is written: the device's own choice of "who am I" wins, and repeat visits mint nothing.
 */
export async function authTrips(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const session = await requireSession(db, c.request)
  await enforceLimit(db, `user:auth-trips:${session.user.id}`, AUTH_LIMITS.trips)

  const held = new Set<string>() // trip ids the device already holds a valid token for
  const sent = (c.request.headers.get(MEMBER_TOKENS_HEADER) ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(isTokenShaped)
    .slice(0, MAX_MEMBER_TOKENS)
  if (sent.length > 0) {
    const hashes = await Promise.all(sent.map(hashToken))
    const { results } = await db
      .prepare(
        `SELECT tripId FROM memberTokens
          WHERE revokedAt IS NULL AND tokenHash IN (${hashes.map(() => '?').join(', ')})`,
      )
      .bind(...hashes)
      .all<Row>()
    for (const r of results) held.add(String(r.tripId))
  }

  const { results } = await db
    .prepare(
      `SELECT m.* FROM userMembers um
         JOIN members m ON m.id = um.memberId
         JOIN trips t ON t.id = m.tripId
        WHERE um.userId = ? AND m.removedAt IS NULL AND t.deletedAt IS NULL
        ORDER BY t.startDate DESC`,
    )
    .bind(session.user.id)
    .all<Row>()
  const members = results.map(toMember)
  const trips = new Map<string, ReturnType<typeof toTrip>>()
  if (members.length > 0) {
    const ids = members.map((m) => m.tripId)
    const tripRows = await db
      .prepare(`SELECT * FROM trips WHERE id IN (${ids.map(() => '?').join(', ')})`)
      .bind(...ids)
      .all<Row>()
    for (const row of tripRows.results) trips.set(String(row.id), toTrip(row))
  }

  const now = nowIso()
  const inserts: D1PreparedStatement[] = []
  const body: AuthTripsResponse = { trips: [] }
  for (const member of members) {
    const trip = trips.get(member.tripId)
    if (!trip) continue
    const entry: AuthTripEntry = { trip, member, memberToken: null }
    if (!held.has(trip.id)) {
      const token = generateToken()
      inserts.push(
        insertStatement(db, 'memberTokens', {
          tokenHash: await hashToken(token),
          tripId: trip.id,
          memberId: member.id,
          createdAt: now,
        }),
      )
      entry.memberToken = token
    }
    body.trips.push(entry)
  }
  if (inserts.length > 0) await db.batch(inserts)
  return json(body)
}

async function linkState(
  db: D1Database,
  userId: string,
  tripId: string,
  memberId: string,
): Promise<MemberLinkResponse> {
  const { results } = await db
    .prepare(
      `SELECT um.memberId AS memberId FROM userMembers um JOIN members m ON m.id = um.memberId
        WHERE um.userId = ? AND m.tripId = ?`,
    )
    .bind(userId, tripId)
    .all<Row>()
  const linked = results.some((r) => r.memberId === memberId)
  return { linked, linkedToOther: !linked && results.length > 0 }
}

/** GET /api/trips/:id/members/me/link (any member + session) */
export async function getMemberLink(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'viewer')
  const session = await requireSession(c.env.DB, c.request)
  return json(await linkState(c.env.DB, session.user.id, auth.trip.id, auth.member.id))
}

/** POST /api/trips/:id/members/me/link: binds the caller's member to the account (replacing
 * another member of the same trip). Archived trips too: it does not touch trip content */
export async function linkMember(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer', { allowArchived: true })
  const session = await requireSession(db, c.request)
  // One member per trip per account: drop the account's other link in this trip, then add this one
  await db.batch([
    db
      .prepare(
        `DELETE FROM userMembers WHERE userId = ?
            AND memberId IN (SELECT id FROM members WHERE tripId = ?)`,
      )
      .bind(session.user.id, auth.trip.id),
    db
      .prepare('INSERT INTO userMembers (userId, memberId, createdAt) VALUES (?, ?, ?)')
      .bind(session.user.id, auth.member.id, nowIso()),
  ])
  return json({ linked: true, linkedToOther: false } satisfies MemberLinkResponse)
}

/** DELETE /api/trips/:id/members/me/link: tokens minted earlier stay valid (revoke the member
 * for that) */
export async function unlinkMember(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer', { allowArchived: true })
  const session = await requireSession(db, c.request)
  await db
    .prepare('DELETE FROM userMembers WHERE userId = ? AND memberId = ?')
    .bind(session.user.id, auth.member.id)
    .run()
  return json(await linkState(db, session.user.id, auth.trip.id, auth.member.id))
}

