import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { Attachment } from '../../../shared/api/media.ts'
import { getToken } from '../tokens.ts'
import { mediaApi } from '../upload/api.ts'
import { photosByStop, sortPhotos } from './albums.ts'

// The trip's photo list, shared by the photos page and the itinerary's stop cards (e6-t03/t04):
// fetched once per trip and kept here, so every card reads the same list instead of asking the
// Worker per stop. The photos page writes its changes (uploads, moves, deletes) back with `set`.

export type TripPhotosState =
  | { status: 'idle' | 'loading'; photos: null }
  | { status: 'ready'; photos: Attachment[] }
  | { status: 'error'; photos: null; error: unknown }

interface Entry {
  state: TripPhotosState
  loadedAt: number
  inflight: Promise<void> | null
  listeners: Set<() => void>
}

const IDLE: TripPhotosState = { status: 'idle', photos: null }
/** A list older than this is fetched again when a card or the page mounts */
const STALE_MS = 60_000

const entries = new Map<string, Entry>()

function entry(tripId: string): Entry {
  let e = entries.get(tripId)
  if (!e) {
    e = { state: IDLE, loadedAt: 0, inflight: null, listeners: new Set() }
    entries.set(tripId, e)
  }
  return e
}

function emit(e: Entry, state: TripPhotosState) {
  e.state = state
  for (const listener of e.listeners) listener()
}

export const tripPhotos = {
  get(tripId: string): TripPhotosState {
    return entries.get(tripId)?.state ?? IDLE
  },

  /** Replace the list (after an upload, a move or a delete); kept in capture order */
  set(tripId: string, photos: readonly Attachment[]): void {
    const e = entry(tripId)
    e.loadedAt = Date.now()
    emit(e, { status: 'ready', photos: sortPhotos(photos) })
  },

  /** Fetch the list unless a fresh one is here (`force` always fetches) */
  load(tripId: string, { force = false }: { force?: boolean } = {}): Promise<void> {
    const e = entry(tripId)
    if (e.inflight) return e.inflight
    if (!force && e.state.status === 'ready' && Date.now() - e.loadedAt < STALE_MS)
      return Promise.resolve()
    if (!getToken(tripId)) return Promise.resolve()
    if (e.state.status !== 'ready') emit(e, { status: 'loading', photos: null })
    e.inflight = mediaApi
      .list(tripId, { kind: 'photo' })
      .then(
        (response) => {
          e.loadedAt = Date.now()
          emit(e, { status: 'ready', photos: sortPhotos(response.attachments) })
        },
        (error: unknown) => {
          // Keep a list we already have; otherwise say it failed
          if (e.state.status !== 'ready') emit(e, { status: 'error', photos: null, error })
        },
      )
      .finally(() => {
        e.inflight = null
      })
    return e.inflight
  },

  subscribe(tripId: string, listener: () => void): () => void {
    const e = entry(tripId)
    e.listeners.add(listener)
    return () => e.listeners.delete(listener)
  },

  /** Tests */
  reset(): void {
    entries.clear()
  },
}

/** The trip's photo list (loaded on first use) */
export function useTripPhotos(tripId: string): TripPhotosState {
  const state = useSyncExternalStore(
    (listener) => tripPhotos.subscribe(tripId, listener),
    () => tripPhotos.get(tripId),
    () => tripPhotos.get(tripId),
  )
  useEffect(() => {
    void tripPhotos.load(tripId)
  }, [tripId])
  return state
}

const NO_PHOTOS: ReadonlyMap<string, Attachment[]> = new Map()

/** The trip's photos per stop id (for the stop cards) */
export function usePhotosByStop(tripId: string): ReadonlyMap<string, Attachment[]> {
  const state = useTripPhotos(tripId)
  return useMemo(() => (state.photos ? photosByStop(state.photos) : NO_PHOTOS), [state.photos])
}
