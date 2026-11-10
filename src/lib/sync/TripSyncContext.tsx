import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TripSyncContext, type TripSyncListener, type TripSyncValue } from './trip-sync-context.ts'
import type { SyncStatus } from './TripSocket.ts'
import { startTripSync } from './useTripSync.ts'

// One live sync connection per open trip (e2-t08b): the trip layout mounts TripSyncProvider, and
// every page under it listens with useTripEvents() (trip-sync-context.ts) instead of opening its
// own socket. The provider also knows who "I" am on the socket (the welcome's memberId), so pages
// can skip the echoes of their own writes.

export function TripSyncProvider({ tripId, children }: { tripId: string; children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus>('offline')
  const [memberId, setMemberId] = useState<string | null>(null)
  const listeners = useRef(new Set<TripSyncListener>())
  // Read synchronously: the welcome's catch-up events arrive before React re-renders
  const me = useRef<string | null>(null)

  useEffect(() => {
    const stop = startTripSync(
      tripId,
      (event) => {
        for (const listener of [...listeners.current]) listener(event, me.current)
      },
      setStatus,
      undefined,
      (welcome) => {
        me.current = welcome.memberId
        setMemberId(welcome.memberId)
      },
    )
    return () => {
      stop()
      setStatus('offline')
    }
  }, [tripId])

  const subscribe = useCallback((listener: TripSyncListener) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])
  const value = useMemo<TripSyncValue>(
    () => ({ status, memberId, subscribe }),
    [status, memberId, subscribe],
  )
  return <TripSyncContext.Provider value={value}>{children}</TripSyncContext.Provider>
}
