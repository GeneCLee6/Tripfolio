import { useEffect, useRef, useState } from 'react'
import type { TripEvent, WelcomeMessage } from '../../../shared/protocol.ts'
import { getToken } from '../tokens.ts'
import { TripSocket, type SyncStatus, type TripSocketOptions } from './TripSocket.ts'

/** What a page hears from the trip's live sync */
export type TripSyncEvent =
  | { type: 'event'; event: TripEvent }
  | { type: 'resync'; rev: number | null }
  | { type: 'closed'; code: number }

/**
 * Opens a TripSocket for the trip and passes what it hears to `handler`; returns a stop function.
 * The trip layout keeps one per trip (TripSyncContext.tsx); pages listen with useTripEvents().
 */
export function startTripSync(
  tripId: string,
  handler: (event: TripSyncEvent) => void,
  onStatus: (status: SyncStatus) => void,
  options: Partial<TripSocketOptions> = {},
  onWelcome?: (welcome: WelcomeMessage) => void,
): () => void {
  const socket = new TripSocket(tripId, { token: () => getToken(tripId), ...options })
  socket.on('event', (event) => handler({ type: 'event', event }))
  socket.on('resync', ({ rev }) => handler({ type: 'resync', rev }))
  socket.on('closed', ({ code }) => handler({ type: 'closed', code }))
  socket.on('status', onStatus)
  if (onWelcome) socket.on('welcome', onWelcome)
  socket.connect()
  return () => socket.close()
}

export function useTripSync(
  tripId: string | null | undefined,
  handler: (event: TripSyncEvent) => void,
): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>('offline')
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(() => {
    if (!tripId) return
    const stop = startTripSync(tripId, (event) => latest.current(event), setStatus)
    return () => {
      stop()
      setStatus('offline')
    }
  }, [tripId])
  return status
}
