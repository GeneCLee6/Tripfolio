import { useSyncExternalStore } from 'react'
import { isApiError, request } from '../api.ts'
import {
  createQueue,
  idbStore,
  memoryStore,
  type PendingMutation,
  type SendFailure,
} from './queue.ts'
import { isOnline, onBackOnline, probe, reportNetworkFailure } from './useOnline.ts'

// The app's one offline queue (e10-t05): IndexedDB-backed, replayed through src/lib/api.ts's
// request() with each mutation's own token, on app start, when the connection comes back, and
// when the tab becomes visible again. No Background Sync (Safari has none; ARCHITECTURE.md §4.2).

/** `ApiError(0, 'network')` from request(), or a raw fetch TypeError */
export function isNetworkError(error: unknown): boolean {
  if (isApiError(error)) return error.status === 0 || error.code === 'network'
  return error instanceof TypeError
}

export function classify(error: unknown): SendFailure {
  if (isNetworkError(error)) return { kind: 'network' }
  if (isApiError(error)) {
    return { kind: 'refused', status: error.status, code: error.code, message: error.message }
  }
  return { kind: 'refused', status: 400, code: 'unknown', message: String(error) }
}

/** The id in a create's answer: `{ stop: { id } }`, `{ expense: { id } }`, … */
export function createdIdOf(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined
  for (const value of Object.values(response)) {
    if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
      return (value as { id: string }).id
    }
  }
  return undefined
}

type SentListener = (mutation: PendingMutation, response: unknown) => void
const sentListeners = new Set<SentListener>()

/** After a queued mutation reached the server (e.g. the expense list reloads) */
export function onMutationSent(listener: SentListener): () => void {
  sentListeners.add(listener)
  return () => sentListeners.delete(listener)
}

export const offlineQueue = createQueue(
  typeof indexedDB === 'undefined' ? memoryStore() : idbStore(),
  {
    send: (mutation) =>
      request(mutation.method, mutation.url, { token: mutation.token, body: mutation.body }),
    classify,
    createdId: (_mutation, response) => createdIdOf(response),
    onSent: (mutation, response) => {
      for (const listener of sentListeners) listener(mutation, response)
    },
  },
)

let loaded: Promise<void> | null = null
const ensureLoaded = () => {
  loaded ??= offlineQueue.load().catch(() => undefined)
  return loaded
}

/** Sends what is waiting, if the connection is up */
export async function replayNow(): Promise<void> {
  await ensureLoaded()
  if (offlineQueue.count() === 0 || !isOnline()) return
  const result = await offlineQueue.replay()
  if (result.status === 'offline') reportNetworkFailure()
}

let started = false

/** Once, from the app shell: load the queue, replay now and whenever the connection returns */
export function startSync(): void {
  if (started || typeof window === 'undefined') return
  started = true
  void ensureLoaded().then(async () => {
    if (offlineQueue.count() > 0) await probe()
    await replayNow()
  })
  onBackOnline(() => void replayNow())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void replayNow()
  })
}

const subscribe = (listener: () => void) => offlineQueue.subscribe(listener)

/** The waiting mutations, oldest first */
export function usePendingMutations(): readonly PendingMutation[] {
  return useSyncExternalStore(subscribe, offlineQueue.list, offlineQueue.list)
}
