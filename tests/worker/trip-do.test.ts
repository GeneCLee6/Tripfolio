import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CloseCode,
  EVENT_BUFFER_SIZE,
  HEARTBEAT_INTERVAL_MS,
  MAX_SOCKETS_PER_TRIP,
  STALE_AFTER_MS,
  type ServerMessage,
  type TripChange,
} from '../../shared/protocol.ts'
import type { Env } from '../../worker/env.ts'

// TripDO (e2-t08a) without the Workers runtime: `cloudflare:workers` is replaced by a bare base
// class, and the object gets a fake state (storage map, hibernatable sockets with tags and
// attachments, alarm) and fake sockets.

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    ctx: unknown
    env: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  },
}))

class FakePair {
  readonly request: string
  readonly response: string
  constructor(request: string, response: string) {
    this.request = request
    this.response = response
  }
}
vi.stubGlobal('WebSocketRequestResponsePair', FakePair)

const { TripDO, memberTag } = await import('../../worker/trip-do.ts')

class FakeSocket {
  sent: string[] = []
  closed: { code?: number; reason?: string } | null = null
  accepted = false
  attachment: unknown = null
  tags: string[] = []
  pingedAt: number | null = null

  send(data: string) {
    if (this.closed) throw new Error('closed')
    this.sent.push(data)
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason }
  }
  accept() {
    this.accepted = true
  }
  serializeAttachment(value: unknown) {
    this.attachment = structuredClone(value)
  }
  deserializeAttachment() {
    return structuredClone(this.attachment)
  }
  messages(): ServerMessage[] {
    return this.sent.map((s) => JSON.parse(s) as ServerMessage)
  }
  last(): ServerMessage | undefined {
    return this.messages().at(-1)
  }
}

function fakeState() {
  const data = new Map<string, unknown>()
  const sockets: FakeSocket[] = []
  let alarm: number | null = null
  const pending: Promise<unknown>[] = []
  const state = {
    data,
    sockets,
    get alarm() {
      return alarm
    },
    pending,
    storage: {
      async get(keys: string[]) {
        return new Map(keys.filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))]))
      },
      async put(entries: Record<string, unknown>) {
        for (const [k, v] of Object.entries(entries)) data.set(k, structuredClone(v))
      },
      async getAlarm() {
        return alarm
      },
      async setAlarm(at: number) {
        alarm = at
      },
      async deleteAlarm() {
        alarm = null
      },
    },
    setWebSocketAutoResponse: vi.fn(),
    blockConcurrencyWhile(fn: () => Promise<void>) {
      const p = fn()
      pending.push(p)
      return p
    },
    waitUntil(p: Promise<unknown>) {
      pending.push(p)
    },
    acceptWebSocket(ws: FakeSocket, tags: string[]) {
      ws.tags = tags
      sockets.push(ws)
    },
    getWebSockets(tag?: string) {
      return sockets.filter((ws) => !ws.closed && (tag === undefined || ws.tags.includes(tag)))
    },
    getWebSocketAutoResponseTimestamp(ws: FakeSocket) {
      return ws.pingedAt === null ? null : new Date(ws.pingedAt)
    },
  }
  return state
}

type State = ReturnType<typeof fakeState>
type Trip = InstanceType<typeof TripDO>

let clock = 1_000_000

async function makeDO(state: State = fakeState()) {
  const trip = new TripDO(state as unknown as DurableObjectState, {} as Env)
  trip.now = () => clock
  await Promise.all(state.pending)
  return { trip, state }
}

function open(trip: Trip, memberId = 'm1', readOnly = false) {
  const ws = new FakeSocket()
  trip.admit(ws as unknown as WebSocket, { memberId, role: 'editor', readOnly })
  return ws
}

async function hello(trip: Trip, ws: FakeSocket, sinceRev: number | null) {
  await trip.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'hello', sinceRev }))
  return ws.last()
}

const change = (rev: number, over: Partial<TripChange> = {}): TripChange => ({
  rev,
  entity: 'stop',
  id: `s${rev}`,
  action: 'upsert',
  byMemberId: 'm1',
  ...over,
})

beforeEach(() => {
  clock = 1_000_000
})

describe('TripDO', () => {
  it('answers the heartbeat ping without waking (auto-response) and still if woken', async () => {
    const { trip, state } = await makeDO()
    expect(state.setWebSocketAutoResponse).toHaveBeenCalledWith(
      new FakePair('{"type":"ping"}', '{"type":"pong"}'),
    )
    const ws = open(trip)
    await trip.webSocketMessage(ws as unknown as WebSocket, '{"type":"ping"}')
    expect(ws.last()).toEqual({ type: 'pong' })
  })

  it('accepts a member with a tag and an attachment, and arms the heartbeat alarm', async () => {
    const { trip, state } = await makeDO()
    const ws = open(trip, 'm7', true)
    await Promise.all(state.pending)
    expect(ws.tags).toEqual([memberTag('m7')])
    expect(ws.attachment).toMatchObject({ memberId: 'm7', readOnly: true, ready: false })
    expect(state.alarm).toBe(clock + HEARTBEAT_INTERVAL_MS)
  })

  it('refuses a socket without a member with 4401', async () => {
    const { trip, state } = await makeDO()
    const ws = new FakeSocket()
    trip.admit(ws as unknown as WebSocket, null)
    expect(ws.accepted).toBe(true)
    expect(ws.closed?.code).toBe(CloseCode.auth)
    expect(state.sockets).toHaveLength(0)
  })

  it(`caps a trip at ${MAX_SOCKETS_PER_TRIP} sockets with 4429`, async () => {
    const { trip } = await makeDO()
    for (let i = 0; i < MAX_SOCKETS_PER_TRIP; i++) expect(open(trip).closed).toBeNull()
    expect(open(trip).closed?.code).toBe(CloseCode.tooMany)
  })

  it('says hello with no events to a fresh client, then broadcasts to sockets that said hello', async () => {
    const { trip } = await makeDO()
    const a = open(trip, 'a')
    const b = open(trip, 'b')
    const silent = open(trip, 'c')
    expect(await hello(trip, a, null)).toEqual({
      type: 'hello',
      memberId: 'a',
      readOnly: false,
      rev: null,
      events: [],
    })
    await hello(trip, b, 3)
    await trip.notify([change(4)])
    for (const ws of [a, b]) {
      expect(ws.last()).toEqual({
        type: 'patch',
        events: [{ ...change(4), at: new Date(clock).toISOString() }],
      })
    }
    // Live events only start with hello
    expect(silent.sent).toHaveLength(0)
  })

  it('catches up from sinceRev with the buffered events, oldest first', async () => {
    const { trip } = await makeDO()
    await trip.notify([change(5)])
    await trip.notify([change(7), change(7, { entity: 'wishlist', id: 'w1' })])
    // Out of order (a slower concurrent write): buffered in rev order
    await trip.notify([change(6)])
    const ws = open(trip)
    const reply = await hello(trip, ws, 5)
    expect(reply).toMatchObject({ type: 'hello', rev: 7 })
    if (reply?.type !== 'hello') throw new Error('expected hello')
    expect(reply.events.map((e) => [e.rev, e.id])).toEqual([
      [6, 's6'],
      [7, 's7'],
      [7, 'w1'],
    ])
    // Up to date: nothing to catch up
    expect(await hello(trip, open(trip), 7)).toMatchObject({ type: 'hello', events: [] })
  })

  it('ignores a change reported twice', async () => {
    const { trip } = await makeDO()
    const ws = open(trip)
    await hello(trip, ws, null)
    await trip.notify([change(2)])
    await trip.notify([change(2)])
    expect(ws.sent).toHaveLength(2)
  })

  it('asks for a resync when sinceRev is older than what the buffer holds', async () => {
    const { trip } = await makeDO()
    // The first event ever is rev 10: revs up to 9 were never buffered
    await trip.notify([change(10)])
    expect(await hello(trip, open(trip), 8)).toEqual({ type: 'resync', rev: 10 })
    expect(await hello(trip, open(trip), 9)).toMatchObject({ type: 'hello', events: [change(10)] })
  })

  it(`keeps the last ${EVENT_BUFFER_SIZE} events and resyncs a client older than them`, async () => {
    const { trip, state } = await makeDO()
    await trip.notify([change(1)])
    for (let rev = 2; rev <= EVENT_BUFFER_SIZE + 50; rev++) await trip.notify([change(rev)])
    const stored = state.data.get('events') as TripChange[]
    expect(stored).toHaveLength(EVENT_BUFFER_SIZE)
    expect(stored[0].rev).toBe(51)
    expect(state.data.get('floor')).toBe(50)
    expect(await hello(trip, open(trip), 49)).toMatchObject({ type: 'resync' })
    const reply = await hello(trip, open(trip), 50)
    expect(reply?.type === 'hello' && reply.events.length).toBe(EVENT_BUFFER_SIZE)
  })

  it('keeps the buffer through hibernation (a new instance on the same storage)', async () => {
    const { trip, state } = await makeDO()
    await trip.notify([change(3), change(4)])
    const { trip: woken } = await makeDO(state)
    expect(await hello(woken, open(woken), 3)).toMatchObject({
      type: 'hello',
      rev: 4,
      events: [{ rev: 4 }],
    })
  })

  it('closes a removed member’s sockets with 4401', async () => {
    const { trip } = await makeDO()
    const amy = open(trip, 'amy')
    const gene = open(trip, 'gene')
    await hello(trip, gene, null)
    await trip.notify([change(2, { entity: 'member', id: 'amy', action: 'delete' })])
    expect(amy.closed?.code).toBe(CloseCode.auth)
    expect(gene.closed).toBeNull()
    expect(gene.last()).toMatchObject({ type: 'patch' })
  })

  it('drops a socket after two missed pings, keeps one that pings, re-arms while any is open', async () => {
    const { trip, state } = await makeDO()
    const quiet = open(trip, 'a')
    const lively = open(trip, 'b')
    const chatty = open(trip, 'c')
    clock += HEARTBEAT_INTERVAL_MS
    lively.pingedAt = clock // answered by the runtime
    await trip.alarm()
    expect(quiet.closed).toBeNull()
    clock += STALE_AFTER_MS - HEARTBEAT_INTERVAL_MS + 1
    await trip.webSocketMessage(chatty as unknown as WebSocket, '{"type":"ping"}')
    await trip.alarm()
    expect(quiet.closed?.code).toBe(CloseCode.stale)
    expect(lively.closed).toBeNull()
    expect(chatty.closed).toBeNull()
    expect(state.alarm).toBe(clock + HEARTBEAT_INTERVAL_MS)
    clock += STALE_AFTER_MS + 1
    await state.storage.deleteAlarm()
    await trip.alarm()
    expect(lively.closed?.code).toBe(CloseCode.stale)
    expect(chatty.closed?.code).toBe(CloseCode.stale)
    // Nobody left: no more alarms
    expect(state.alarm).toBeNull()
  })

  it('answers a bad frame with an error and keeps the socket', async () => {
    const { trip } = await makeDO()
    const ws = open(trip)
    await trip.webSocketMessage(ws as unknown as WebSocket, 'not json')
    expect(ws.last()).toMatchObject({ type: 'error', code: 'bad_frame' })
    await trip.webSocketMessage(ws as unknown as WebSocket, new ArrayBuffer(2))
    expect(ws.last()).toMatchObject({ type: 'error', code: 'bad_frame' })
    expect(ws.closed).toBeNull()
  })

  it('echoes the close and maps codes that cannot be sent', async () => {
    const { trip } = await makeDO()
    const a = open(trip)
    await trip.webSocketClose(a as unknown as WebSocket, 1006)
    expect(a.closed?.code).toBe(1000)
    const b = open(trip)
    await trip.webSocketClose(b as unknown as WebSocket, 4000)
    expect(b.closed?.code).toBe(4000)
  })
})

// The Worker side: write handlers report to the trip's object, and /ws/trips/:id authenticates

const { handleRequest } = await import('../../worker/app.ts')
const { syncDeps } = await import('../../worker/sync.ts')
const { createFakeD1 } = await import('./fake-d1.ts')

describe('Worker sync glue', () => {
  let env: Env
  let notified: { name: string; changes: TripChange[] }[]
  let forwarded: { name: string; request: Request }[]
  let failNotify = false
  let waited: Promise<unknown>[]
  const ctx = {
    waitUntil: (p: Promise<unknown>) => waited.push(p),
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext

  beforeEach(() => {
    notified = []
    forwarded = []
    waited = []
    failNotify = false
    const TRIP = {
      idFromName: (name: string) => ({ name }),
      get: ({ name }: { name: string }) => ({
        notify: async (changes: TripChange[]) => {
          if (failNotify) throw new Error('object unavailable')
          notified.push({ name, changes })
        },
        fetch: async (request: Request) => {
          forwarded.push({ name, request })
          return new Response('forwarded')
        },
      }),
    }
    env = { DB: createFakeD1().db, APP_VERSION: 'test', TRIP } as unknown as Env
  })

  async function call(method: string, path: string, token?: string, body?: unknown) {
    const headers: Record<string, string> = {}
    if (token) headers.authorization = `Bearer ${token}`
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await handleRequest(
      new Request(`https://x.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
      ctx,
    )
    return { status: res.status, body: (await res.json()) as { rev: number; stop: { id: string } } }
  }

  async function newTrip() {
    const res = await call('POST', '/api/trips', undefined, {
      name: 'NZ South Island',
      destination: 'New Zealand',
      startDate: '2026-12-20',
      endDate: '2026-12-22',
      tz: 'Pacific/Auckland',
      localCurrencies: ['NZD'],
      style: 'campervan',
      owner: { name: 'Gene', color: 'teal' },
    })
    expect(res.status).toBe(201)
    return res.body as unknown as { trip: { id: string }; member: { id: string }; memberToken: string; days: { id: string }[] }
  }

  it('a stop write tells the trip’s object, under the request’s waitUntil', async () => {
    const t = await newTrip()
    const res = await call('POST', `/api/trips/${t.trip.id}/stops`, t.memberToken, {
      dayId: t.days[0].id,
      title: 'Uluwatu',
    })
    expect(res.status).toBe(201)
    expect(waited).toHaveLength(1)
    await Promise.all(waited)
    expect(notified).toEqual([
      {
        name: t.trip.id,
        changes: [
          { rev: res.body.rev, entity: 'stop', id: res.body.stop.id, action: 'upsert', byMemberId: t.member.id },
        ],
      },
    ])
    // A patch that changes nothing bumps no rev and tells nobody
    await call('PATCH', `/api/trips/${t.trip.id}/stops/${res.body.stop.id}`, t.memberToken, {})
    await call('DELETE', `/api/trips/${t.trip.id}/stops/${res.body.stop.id}`, t.memberToken)
    await Promise.all(waited)
    expect(notified.map((n) => n.changes[0].action)).toEqual(['upsert', 'delete'])
  })

  it('a failing object never fails the write', async () => {
    const t = await newTrip()
    failNotify = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call('POST', `/api/trips/${t.trip.id}/stops`, t.memberToken, {
      dayId: t.days[0].id,
    })
    expect(res.status).toBe(201)
    await Promise.all(waited)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('notify_trip_failed'))
    error.mockRestore()
  })

  describe('GET /ws/trips/:id', () => {
    let refused: number[]
    const realRefuse = syncDeps.refuse
    beforeEach(() => {
      refused = []
      syncDeps.refuse = (_request, code) => {
        refused.push(code)
        return new Response('refused')
      }
      return () => {
        syncDeps.refuse = realRefuse
      }
    })

    const upgrade = (path: string, headers: Record<string, string> = {}) =>
      handleRequest(
        new Request(`https://x.test${path}`, { headers: { upgrade: 'websocket', ...headers } }),
        env,
        ctx,
      )

    it('forwards a member’s upgrade with who they are, never the token', async () => {
      const t = await newTrip()
      await upgrade(`/ws/trips/${t.trip.id}?token=${t.memberToken}`, {
        'x-member-id': 'forged',
      })
      expect(refused).toEqual([])
      expect(forwarded).toHaveLength(1)
      const { name, request } = forwarded[0]
      expect(name).toBe(t.trip.id)
      expect(request.headers.get('x-member-id')).toBe(t.member.id)
      expect(request.headers.get('x-role')).toBe('owner')
      expect(request.headers.get('x-read-only')).toBe('0')
      expect(request.url).not.toContain(t.memberToken)
    })

    it('takes the token from the subprotocol too', async () => {
      const t = await newTrip()
      await upgrade(`/ws/trips/${t.trip.id}`, {
        'sec-websocket-protocol': `tripfolio, ${t.memberToken}`,
      })
      expect(forwarded).toHaveLength(1)
    })

    it('refuses a missing, wrong or other trip’s token with 4401', async () => {
      const t = await newTrip()
      const other = await newTrip()
      await upgrade(`/ws/trips/${t.trip.id}`)
      await upgrade(`/ws/trips/${t.trip.id}?token=AAAAAAAAAAAAAAAAAAAAAA`)
      await upgrade(`/ws/trips/${t.trip.id}?token=${other.memberToken}`)
      expect(refused).toEqual([CloseCode.auth, CloseCode.auth, CloseCode.auth])
      expect(forwarded).toHaveLength(0)
    })

    it('keeps a read-only socket for a deleted or archived trip', async () => {
      const t = await newTrip()
      await call('PATCH', `/api/trips/${t.trip.id}`, t.memberToken, { archived: true })
      await upgrade(`/ws/trips/${t.trip.id}?token=${t.memberToken}`)
      expect(forwarded.at(-1)?.request.headers.get('x-read-only')).toBe('1')
      await call('DELETE', `/api/trips/${t.trip.id}`, t.memberToken)
      await upgrade(`/ws/trips/${t.trip.id}?token=${t.memberToken}`)
      expect(forwarded).toHaveLength(2)
      expect(forwarded[1].request.headers.get('x-read-only')).toBe('1')
      await Promise.all(waited)
      expect(notified.at(-1)?.changes[0]).toMatchObject({ entity: 'trip', action: 'delete' })
    })

    it('answers a plain GET with 426 and an unknown /ws path with 404', async () => {
      const t = await newTrip()
      const plain = await handleRequest(new Request(`https://x.test/ws/trips/${t.trip.id}`), env)
      expect(plain.status).toBe(426)
      const unknown = await upgrade('/ws/rooms/x')
      expect(unknown.status).toBe(404)
    })
  })
})
