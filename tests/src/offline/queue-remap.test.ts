import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../src/lib/api.ts'
import { opRequest, resolveOp, unresolvedIds } from '../../../src/lib/offline/itinerary.ts'
import {
  createQueue,
  memoryStore,
  orphanPendingId,
  remapIds,
  type MutationInput,
  type PendingMutation,
} from '../../../src/lib/offline/queue.ts'
import { classify, createdIdOf } from '../../../src/lib/offline/sync.ts'

// e2-t08b: itinerary edits in the offline queue. A stop created offline has a provisional id;
// the moves, patches and legs queued after it name that id and are rewritten with the server's id
// once the create went through. A mutation whose create was discarded is never sent.

const P = 'pending-00000000-0000-4000-8000-0000000000aa'
const P2 = 'pending-00000000-0000-4000-8000-0000000000bb'

const create = (tempId: string): MutationInput => ({
  method: 'POST',
  url: '/api/trips/t1/stops',
  body: { dayId: 'd1', title: 'New' },
  token: 'tok',
  entity: {
    type: 'itinerary',
    tripId: 't1',
    tempId,
    kind: 'stop.create',
    op: { kind: 'stop.create', body: { dayId: 'd1', title: 'New' } },
  },
})

const move = (stopId: string, afterStopId: string | null): MutationInput => {
  const op = { kind: 'stop.move' as const, stopId, body: { dayId: 'd2', afterStopId } }
  return {
    ...opRequest('t1', op),
    token: 'tok',
    entity: { type: 'itinerary', tripId: 't1', kind: op.kind, op },
  }
}

function setup(respond: (mutation: PendingMutation) => unknown) {
  const store = memoryStore()
  const sent: PendingMutation[] = []
  let n = 0
  const queue = createQueue(store, {
    send: async (mutation) => {
      sent.push(mutation)
      const answer = respond(mutation)
      if (answer instanceof Error) throw answer
      return answer
    },
    classify,
    createdId: (_m, response) => createdIdOf(response),
    newId: () => `m${++n}`,
  })
  return { store, queue, sent }
}

describe('provisional ids in the offline queue', () => {
  it('rewrites the waiting moves with the server id once the create went through', async () => {
    const { queue, sent, store } = setup((mutation) =>
      mutation.method === 'POST' && mutation.url.endsWith('/stops')
        ? { stop: { id: 'real-1' }, rev: 3 }
        : { ok: true },
    )
    await queue.enqueue(create(P))
    await queue.enqueue(move(P, null))
    await queue.enqueue(move('s-9', P))
    // Before replay the move names the provisional id (and waits behind its create)
    expect(queue.list()[1].url).toContain(P)
    expect(await queue.replay()).toEqual({ status: 'done', sent: 3 })
    expect(sent[1].url).toBe('/api/trips/t1/stops/real-1/move')
    expect(sent[2].body).toEqual({ dayId: 'd2', afterStopId: 'real-1' })
    expect((sent[2].entity.op as { body: { afterStopId: string } }).body.afterStopId).toBe('real-1')
    expect(queue.resolve(P)).toBe('real-1')
    expect(queue.resolve('other')).toBe('other')
    expect(await store.all()).toEqual([])
  })

  it('persists the rewrite: a replay stopped after the create still sends the real id', async () => {
    let fail = true
    const { queue, store, sent } = setup((mutation) => {
      if (mutation.method === 'POST' && mutation.url.endsWith('/stops'))
        return { stop: { id: 'real-2' } }
      if (fail) return new ApiError(0, 'network', 'offline')
      return { ok: true }
    })
    await queue.enqueue(create(P))
    await queue.enqueue(move(P, null))
    expect(await queue.replay()).toEqual({ status: 'offline', sent: 1 })
    const stored = await store.all()
    expect(stored).toHaveLength(1)
    expect(stored[0].url).toBe('/api/trips/t1/stops/real-2/move')
    fail = false
    expect(await queue.replay()).toEqual({ status: 'done', sent: 1 })
    expect(sent.at(-1)?.url).toBe('/api/trips/t1/stops/real-2/move')
  })

  it('refuses (locally) a move whose create was discarded, without sending it', async () => {
    const { queue, sent } = setup(() => ({ stop: { id: 'never' } }))
    const created = await queue.enqueue(create(P))
    await queue.enqueue(move(P, null))
    await queue.discard(created.id)
    const result = await queue.replay()
    expect(result.status).toBe('blocked')
    expect(result.status === 'blocked' && result.mutation.failure?.code).toBe('pending_dependency')
    expect(sent).toEqual([])
  })

  it('leaves expense creates (no references) alone', async () => {
    const { queue, sent } = setup(() => ({ expense: { id: 'e-real' }, rev: 2 }))
    await queue.enqueue({
      method: 'POST',
      url: '/api/trips/t1/expenses',
      body: { note: 'coffee' },
      token: 'tok',
      entity: { type: 'expense', tripId: 't1', tempId: P2 },
    })
    expect(await queue.replay()).toEqual({ status: 'done', sent: 1 })
    expect(sent[0].body).toEqual({ note: 'coffee' })
    expect(queue.resolve(P2)).toBe('e-real')
  })

  it('helpers: remap, orphan check, created id, op requests', () => {
    const m = { ...move(P, null), id: 'x', seq: 2, createdAt: '' } as PendingMutation
    expect(remapIds(m, 'pending-nope', 'r')).toBe(m)
    expect(remapIds(m, P, 'r').url).toBe('/api/trips/t1/stops/r/move')
    const c = { ...create(P), id: 'c', seq: 1, createdAt: '' } as PendingMutation
    expect(orphanPendingId(m, [c, m])).toBeNull()
    expect(orphanPendingId(m, [m])).toBe(P)
    expect(createdIdOf({ rev: 1, stop: { id: 's' } })).toBe('s')
    expect(createdIdOf({ ok: true })).toBeUndefined()
    expect(opRequest('t 1', { kind: 'leg.delete', fromStopId: 'a', toStopId: 'b' })).toEqual({
      method: 'DELETE',
      url: '/api/trips/t%201/legs/a/b',
    })
    expect(opRequest('t1', { kind: 'day.patch', dayId: 'd1', body: { title: 'x' } }).method).toBe(
      'PATCH',
    )
    const op = { kind: 'stop.patch' as const, stopId: P, body: { title: 'y' } }
    expect(unresolvedIds(op)).toEqual([P])
    expect(resolveOp(op, (id) => (id === P ? 'real' : id))).toEqual({ ...op, stopId: 'real' })
  })
})
