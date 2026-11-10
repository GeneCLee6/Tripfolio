import { useEffect, useSyncExternalStore } from 'react'
import type { DayCheckout, DayLodgingSummary, Lodging } from '../../../shared/api/bookings.ts'
import { bookingsApi } from './api.ts'

// What the itinerary's 「今晚住」 lines share (e4-t02): the trip's lodgings (for the check-in time,
// price and campsite facilities the days response does not carry) and, after a lodging is saved
// from a line, each day's fresh `lodging` / `checkout` (the itinerary page keeps its own days and is
// not told; these override them until the page is left). One fetch per trip, however many lines.

export interface DayLodging {
  lodging: DayLodgingSummary | null
  checkout: DayCheckout | null
}

interface TripEntry {
  lodgings: Lodging[] | null
  /** Per dayId, once a write here re-read the days */
  days: Map<string, DayLodging> | null
  loading: Promise<void> | null
  users: number
}

const EMPTY: TripEntry = { lodgings: null, days: null, loading: null, users: 0 }
const entries = new Map<string, TripEntry>()
const listeners = new Set<() => void>()

const emit = () => {
  for (const listener of listeners) listener()
}

const entryOf = (tripId: string): TripEntry => entries.get(tripId) ?? EMPTY

function update(tripId: string, change: Partial<TripEntry>): void {
  entries.set(tripId, { ...entryOf(tripId), ...change })
  emit()
}

/** Loads the trip's lodgings once (a failure leaves the lines with the days' summary only) */
export function ensureLodgings(tripId: string): Promise<void> {
  const entry = entryOf(tripId)
  if (entry.lodgings || entry.loading) return entry.loading ?? Promise.resolve()
  const loading = bookingsApi
    .listLodgings(tripId)
    .then((res) => update(tripId, { lodgings: res.lodgings, loading: null }))
    .catch(() => update(tripId, { loading: null }))
  update(tripId, { loading })
  return loading
}

/** After a lodging write: the lodgings and every day's lodging summary again */
export async function refreshLodgings(tripId: string): Promise<void> {
  const [lodgings, days] = await Promise.all([
    bookingsApi.listLodgings(tripId),
    bookingsApi.listDays(tripId),
  ])
  update(tripId, {
    lodgings: lodgings.lodgings,
    days: new Map(
      days.days.map((day) => [day.id, { lodging: day.lodging ?? null, checkout: day.checkout ?? null }]),
    ),
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * The trip's lodging data for one line. Lines count themselves in; when the last one goes (the
 * itinerary page is left) the overrides are dropped, so the next visit starts from its own fetch.
 */
export function useTripLodgings(tripId: string | null): TripEntry {
  const snapshot = () => (tripId ? entryOf(tripId) : EMPTY)
  const entry = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (!tripId) return
    const current = entryOf(tripId)
    entries.set(tripId, { ...current, users: current.users + 1 })
    void ensureLodgings(tripId)
    return () => {
      const now = entryOf(tripId)
      entries.set(tripId, { ...now, users: now.users - 1 })
      // A day switch unmounts one line and mounts the next in the same commit: wait a tick
      setTimeout(() => {
        if (entryOf(tripId).users <= 0) entries.delete(tripId)
      }, 0)
    }
  }, [tripId])
  return entry
}

/** Puts lodgings in without a fetch (a page that already has them; tests) */
export function primeLodgings(tripId: string, lodgings: Lodging[]): void {
  update(tripId, { lodgings })
}

/** Tests: forget everything */
export function resetLodgingStore(): void {
  entries.clear()
  emit()
}
