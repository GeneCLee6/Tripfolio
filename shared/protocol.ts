// The live sync protocol between the browser and the trip's Durable Object (e2-t08a,
// ARCHITECTURE.md §4.2). D1 stays the source of truth: the socket only says *what* changed
// (entity, id, action, rev) and the client refetches what it shows. e2-t08b adds field-level
// patches on top (`ack` is reserved for it).
//
// Every frame is one JSON object with a `type`. The heartbeat frames are exact strings so that the
// Durable Object can answer them without waking up (setWebSocketAutoResponse).

/** Everything a write can touch that a client may need to refetch */
export const SYNC_ENTITIES = [
  'trip',
  'day',
  'stop',
  'legOverride',
  'place',
  'member',
  'lodging',
  'booking',
  'wishlist',
  'expense',
  'pool',
  'settlement',
  'share',
] as const
export type SyncEntity = (typeof SYNC_ENTITIES)[number]

export type SyncAction = 'upsert' | 'delete'

/** What a write handler reports (worker/sync.ts notifyTrip): small, never a full row */
export interface TripChange {
  /** The trip rev the write produced (trips.rev after the bump) */
  rev: number
  entity: SyncEntity
  id: string
  action: SyncAction
  /** Who wrote it, so a client can skip echoes of its own writes; null for system writes */
  byMemberId: string | null
}

/** A change as buffered and broadcast by the Durable Object */
export interface TripEvent extends TripChange {
  /** When the Durable Object received it (ISO 8601) */
  at: string
}

/** The Durable Object keeps this many recent events for reconnect catch-up */
export const EVENT_BUFFER_SIZE = 200
/** The client pings this often; the server drops a socket that missed two pings */
export const HEARTBEAT_INTERVAL_MS = 30_000
/** The server closes a socket that has been silent this long (two missed pings plus slack) */
export const STALE_AFTER_MS = 2 * HEARTBEAT_INTERVAL_MS + 5_000
/** At most this many sockets per trip */
export const MAX_SOCKETS_PER_TRIP = 50

export const HEARTBEAT_PING = '{"type":"ping"}'
export const HEARTBEAT_PONG = '{"type":"pong"}'

/** The subprotocol a browser offers next to its token (`new WebSocket(url, [SYNC_SUBPROTOCOL, token])`) */
export const SYNC_SUBPROTOCOL = 'tripfolio'

/** The upgrade path; the member token goes in `?token=` or as the second subprotocol */
export const tripSocketPath = (tripId: string) => `/ws/trips/${encodeURIComponent(tripId)}`

/** Close codes: 44xx are answers that reconnecting cannot change, except `stale` */
export const CloseCode = {
  /** Missing, invalid or revoked member token, or the member was removed */
  auth: 4401,
  /** The trip no longer exists (purged) */
  tripGone: 4404,
  /** Silent for STALE_AFTER_MS: a dead connection; the client reconnects */
  stale: 4408,
  /** MAX_SOCKETS_PER_TRIP reached; the client tries again later */
  tooMany: 4429,
} as const

/** After these the client stops reconnecting */
export const isFinalClose = (code: number) => code === CloseCode.auth || code === CloseCode.tripGone

// Client → server

export interface HelloMessage {
  type: 'hello'
  /** The last rev this client has seen (from its last fetch or event); null for none */
  sinceRev: number | null
}
export interface PingMessage {
  type: 'ping'
}
export type ClientMessage = HelloMessage | PingMessage

// Server → client

/** The answer to `hello`: the events after `sinceRev` (oldest first) and the newest rev known */
export interface WelcomeMessage {
  type: 'hello'
  memberId: string
  readOnly: boolean
  /** The newest rev the Durable Object has seen; null before the first event */
  rev: number | null
  events: TripEvent[]
}
/** `sinceRev` is older than the buffer: refetch everything, then carry on from `rev` */
export interface ResyncMessage {
  type: 'resync'
  rev: number | null
}
/** Live changes, broadcast to every socket that said hello */
export interface PatchMessage {
  type: 'patch'
  events: TripEvent[]
}
/** Reserved for e2-t08b (writes over the socket); not sent yet */
export interface AckMessage {
  type: 'ack'
  rev: number
}
export interface PongMessage {
  type: 'pong'
}
export interface ErrorMessage {
  type: 'error'
  code: 'bad_frame' | 'unknown_type'
  message: string
}
export type ServerMessage =
  | WelcomeMessage
  | ResyncMessage
  | PatchMessage
  | AckMessage
  | PongMessage
  | ErrorMessage

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isRev = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

export function isTripEvent(v: unknown): v is TripEvent {
  return (
    isObject(v) &&
    isRev(v.rev) &&
    typeof v.entity === 'string' &&
    (SYNC_ENTITIES as readonly string[]).includes(v.entity) &&
    typeof v.id === 'string' &&
    (v.action === 'upsert' || v.action === 'delete') &&
    (v.byMemberId === null || typeof v.byMemberId === 'string') &&
    typeof v.at === 'string'
  )
}

/** A client frame, or null when it is not one */
export function parseClientMessage(data: string): ClientMessage | null {
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    return null
  }
  if (!isObject(raw)) return null
  if (raw.type === 'ping') return { type: 'ping' }
  if (raw.type === 'hello') {
    const since = raw.sinceRev
    if (since !== null && since !== undefined && !isRev(since)) return null
    return { type: 'hello', sinceRev: since ?? null }
  }
  return null
}

/** A server frame, or null when it is not one this client understands */
export function parseServerMessage(data: string): ServerMessage | null {
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    return null
  }
  if (!isObject(raw)) return null
  const rev = raw.rev === null || isRev(raw.rev) ? (raw.rev as number | null) : undefined
  switch (raw.type) {
    case 'hello':
      if (typeof raw.memberId !== 'string' || rev === undefined || !Array.isArray(raw.events))
        return null
      return {
        type: 'hello',
        memberId: raw.memberId,
        readOnly: raw.readOnly === true,
        rev,
        events: raw.events.filter(isTripEvent),
      }
    case 'resync':
      return rev === undefined ? null : { type: 'resync', rev }
    case 'patch':
      return Array.isArray(raw.events) ? { type: 'patch', events: raw.events.filter(isTripEvent) } : null
    case 'ack':
      return isRev(raw.rev) ? { type: 'ack', rev: raw.rev } : null
    case 'pong':
      return { type: 'pong' }
    case 'error':
      return raw.code === 'bad_frame' || raw.code === 'unknown_type'
        ? { type: 'error', code: raw.code, message: String(raw.message ?? '') }
        : null
    default:
      return null
  }
}
