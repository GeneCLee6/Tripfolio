// One live sync connection to a trip (e2-t08a, shared/protocol.ts): says hello with the last rev
// seen, reports the changes other members make, and reconnects with backoff when it drops. It does
// not fetch anything itself: on `event` the owner refetches what it shows; on `resync` everything.

import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_PING,
  isFinalClose,
  parseServerMessage,
  SYNC_SUBPROTOCOL,
  tripSocketPath,
  type TripEvent,
  type WelcomeMessage,
} from '../../../shared/protocol.ts'
import { getRev, noteRev } from './revStore.ts'

export type SyncStatus = 'connecting' | 'online' | 'offline'

export interface TripSocketEvents {
  /** A change on the server (another member's, or this member's from another tab); oldest first */
  event: TripEvent
  /** The catch-up window was missed: refetch everything */
  resync: { rev: number | null }
  status: SyncStatus
  /** The server's answer to hello */
  welcome: WelcomeMessage
  /** A close that reconnecting cannot change (4401 auth, 4404 trip gone): it stopped for good */
  closed: { code: number }
}

/** How long to wait after each failed attempt; the last one repeats */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000]
/** An attempt not welcomed by then has failed */
export const ATTEMPT_TIMEOUT_MS = 10_000
/** Pings sent without any frame back before the connection counts as dead */
const MAX_UNANSWERED_PINGS = 2

/** The slice of the browser's WebSocket this uses (tests and Node pass their own) */
export interface SocketLike {
  readonly readyState: number
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code: number }) => void) | null
  onerror: ((event: unknown) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

export interface TripSocketOptions {
  /** The member token for this trip; null: not a member here (stops with 4401) */
  token: () => string | null
  /** ws(s)://host; defaults to this page's origin */
  origin?: string
  /** Defaults to globalThis.WebSocket */
  createSocket?: (url: string, protocols: string[]) => SocketLike
  /** Timers, swappable in tests */
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
  /** Where online / visibility changes come from (default: window, when there is one) */
  wakeTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null
}

type Listener<K extends keyof TripSocketEvents> = (payload: TripSocketEvents[K]) => void

function defaultOrigin(): string {
  const { protocol, host } = globalThis.location
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}`
}

export class TripSocket {
  readonly tripId: string
  private readonly options: TripSocketOptions
  private readonly listeners = new Map<keyof TripSocketEvents, Set<Listener<never>>>()
  private socket: SocketLike | null = null
  private statusNow: SyncStatus = 'offline'
  private failures = 0
  private retryTimer: unknown = null
  private attemptTimer: unknown = null
  private heartbeat: unknown = null
  private unanswered = 0
  private started = false
  /** The browser says the network is gone: no point waiting for two missed pings */
  private readonly lost = () => {
    if (!this.started || !this.socket) return
    this.drop()
    this.failed()
  }
  private readonly wake = () => {
    if (!this.started || this.socket) return
    const target = globalThis.document
    if (target && target.visibilityState === 'hidden') return
    this.clearTimer('retryTimer')
    this.failures = 0
    this.open()
  }

  constructor(tripId: string, options: TripSocketOptions) {
    this.tripId = tripId
    this.options = options
  }

  get status(): SyncStatus {
    return this.statusNow
  }

  on<K extends keyof TripSocketEvents>(type: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(type)
    if (!set) this.listeners.set(type, (set = new Set()))
    set.add(listener as Listener<never>)
    return () => set.delete(listener as Listener<never>)
  }

  /** Starts connecting (and reconnecting) until close() or a final close */
  connect(): void {
    if (this.started) return
    this.started = true
    const target = this.wakeTarget()
    target?.addEventListener('online', this.wake)
    target?.addEventListener('offline', this.lost)
    target?.addEventListener('visibilitychange', this.wake)
    this.open()
  }

  /** Stops for good; nothing is emitted after it */
  close(): void {
    if (!this.started) return
    this.stop()
    this.setStatus('offline')
    this.listeners.clear()
  }

  private wakeTarget() {
    if (this.options.wakeTarget !== undefined) return this.options.wakeTarget
    return typeof window === 'undefined' ? null : window
  }

  private stop(): void {
    this.started = false
    const target = this.wakeTarget()
    target?.removeEventListener('online', this.wake)
    target?.removeEventListener('offline', this.lost)
    target?.removeEventListener('visibilitychange', this.wake)
    this.clearTimer('retryTimer')
    this.drop()
  }

  private emit<K extends keyof TripSocketEvents>(type: K, payload: TripSocketEvents[K]): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      try {
        ;(listener as Listener<K>)(payload)
      } catch (error) {
        console.error(error)
      }
    }
  }

  private setStatus(status: SyncStatus): void {
    if (status === this.statusNow) return
    this.statusNow = status
    this.emit('status', status)
  }

  private timers() {
    return {
      setTimeout: this.options.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms)),
      clearTimeout:
        this.options.clearTimeout ??
        ((h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>)),
      setInterval: this.options.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms)),
      clearInterval:
        this.options.clearInterval ??
        ((h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>)),
    } satisfies Required<
      Pick<TripSocketOptions, 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'>
    >
  }

  private clearTimer(name: 'retryTimer' | 'attemptTimer'): void {
    if (this[name] !== null) this.timers().clearTimeout(this[name])
    this[name] = null
  }

  /** Forgets the current socket without reporting its close */
  private drop(): void {
    this.clearTimer('attemptTimer')
    if (this.heartbeat !== null) this.timers().clearInterval(this.heartbeat)
    this.heartbeat = null
    const socket = this.socket
    this.socket = null
    if (!socket) return
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
    try {
      socket.close()
    } catch {
      // Already closing
    }
  }

  private open(): void {
    const token = this.options.token()
    if (!token) return this.finish(4401)
    this.setStatus('connecting')
    const url = `${this.options.origin ?? defaultOrigin()}${tripSocketPath(this.tripId)}`
    const create =
      this.options.createSocket ??
      ((u: string, p: string[]) => new globalThis.WebSocket(u, p) as unknown as SocketLike)
    let socket: SocketLike
    try {
      socket = create(url, [SYNC_SUBPROTOCOL, token])
    } catch {
      return this.failed()
    }
    this.socket = socket
    this.unanswered = 0
    const timers = this.timers()
    this.attemptTimer = timers.setTimeout(() => {
      this.attemptTimer = null
      this.drop()
      this.failed()
    }, ATTEMPT_TIMEOUT_MS)

    socket.onopen = () => {
      const sinceRev = getRev(this.tripId)
      this.send(JSON.stringify({ type: 'hello', sinceRev }))
      this.heartbeat = timers.setInterval(() => {
        // A network that dies quietly reports no close for minutes, if ever
        if (this.unanswered >= MAX_UNANSWERED_PINGS) {
          this.drop()
          this.failed()
          return
        }
        this.unanswered++
        this.send(HEARTBEAT_PING)
      }, HEARTBEAT_INTERVAL_MS)
    }
    socket.onmessage = (event) => {
      this.unanswered = 0
      if (typeof event.data === 'string') this.receive(event.data)
    }
    socket.onclose = (event) => {
      this.drop()
      if (isFinalClose(event.code)) this.finish(event.code)
      else this.failed()
    }
  }

  private send(data: string): void {
    try {
      this.socket?.send(data)
    } catch {
      // onclose reports it
    }
  }

  private receive(data: string): void {
    const message = parseServerMessage(data)
    switch (message?.type) {
      case 'hello':
        this.clearTimer('attemptTimer')
        this.failures = 0
        this.setStatus('online')
        this.emit('welcome', message)
        this.deliver(message.events)
        return
      case 'resync':
        this.clearTimer('attemptTimer')
        this.failures = 0
        this.setStatus('online')
        // The owner refetches everything now, which brings it up to at least this rev
        if (message.rev !== null) noteRev(this.tripId, message.rev)
        this.emit('resync', { rev: message.rev })
        return
      case 'patch':
        this.deliver(message.events)
        return
      default:
        // pong, ack (e2-t08b), errors: nothing to do yet
        return
    }
  }

  private deliver(events: TripEvent[]): void {
    for (const event of events) {
      noteRev(this.tripId, event.rev)
      this.emit('event', event)
    }
  }

  /** An attempt failed or a connection dropped: wait, then try again */
  private failed(): void {
    if (!this.started) return
    this.setStatus('offline')
    const delay = RECONNECT_DELAYS_MS[Math.min(this.failures, RECONNECT_DELAYS_MS.length - 1)]
    this.failures++
    this.clearTimer('retryTimer')
    this.retryTimer = this.timers().setTimeout(() => {
      this.retryTimer = null
      if (this.started) this.open()
    }, delay)
  }

  private finish(code: number): void {
    this.stop()
    this.setStatus('offline')
    this.emit('closed', { code })
  }
}
