import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../src/lib/api.ts'
import { mergeIntoCreate, provisionalExpense } from '../../../src/lib/offline/expenses.ts'
import {
  createQueue,
  memoryStore,
  type MutationInput,
  type PendingMutation,
} from '../../../src/lib/offline/queue.ts'
import { classify, isNetworkError } from '../../../src/lib/offline/sync.ts'

// The offline write queue (e10-t05): order, sequential replay, stop on 4xx, retry on network
// errors, persistence through the store.

const input = (note: string): MutationInput => ({
  method: 'POST',
  url: '/api/trips/t1/expenses',
  body: { note },
  token: 'tok',
  entity: { type: 'expense', tripId: 't1' },
})

function setup(respond: (mutation: PendingMutation) => Promise<unknown>) {
  const store = memoryStore()
  const sent: string[] = []
  let n = 0
  const queue = createQueue(store, {
    send: async (mutation) => {
      const answer = await respond(mutation)
      sent.push((mutation.body as { note: string }).note)
      return answer
    },
    classify,
    newId: () => `m${++n}`,
    now: () => new Date('2026-11-09T00:00:00Z'),
  })
  return { store, queue, sent }
}

describe('offline queue', () => {
  it('replays in the order the writes were made, one at a time', async () => {
    let active = 0
    const { queue, sent, store } = setup(async () => {
      active += 1
      expect(active).toBe(1)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return { ok: true }
    })
    for (const note of ['a', 'b', 'c']) await queue.enqueue(input(note))
    expect(queue.count()).toBe(3)
    expect(queue.list().map((item) => item.seq)).toEqual([1, 2, 3])
    expect(await queue.replay()).toEqual({ status: 'done', sent: 3 })
    expect(sent).toEqual(['a', 'b', 'c'])
    expect(queue.count()).toBe(0)
    expect(await store.all()).toEqual([])
  })

  it('stops at the first 4xx, keeps it (and everything after) and surfaces it', async () => {
    const { queue, sent } = setup(async (mutation) => {
      if ((mutation.body as { note: string }).note === 'b') {
        throw new ApiError(422, 'fx_unavailable', 'no rate')
      }
      return {}
    })
    for (const note of ['a', 'b', 'c']) await queue.enqueue(input(note))
    const result = await queue.replay()
    expect(result.status).toBe('blocked')
    expect(result.sent).toBe(1)
    expect(sent).toEqual(['a'])
    expect(queue.list().map((item) => item.failure?.code ?? null)).toEqual(['fx_unavailable', null])
    // Replaying again does not skip past it
    expect((await queue.replay()).status).toBe('blocked')
    expect(sent).toEqual(['a'])
    // Discarding it lets the rest through
    await queue.discard(queue.list()[0].id)
    expect(await queue.replay()).toEqual({ status: 'done', sent: 1 })
    expect(sent).toEqual(['a', 'c'])
  })

  it('leaves everything in place on a network error or a 5xx, and sends it next time', async () => {
    let failure: unknown = new ApiError(0, 'network', 'Failed to fetch')
    const { queue, sent } = setup(async () => {
      if (failure) throw failure
      return {}
    })
    await queue.enqueue(input('a'))
    await queue.enqueue(input('b'))
    expect(await queue.replay()).toEqual({ status: 'offline', sent: 0 })
    failure = new ApiError(503, 'unavailable', 'down')
    expect(await queue.replay()).toEqual({ status: 'offline', sent: 0 })
    failure = new TypeError('Failed to fetch')
    expect(await queue.replay()).toEqual({ status: 'offline', sent: 0 })
    expect(queue.count()).toBe(2)
    expect(queue.list().every((item) => !item.failure)).toBe(true)
    failure = null
    expect(await queue.replay()).toEqual({ status: 'done', sent: 2 })
    expect(sent).toEqual(['a', 'b'])
  })

  it('retry() clears a refusal so it is sent again', async () => {
    let refuse = true
    const { queue, sent } = setup(async () => {
      if (refuse) throw new ApiError(409, 'conflict', 'stale')
      return {}
    })
    await queue.enqueue(input('a'))
    await queue.replay()
    refuse = false
    await queue.retry(queue.list()[0].id)
    expect(await queue.replay()).toEqual({ status: 'done', sent: 1 })
    expect(sent).toEqual(['a'])
  })

  it('shares one replay between overlapping calls and picks up writes made meanwhile', async () => {
    const { queue, sent } = setup(async () => new Promise((resolve) => setTimeout(resolve, 1)))
    await queue.enqueue(input('a'))
    const first = queue.replay()
    const second = queue.replay()
    expect(second).toBe(first)
    await queue.enqueue(input('b'))
    await first
    expect(sent).toEqual(['a', 'b'])
  })

  it('reloads what the store kept (a reopened app) and notifies subscribers', async () => {
    const store = memoryStore()
    const options = { send: async () => ({}), classify }
    const before = createQueue(store, options)
    await before.enqueue(input('a'))
    await before.enqueue(input('b'))
    const after = createQueue(store, options)
    let calls = 0
    after.subscribe(() => calls++)
    await after.load()
    expect(after.list().map((item) => (item.body as { note: string }).note)).toEqual(['a', 'b'])
    expect(calls).toBe(1)
    // New writes continue the sequence
    expect((await after.enqueue(input('c'))).seq).toBe(3)
  })

  it('update() changes a waiting mutation in place', async () => {
    const { queue } = setup(async () => ({}))
    const item = await queue.enqueue(input('a'))
    await queue.update(item.id, (current) => ({ ...current, body: { note: 'a2' } }))
    expect(queue.list()).toHaveLength(1)
    expect(queue.list()[0]).toMatchObject({ id: item.id, seq: 1, body: { note: 'a2' } })
  })
})

describe('network errors', () => {
  it('tells network failures from refusals', () => {
    expect(isNetworkError(new ApiError(0, 'network', 'Failed to fetch'))).toBe(true)
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new ApiError(422, 'fx_unavailable', 'x'))).toBe(false)
    expect(classify(new ApiError(404, 'not_found', 'gone'))).toEqual({
      kind: 'refused',
      status: 404,
      code: 'not_found',
      message: 'gone',
    })
  })
})

describe('provisional expenses', () => {
  it('echoes the body with a pending id', () => {
    const view = provisionalExpense('t1', 'pending-1', {
      amountMinor: 4500,
      currency: 'NZD',
      category: 'food',
      date: '2026-11-09',
      note: 'fish',
      payerMemberId: 'm1',
    })
    expect(view).toMatchObject({
      id: 'pending-1',
      tripId: 't1',
      amountMinor: 4500,
      currency: 'NZD',
      category: 'food',
      note: 'fish',
      payerMemberId: 'm1',
      rev: -1,
      shares: [],
    })
  })

  it('folds a later edit into the queued create; a cleared rate is left out', () => {
    const create = {
      amountMinor: 100,
      currency: 'NZD',
      category: 'food' as const,
      splitMethod: 'equal' as const,
      fxRate: 0.9,
    }
    expect(mergeIntoCreate(create, { note: 'x', fxRate: null })).toEqual({
      amountMinor: 100,
      currency: 'NZD',
      category: 'food',
      splitMethod: 'equal',
      note: 'x',
    })
    expect(mergeIntoCreate(create, { fxRate: 0.95 }).fxRate).toBe(0.95)
  })
})
