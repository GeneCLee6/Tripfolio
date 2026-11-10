import { createContext, useContext, useEffect, useRef } from 'react'
import type { SyncStatus } from './TripSocket.ts'
import type { TripSyncEvent } from './useTripSync.ts'

// The trip's one live sync connection as pages see it (e2-t08b): TripSyncProvider
// (TripSyncContext.tsx) fills it; pages listen with useTripEvents().

export type TripSyncListener = (event: TripSyncEvent, memberId: string | null) => void

export interface TripSyncValue {
  status: SyncStatus
  /** This member, once the server said hello; null before */
  memberId: string | null
  subscribe(listener: TripSyncListener): () => void
}

export const TripSyncContext = createContext<TripSyncValue | null>(null)

/** The trip's live sync (null outside a TripSyncProvider: tests, pages without a trip) */
export const useTripSyncContext = (): TripSyncValue | null => useContext(TripSyncContext)

/**
 * Calls `handler` for what the trip's socket hears. The handler may change on every render (the
 * latest one is called); `memberId` is passed along so the handler can skip own events.
 */
export function useTripEvents(handler: TripSyncListener): void {
  const subscribe = useTripSyncContext()?.subscribe
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(() => {
    if (!subscribe) return
    return subscribe((event, memberId) => latest.current(event, memberId))
  }, [subscribe])
}
