import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CloseCode, type TripEvent } from '../../../shared/protocol.ts'
import { forgetRev, getRev, noteRev } from '../../../src/lib/sync/revStore.ts'
import {
  ATTEMPT_TIMEOUT_MS,
  RECONNECT_DELAYS_MS,
  TripSocket,
  type SocketLike,
  type SyncStatus,
} from '../../../src/lib/sync/TripSocket.ts'
import { startTripSync, type TripSyncEvent } from '../../../src/lib/sync/useTripSync.ts'
import { setToken, clearTokens } from '../../../src/lib/tokens.ts'

// TripSocket (e2-t08a) against a fake WebSocket and a fake clock.

class FakeSocket implements SocketLike {
  readyState = 0
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  sent: string[] = []
  closedByClient = false
  readonly url: string
  readonly protocols: string[]
  constructor(url: string, protocols: string[]) {
    this.url = url
    this.protocols = protocols
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closedByClient = true
  }
  // Server side
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
  drop(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

class FakeClock {
  now = 0
  private seq = 0
  private tasks = new Map<number, { at: number; fn: () => void; every?: number }>()
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.seq
    this.tasks.set(id, { at: this.now + ms, fn })
    return id
  }
  setInterval = (fn: () => void, ms: number) => {
    const id = ++this.seq
    this.tasks.set(id, { at: this.now + ms, fn, every: ms })
    return id
  }
  clear = (id: unknown) => {
    this.tasks.delete(id as number)
  }
  advance(ms: number) {
    const end = this.now + ms
    for (;;) {
      const next = [...this.tasks.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      const [id, task] = next
      this.now = task.at
      if (task.every) task.at += task.every
      else this.tasks.delete(id)
      task.fn()
    }
    this.now = end
  }
}

let clock: FakeClock
let sockets: FakeSocket[]
let token: string | null

const event = (rev: number, id = `s${rev}`): TripEvent => ({
  rev,
  entity: 'stop',
  id,
  action: 'upsert',
  byMemberId: 'm2',
  at: '2026-11-10T00:00:00.000Z',
})

function make(tripId = 'trip1') {
  const socket = new TripSocket(tripId, {
    token: () => token,
    origin: 'ws://x.test',
    createSocket: (url, protocols) => {
      const s = new FakeSocket(url, protocols)
      sockets.push(s)
      return s
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clear,
    setInterval: clock.setInterval,
    clearInterval: clock.clear,
    wakeTarget: null,
  })
  const seen = { events: [] as TripEvent[], statuses: [] as SyncStatus[], resyncs: 0, closed: [] as number[] }
  socket.on('event', (e) => seen.events.push(e))
  socket.on('status', (s) => seen.statuses.push(s))
  socket.on('resync', () => seen.resyncs++)
  socket.on('closed', ({ code }) => seen.closed.push(code))
  return { socket, seen }
}

const last = () => sockets[sockets.length - 1]
const welcome = (events: TripEvent[] = [], rev: number | null = null) => ({
  type: 'hello',
  memberId: 'm1',
  readOnly: false,
  rev,
  events,
})

beforeEach(() => {
  clock = new FakeClock()
  sockets = []
  token = 'AAAAAAAAAAAAAAAAAAAAAA'
  forgetRev('trip1')
})

afterEach(() => forgetRev('trip1'))

describe('TripSocket', () => {
  it('drops the connection at once when the browser goes offline, and is back on online', () => {
    const target = new EventTarget()
    const socket = new TripSocket('trip1', {
      token: () => token,
      origin: 'ws://x.test',
      createSocket: (url, protocols) => {
        const s = new FakeSocket(url, protocols)
        sockets.push(s)
        return s
      },
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clear,
      setInterval: clock.setInterval,
      clearInterval: clock.clear,
      wakeTarget: target,
    })
    const statuses: SyncStatus[] = []
    socket.on('status', (s) => statuses.push(s))
    socket.connect()
    last().open()
    last().receive(welcome())
    target.dispatchEvent(new Event('offline'))
    expect(statuses).toEqual(['connecting', 'online', 'offline'])
    expect(sockets).toHaveLength(1)
    target.dispatchEvent(new Event('online'))
    expect(sockets).toHaveLength(2)
    last().open()
    last().receive(welcome())
    expect(statuses.at(-1)).toBe('online')
    socket.close()
  })

  it('connects with the token as a subprotocol and says hello with the last rev seen', () => {
    noteRev('trip1', 12)
    const { socket, seen } = make()
    socket.connect()
    expect(last().url).toBe('ws://x.test/ws/trips/trip1')
    expect(last().protocols).toEqual(['tripfolio', token])
    expect(seen.statuses).toEqual(['connecting'])
    last().open()
    expect(JSON.parse(last().sent[0])).toEqual({ type: 'hello', sinceRev: 12 })
    last().receive(welcome([event(13)], 13))
    expect(seen.statuses).toEqual(['connecting', 'online'])
    expect(seen.events.map((e) => e.rev)).toEqual([13])
    expect(getRev('trip1')).toBe(13)
  })

  it('says hello with null when it has seen nothing, and emits live patches', () => {
    const { socket, seen } = make()
    socket.connect()
    last().open()
    expect(JSON.parse(last().sent[0])).toEqual({ type: 'hello', sinceRev: null })
    last().receive(welcome())
    last().receive({ type: 'patch', events: [event(3), event(3, 'w')] })
    expect(seen.events.map((e) => e.id)).toEqual(['s3', 'w'])
    expect(getRev('trip1')).toBe(3)
  })

  it('reconnects with backoff 1, 2, 4, 8, 15, 30, 30 s and catches up with sinceRev', () => {
    const { socket, seen } = make()
    socket.connect()
    last().open()
    last().receive(welcome())
    last().receive({ type: 'patch', events: [event(5)] })
    last().drop()
    expect(seen.statuses.at(-1)).toBe('offline')
    const delays: number[] = []
    for (let i = 0; i < 7; i++) {
      const before = sockets.length
      let waited = 0
      while (sockets.length === before) {
        clock.advance(500)
        waited += 500
      }
      delays.push(waited)
      last().drop()
    }
    expect(delays).toEqual([...RECONNECT_DELAYS_MS, 30_000])
    clock.advance(30_000)
    last().open()
    expect(JSON.parse(last().sent[0])).toEqual({ type: 'hello', sinceRev: 5 })
    last().receive(welcome([event(6)], 6))
    expect(seen.statuses.at(-1)).toBe('online')
    expect(seen.events.map((e) => e.rev)).toEqual([5, 6])
    // Welcomed: the backoff starts again from 1 s
    last().drop()
    const before = sockets.length
    clock.advance(RECONNECT_DELAYS_MS[0])
    expect(sockets.length).toBe(before + 1)
  })

  it('emits resync and remembers the rev it resynced to', () => {
    noteRev('trip1', 2)
    const { socket, seen } = make()
    socket.connect()
    last().open()
    last().receive({ type: 'resync', rev: 400 })
    expect(seen.resyncs).toBe(1)
    expect(seen.statuses.at(-1)).toBe('online')
    expect(getRev('trip1')).toBe(400)
  })

  it('stops for good after 4401 and 4404, but retries after 4429 and 4408', () => {
    for (const code of [CloseCode.auth, CloseCode.tripGone]) {
      const { socket, seen } = make()
      socket.connect()
      last().drop(code)
      const before = sockets.length
      clock.advance(60_000)
      expect(sockets.length).toBe(before)
      expect(seen.closed).toEqual([code])
    }
    for (const code of [CloseCode.tooMany, CloseCode.stale]) {
      const { socket } = make()
      socket.connect()
      last().drop(code)
      const before = sockets.length
      clock.advance(RECONNECT_DELAYS_MS[0])
      expect(sockets.length).toBe(before + 1)
      socket.close()
    }
  })

  it('without a token stops at once with 4401', () => {
    token = null
    const { socket, seen } = make()
    socket.connect()
    expect(sockets).toHaveLength(0)
    expect(seen.closed).toEqual([4401])
  })

  it('pings every 30 s and drops a connection after two unanswered pings', () => {
    const { socket, seen } = make()
    socket.connect()
    const first = last()
    first.open()
    first.receive(welcome())
    clock.advance(30_000)
    expect(first.sent.at(-1)).toBe('{"type":"ping"}')
    first.receive({ type: 'pong' })
    clock.advance(30_000)
    clock.advance(30_000)
    expect(first.closedByClient).toBe(false)
    clock.advance(30_000)
    expect(first.closedByClient).toBe(true)
    expect(seen.statuses.at(-1)).toBe('offline')
    clock.advance(RECONNECT_DELAYS_MS[0])
    expect(last()).not.toBe(first)
  })

  it('gives up on an attempt that is never welcomed', () => {
    const { socket } = make()
    socket.connect()
    const first = last()
    clock.advance(ATTEMPT_TIMEOUT_MS)
    expect(first.closedByClient).toBe(true)
    clock.advance(RECONNECT_DELAYS_MS[0])
    expect(sockets).toHaveLength(2)
  })

  it('close() stops reconnecting and emits nothing more', () => {
    const { socket, seen } = make()
    socket.connect()
    last().open()
    last().receive(welcome())
    socket.close()
    expect(last().closedByClient).toBe(true)
    const count = seen.statuses.length
    clock.advance(120_000)
    expect(sockets).toHaveLength(1)
    expect(seen.statuses).toHaveLength(count)
  })
})

describe('revStore', () => {
  it('only moves forward', () => {
    expect(getRev('trip1')).toBeNull()
    noteRev('trip1', 5)
    noteRev('trip1', 3)
    expect(getRev('trip1')).toBe(5)
    forgetRev('trip1')
    expect(getRev('trip1')).toBeNull()
  })
})

describe('startTripSync', () => {
  afterEach(() => clearTokens())

  it('uses the stored member token and passes events and status to the page', () => {
    setToken('trip1', 'BBBBBBBBBBBBBBBBBBBBBB')
    const heard: TripSyncEvent[] = []
    const statuses: SyncStatus[] = []
    const stop = startTripSync('trip1', (e) => heard.push(e), (s) => statuses.push(s), {
      origin: 'ws://x.test',
      createSocket: (url, protocols) => {
        const s = new FakeSocket(url, protocols)
        sockets.push(s)
        return s
      },
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clear,
      setInterval: clock.setInterval,
      clearInterval: clock.clear,
      wakeTarget: null,
    })
    expect(last().protocols[1]).toBe('BBBBBBBBBBBBBBBBBBBBBB')
    last().open()
    last().receive(welcome())
    last().receive({ type: 'patch', events: [event(1)] })
    last().receive({ type: 'resync', rev: 9 })
    expect(heard).toEqual([
      { type: 'event', event: event(1) },
      { type: 'resync', rev: 9 },
    ])
    expect(statuses).toEqual(['connecting', 'online'])
    stop()
    expect(statuses.at(-1)).toBe('offline')
  })
})
