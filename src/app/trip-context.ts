import { createContext, useContext, type ReactNode } from 'react'
import type { Member, Trip } from '../../shared/api/types.ts'

// What the trip layout hands its pages: the loaded trip, who "I" am in it, the members, and the
// detail pane (the right column on desktop, a Sheet elsewhere).

export interface TripContextValue {
  trip: Trip
  me: Member
  members: Member[]
  /** Fetch the trip again (after a write elsewhere) */
  reload: () => void
  /** Replace the trip after a write that returned it (PATCH) */
  setTrip: (trip: Trip) => void
}

export const TripContext = createContext<TripContextValue | null>(null)

export function useTripContext(): TripContextValue {
  const value = useContext(TripContext)
  if (!value) throw new Error('useTripContext() needs the trip layout above it')
  return value
}

export interface Detail {
  /** Heading of the pane or Sheet (already translated) */
  title: string
  content: ReactNode
}

export interface DetailPaneValue {
  detail: Detail | null
  /** Show something in the detail pane; null closes it */
  setDetail: (detail: Detail | null) => void
}

export const DetailPaneContext = createContext<DetailPaneValue>({
  detail: null,
  setDetail: () => {},
})

/** The detail pane of the trip layout (a no-op outside one) */
export const useDetailPane = (): DetailPaneValue => useContext(DetailPaneContext)
