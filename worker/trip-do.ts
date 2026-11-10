import { DurableObject } from 'cloudflare:workers'
import {
  CloseCode,
  EVENT_BUFFER_SIZE,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  MAX_SOCKETS_PER_TRIP,
  parseClientMessage,
  STALE_AFTER_MS,
  SYNC_SUBPROTOCOL,
  type ServerMessage,
  type TripChange,
  type TripEvent,
} from '../shared/protocol.ts'
import type { Role } from '../shared/schema/member.ts'
import type { Env } from './env.ts'
import { MEMBER_HEADER, READ_ONLY_HEADER, ROLE_HEADER } from './sync.ts'


const EVENTS_KEY = 'events'
/** Events with rev <= floor may be missing from the buffer (evicted, or before the first one) */
const FLOOR_KEY = 'floor'

export interface SocketMember {
  memberId: string
  role: Role
  /** Viewer, archived or deleted trip: e2-t08b will refuse writes over the socket */
  readOnly: boolean
}

/** What each socket carries through hibernation (serializeAttachment) */
export interface SocketInfo extends SocketMember {
  /** Said hello: gets live events from then on */
  ready: boolean
  openedAt: number
  /** The last frame from it (pings answered by the runtime are read from their timestamp instead) */
  lastSeen: number
}

/** One tag per member, so that a removed member's sockets can be found and closed */
export const memberTag = (memberId: string) => `m:${memberId}`

/** Same rev, entity, id and action: the same change reported twice */
const sameChange = (a: TripChange, b: TripChange) =>
  a.rev === b.rev && a.entity === b.entity && a.id === b.id && a.action === b.action

/**
 * One object per trip (`idFromName(<trip id>)`, ARCHITECTURE.md §4.2): live sync only. D1 is the
 * source of truth; this object only fans out what the write handlers report (`notify`, an RPC that
 * only the Worker can reach through the binding) and keeps the last EVENT_BUFFER_SIZE events in its
 * storage, so that a reconnecting client can catch up with `hello { sinceRev }` even after the
 * object hibernated or was evicted.
 *
 * Members are authenticated by the Worker before the upgrade (worker/sync.ts), which forwards the
 * member id, role and read-only flag as headers. Sockets use the hibernation API; the heartbeat
 * ping is answered by the runtime without waking the object, and an alarm every
 * HEARTBEAT_INTERVAL_MS closes the sockets silent for STALE_AFTER_MS (two missed pings).
 */
export class TripDO extends DurableObject<Env> {
  /** Oldest first, sorted by rev; mirrors storage */
  private events: TripEvent[] = []
  private floor: number | null = null
  /** The clock; tests replace it */
  now: () => number = Date.now

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG))
    void ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<unknown>([EVENTS_KEY, FLOOR_KEY])
      this.events = (stored.get(EVENTS_KEY) as TripEvent[] | undefined) ?? []
      this.floor = (stored.get(FLOOR_KEY) as number | null | undefined) ?? null
    })
  }

  /** RPC: `env.TRIP.get(id).ping()` (kept from the skeleton) */
  async ping(): Promise<'pong'> {
    return 'pong'
  }

  /** The newest rev seen; null before the first event */
  private latestRev(): number | null {
    return this.events.length ? this.events[this.events.length - 1].rev : this.floor
  }

  /**
   * RPC from the write handlers (worker/sync.ts notifyTrip): buffers the changes and broadcasts
   * them to every socket that said hello. Changes may arrive out of order (concurrent writes): they
   * are buffered in rev order and broadcast as they come.
   */
  async notify(changes: TripChange[]): Promise<void> {
    const at = new Date(this.now()).toISOString()
    const fresh: TripEvent[] = []
    for (const change of changes) {
      if (this.events.some((e) => sameChange(e, change))) continue
      // The very first event: whatever came before it was never buffered
      if (this.floor === null && this.events.length === 0) this.floor = change.rev - 1
      const event: TripEvent = { ...change, at }
      let i = this.events.length
      while (i > 0 && this.events[i - 1].rev > event.rev) i--
      this.events.splice(i, 0, event)
      fresh.push(event)
    }
    if (!fresh.length) return
    if (this.events.length > EVENT_BUFFER_SIZE) {
      const evicted = this.events.splice(0, this.events.length - EVENT_BUFFER_SIZE)
      this.floor = Math.max(this.floor ?? 0, evicted[evicted.length - 1].rev)
    }
    this.broadcast({ type: 'patch', events: fresh })
    for (const event of fresh) {
      // A removed member's open sockets go too (their token is revoked in the same write)
      if (event.entity === 'member' && event.action === 'delete')
        this.closeTagged(memberTag(event.id), CloseCode.auth, 'member removed')
    }
    await this.ctx.storage.put({ [EVENTS_KEY]: this.events, [FLOOR_KEY]: this.floor })
  }

  /** Only the WebSocket upgrade, forwarded by the Worker from GET /ws/trips/:id */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
      return new Response('Expected WebSocket', { status: 426 })
    const memberId = request.headers.get(MEMBER_HEADER)
    const role = request.headers.get(ROLE_HEADER) as Role | null
    const readOnly = request.headers.get(READ_ONLY_HEADER) === '1'
    const { 0: client, 1: server } = new WebSocketPair()
    this.admit(server, memberId && role ? { memberId, role, readOnly } : null)
    // A browser that offered subprotocols (the token travels as one) fails without this answer
    const offered = (request.headers.get('sec-websocket-protocol') ?? '').split(',')
    const headers: Record<string, string> = offered.some((p) => p.trim() === SYNC_SUBPROTOCOL)
      ? { 'sec-websocket-protocol': SYNC_SUBPROTOCOL }
      : {}
    return new Response(null, { status: 101, webSocket: client, headers })
  }

  /** Accepts the server end of a new socket, or closes it with the reason */
  admit(server: WebSocket, member: SocketMember | null): void {
    const refuse = (code: number, reason: string) => {
      // A hibernatable socket closed before the 101 goes out stays open in workerd, so a refused
      // one is a plain socket, closed once the upgrade is done
      server.accept()
      server.close(code, reason)
    }
    if (!member) return refuse(CloseCode.auth, 'no member')
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS_PER_TRIP)
      return refuse(CloseCode.tooMany, 'too many connections')
    const now = this.now()
    const info: SocketInfo = { ...member, ready: false, openedAt: now, lastSeen: now }
    this.ctx.acceptWebSocket(server, [memberTag(member.memberId)])
    server.serializeAttachment(info)
    this.ctx.waitUntil(this.armAlarm())
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const info = ws.deserializeAttachment() as SocketInfo
    info.lastSeen = this.now()
    const message = typeof data === 'string' ? parseClientMessage(data) : null
    if (message?.type !== 'hello') {
      ws.serializeAttachment(info)
      // A ping is normally answered by the auto-response without waking the object
      if (message?.type === 'ping') return send(ws, { type: 'pong' })
      return send(ws, { type: 'error', code: 'bad_frame', message: 'not a client message' })
    }
    // hello: catch up from sinceRev, then live events
    info.ready = true
    ws.serializeAttachment(info)
    const { sinceRev } = message
    const rev = this.latestRev()
    if (sinceRev !== null && this.floor !== null && sinceRev < this.floor)
      return send(ws, { type: 'resync', rev })
    send(ws, {
      type: 'hello',
      memberId: info.memberId,
      readOnly: info.readOnly,
      rev,
      events: sinceRev === null ? [] : this.events.filter((e) => e.rev > sinceRev),
    })
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      // 1005 and 1006 are reported, never sent
      ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000)
    } catch {
      // Already closed
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011)
  }

  /** Every HEARTBEAT_INTERVAL_MS while sockets are open: closes the silent ones */
  override async alarm(): Promise<void> {
    const now = this.now()
    let open = 0
    for (const ws of this.ctx.getWebSockets()) {
      const info = ws.deserializeAttachment() as SocketInfo | null
      const pinged = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0
      if (info && now - Math.max(info.lastSeen, pinged) <= STALE_AFTER_MS) {
        open++
        continue
      }
      try {
        ws.close(CloseCode.stale, 'missed heartbeats')
      } catch {
        // Already closed
      }
    }
    if (open) await this.ctx.storage.setAlarm(now + HEARTBEAT_INTERVAL_MS)
  }

  /** Starts the heartbeat sweep when the first socket opens */
  private async armAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) !== null) return
    await this.ctx.storage.setAlarm(this.now() + HEARTBEAT_INTERVAL_MS)
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message)
    for (const ws of this.ctx.getWebSockets()) {
      const info = ws.deserializeAttachment() as SocketInfo | null
      if (!info?.ready) continue
      try {
        ws.send(payload)
      } catch {
        // The socket is closing; webSocketClose cleans up
      }
    }
  }

  private closeTagged(tag: string, code: number, reason: string): void {
    for (const ws of this.ctx.getWebSockets(tag)) {
      try {
        ws.close(code, reason)
      } catch {
        // Already closed
      }
    }
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message))
  } catch {
    // The socket is closing; webSocketClose cleans up
  }
}
