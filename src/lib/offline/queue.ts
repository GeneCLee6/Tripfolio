// The offline write queue (e10-t05, docs/ARCHITECTURE.md §4.2): mutations that could not reach
// the server wait here, in IndexedDB, and are sent again in the order they were made. Replay is
// sequential and stops at the first one the server refuses (4xx): later writes may depend on it,
// so the person decides (discard or retry) before anything else goes out. Network errors and 5xx
// leave everything in place for the next attempt.
//
// Only expense writes (submitExpense) are queued so far; itinerary edits, check-offs and text
// edits join when e2-t08b's useTrip() pipeline exists (its patches are the queue's real unit).
// The storage sits behind QueueStore so the ordering and replay rules are unit-tested without a
// browser (tests/src/offline/queue.test.ts).

export type MutationMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export interface MutationEntity {
  type: 'expense'
  tripId: string
  /** The server id being changed (PATCH/DELETE) */
  id?: string
  /** A create's provisional id, handed to the UI until the server assigns the real one */
  tempId?: string
}

export interface MutationFailure {
  status: number
  code: string
  message: string
}

export interface PendingMutation {
  id: string
  /** Order of creation; replay goes by it */
  seq: number
  method: MutationMethod
  url: string
  body?: unknown
  /** The memberToken it is sent with */
  token: string
  createdAt: string
  entity: MutationEntity
  /** The server refused it: replay stops here until it is discarded or retried */
  failure?: MutationFailure
}

export type MutationInput = Omit<PendingMutation, 'id' | 'seq' | 'createdAt' | 'failure'>

export interface QueueStore {
  all(): Promise<PendingMutation[]>
  put(mutation: PendingMutation): Promise<void>
  remove(id: string): Promise<void>
}

export type ReplayResult =
  | { status: 'done'; sent: number }
  /** The network failed (or the server had a 5xx): try again later */
  | { status: 'offline'; sent: number }
  /** The server refused this one (4xx) */
  | { status: 'blocked'; sent: number; mutation: PendingMutation }

/** How a send failed: `network` (try later) or a refusal with the server's status and code */
export type SendFailure = { kind: 'network' } | ({ kind: 'refused' } & MutationFailure)

export interface QueueOptions {
  /** Sends one mutation; resolves with the server's answer */
  send: (mutation: PendingMutation) => Promise<unknown>
  /** Sorts a thrown error into network / refused */
  classify: (error: unknown) => SendFailure
  /** Called after each successful send, before the next one */
  onSent?: (mutation: PendingMutation, response: unknown) => void
  now?: () => Date
  newId?: () => string
}

export interface OfflineQueue {
  /** Loads the stored mutations (call once at start) */
  load(): Promise<void>
  enqueue(input: MutationInput): Promise<PendingMutation>
  /** Changes a waiting mutation in place (e.g. a second edit of an expense made offline) */
  update(id: string, change: (mutation: PendingMutation) => PendingMutation): Promise<void>
  replay(): Promise<ReplayResult>
  discard(id: string): Promise<void>
  /** Clears a refusal so the next replay sends it again */
  retry(id: string): Promise<void>
  /** The waiting mutations, oldest first (a new array after every change) */
  list(): readonly PendingMutation[]
  count(): number
  subscribe(listener: () => void): () => void
}

const bySeq = (a: PendingMutation, b: PendingMutation) => a.seq - b.seq

export function createQueue(store: QueueStore, options: QueueOptions): OfflineQueue {
  const now = options.now ?? (() => new Date())
  const newId = options.newId ?? (() => crypto.randomUUID())
  let items: PendingMutation[] = []
  const listeners = new Set<() => void>()
  let running: Promise<ReplayResult> | null = null

  const set = (next: PendingMutation[]) => {
    items = [...next].sort(bySeq)
    for (const listener of listeners) listener()
  }

  const replayOnce = async (): Promise<ReplayResult> => {
    let sent = 0
    // Mutations enqueued while replaying are picked up by the loop: it re-reads `items`
    for (;;) {
      const next = items[0]
      if (!next) return { status: 'done', sent }
      if (next.failure) return { status: 'blocked', sent, mutation: next }
      let response: unknown
      try {
        response = await options.send(next)
      } catch (error) {
        const failure = options.classify(error)
        if (failure.kind === 'network' || failure.status >= 500 || RETRY_LATER.has(failure.status)) {
          return { status: 'offline', sent }
        }
        const { status, code, message } = failure
        const refused = { ...next, failure: { status, code, message } }
        await store.put(refused)
        set(items.map((item) => (item.id === next.id ? refused : item)))
        return { status: 'blocked', sent, mutation: refused }
      }
      await store.remove(next.id)
      set(items.filter((item) => item.id !== next.id))
      sent += 1
      options.onSent?.(next, response)
    }
  }

  return {
    async load() {
      set(await store.all())
    },
    async enqueue(input) {
      const seq = Math.max(0, ...items.map((item) => item.seq)) + 1
      const mutation: PendingMutation = {
        ...input,
        id: newId(),
        seq,
        createdAt: now().toISOString(),
      }
      await store.put(mutation)
      set([...items, mutation])
      return mutation
    },
    async update(id, change) {
      const current = items.find((item) => item.id === id)
      if (!current) return
      const next = { ...change(current), id: current.id, seq: current.seq }
      await store.put(next)
      set(items.map((item) => (item.id === id ? next : item)))
    },
    replay() {
      // One replay at a time: a second call while one runs gets the same promise
      running ??= replayOnce().finally(() => {
        running = null
      })
      return running
    },
    async discard(id) {
      await store.remove(id)
      set(items.filter((item) => item.id !== id))
    },
    async retry(id) {
      const current = items.find((item) => item.id === id)
      if (!current?.failure) return
      const { failure: _cleared, ...rest } = current
      await store.put(rest)
      set(items.map((item) => (item.id === id ? rest : item)))
    },
    list: () => items,
    count: () => items.length,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** 4xx that mean "not now" rather than "no": timeout, rate limit */
const RETRY_LATER = new Set([408, 425, 429])

/** In memory: tests, and browsers without IndexedDB (the queue then lasts until the tab closes) */
export function memoryStore(initial: PendingMutation[] = []): QueueStore {
  const map = new Map(initial.map((item) => [item.id, item]))
  return {
    all: async () => [...map.values()],
    put: async (mutation) => {
      map.set(mutation.id, structuredClone(mutation))
    },
    remove: async (id) => {
      map.delete(id)
    },
  }
}

const DB_NAME = 'tripfolio-offline'
const STORE = 'mutations'

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** IndexedDB `tripfolio-offline` / `mutations`, keyed by id */
export function idbStore(): QueueStore {
  let db: Promise<IDBDatabase> | null = null
  const open = () => {
    db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return db
  }
  const run = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) => {
    const database = await open()
    return promised(action(database.transaction(STORE, mode).objectStore(STORE)))
  }
  return {
    all: () => run('readonly', (store) => store.getAll() as IDBRequest<PendingMutation[]>),
    put: async (mutation) => {
      await run('readwrite', (store) => store.put(mutation))
    },
    remove: async (id) => {
      await run('readwrite', (store) => store.delete(id))
    },
  }
}
