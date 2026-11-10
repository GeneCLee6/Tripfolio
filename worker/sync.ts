// Live sync glue on the Worker side (e2-t08a, ARCHITECTURE.md §4.2): the write handlers report
// what changed with notifyTrip, and GET /ws/trips/:id authenticates a member and hands the
// WebSocket upgrade to the trip's Durable Object (worker/trip-do.ts).

import {
  CloseCode,
  SYNC_SUBPROTOCOL,
  type SyncAction,
  type SyncEntity,
  type TripChange,
} from '../shared/protocol.ts'
import type { Role } from '../shared/schema/member.ts'
import { hashToken, isTokenShaped, timingSafeEqual } from './auth.ts'
import type { Row } from './db.ts'
import type { Env } from './env.ts'

/** Headers the Worker sets on the upgrade it forwards to TripDO; never taken from a browser */
export const MEMBER_HEADER = 'x-member-id'
export const ROLE_HEADER = 'x-role'
export const READ_ONLY_HEADER = 'x-read-only'

const WAIT_UNTIL = Symbol('waitUntil')

type EnvWithContext = Env & { [WAIT_UNTIL]?: (promise: Promise<unknown>) => void }

/**
 * The env a request's handlers see: the same bindings, plus the request's `waitUntil`, so that
 * notifyTrip can finish after the response without the router passing the context around.
 */
export function withExecutionContext(env: Env, ctx: ExecutionContext | undefined): Env {
  if (!ctx) return env
  const scoped = Object.create(env) as EnvWithContext
  scoped[WAIT_UNTIL] = (promise) => ctx.waitUntil(promise)
  return scoped
}

/** One change as a handler reports it */
export interface ChangeInput {
  rev: number
  entity: SyncEntity
  id: string
  action: SyncAction
  /** The member who wrote it */
  by?: string | null
}

/**
 * Tells the trip's Durable Object what a successful write changed, after the D1 write and the rev
 * bump. Never fails the write: errors are logged, and the promise always resolves. Runs under the
 * request's waitUntil when there is one (worker/app.ts), so handlers do not await it.
 */
export function notifyTrip(
  env: Env,
  tripId: string,
  change: ChangeInput | ChangeInput[],
): Promise<void> {
  if (!env.TRIP) return Promise.resolve()
  const changes: TripChange[] = (Array.isArray(change) ? change : [change]).map((c) => ({
    rev: c.rev,
    entity: c.entity,
    id: c.id,
    action: c.action,
    byMemberId: c.by ?? null,
  }))
  const done = (async () => {
    try {
      await env.TRIP.get(env.TRIP.idFromName(tripId)).notify(changes)
    } catch (error) {
      console.error(JSON.stringify({ event: 'notify_trip_failed', tripId, error: String(error) }))
    }
  })()
  ;(env as EnvWithContext)[WAIT_UNTIL]?.(done)
  return done
}

interface SocketAuth {
  memberId: string
  role: Role
  readOnly: boolean
}

/**
 * memberToken → the member of `tripId`, for a socket. Unlike authTrip, a soft-deleted trip still
 * resolves (read-only), so a member looking at a trip in the bin keeps a live view; 'gone' is a
 * trip that no longer exists at all.
 */
export async function resolveSocketMember(
  db: D1Database,
  tripId: string,
  token: string | null,
): Promise<SocketAuth | 'unauthorized' | 'gone'> {
  if (!token || !isTokenShaped(token)) return 'unauthorized'
  const tokenHash = await hashToken(token)
  const row = await db
    .prepare(
      `SELECT t.tokenHash AS tokenHash, m.id AS memberId, m.tripId AS tripId, m.role AS role
         FROM memberTokens t JOIN members m ON m.id = t.memberId
        WHERE t.tokenHash = ? AND t.revokedAt IS NULL AND m.removedAt IS NULL`,
    )
    .bind(tokenHash)
    .first<Row>()
  if (!row || !timingSafeEqual(String(row.tokenHash), tokenHash)) return 'unauthorized'
  // A token for another trip: the same answer as an unknown one (no probing other trip ids)
  if (row.tripId !== tripId) return 'unauthorized'
  const trip = await db
    .prepare('SELECT archivedAt, deletedAt FROM trips WHERE id = ?')
    .bind(tripId)
    .first<Row>()
  if (!trip) return 'gone'
  const role = row.role as Role
  const readOnly = role === 'viewer' || trip.archivedAt != null || trip.deletedAt != null
  return { memberId: String(row.memberId), role, readOnly }
}

/** The member token: `?token=` or the second subprotocol (`[SYNC_SUBPROTOCOL, token]`) */
export function socketToken(request: Request, url: URL): string | null {
  const query = url.searchParams.get('token')
  if (query) return query
  const offered = (request.headers.get('sec-websocket-protocol') ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (!offered.includes(SYNC_SUBPROTOCOL)) return null
  return offered.find((p) => p !== SYNC_SUBPROTOCOL) ?? null
}

/**
 * A refused upgrade: accepted and closed at once, so the browser sees the close code (an HTTP error
 * on an upgrade only shows up as a bare 1006). Swappable in tests, where there is no WebSocketPair.
 */
export const syncDeps = {
  refuse(request: Request, code: number, reason: string): Response {
    const { 0: client, 1: server } = new WebSocketPair()
    server.accept()
    server.close(code, reason)
    const offered = request.headers.get('sec-websocket-protocol') ?? ''
    const headers: Record<string, string> = offered.includes(SYNC_SUBPROTOCOL)
      ? { 'sec-websocket-protocol': SYNC_SUBPROTOCOL }
      : {}
    return new Response(null, { status: 101, webSocket: client, headers })
  },
}

/** GET /ws/trips/:id: authenticates the member, then forwards the upgrade to the trip's object */
export async function tripSocket(
  request: Request,
  env: Env,
  url: URL,
  tripId: string,
): Promise<Response> {
  if (request.method !== 'GET' || request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
    return new Response('Expected WebSocket', { status: 426, headers: { 'cache-control': 'no-store' } })
  const auth = await resolveSocketMember(env.DB, tripId, socketToken(request, url))
  if (auth === 'unauthorized') return syncDeps.refuse(request, CloseCode.auth, 'unauthorized')
  if (auth === 'gone') return syncDeps.refuse(request, CloseCode.tripGone, 'trip not found')
  const headers = new Headers(request.headers)
  headers.set(MEMBER_HEADER, auth.memberId)
  headers.set(ROLE_HEADER, auth.role)
  headers.set(READ_ONLY_HEADER, auth.readOnly ? '1' : '0')
  // The object never needs the token; the URL keeps no query
  const forwarded = new Request(new URL(`/connect`, url.origin), { method: 'GET', headers })
  return env.TRIP.get(env.TRIP.idFromName(tripId)).fetch(forwarded)
}
