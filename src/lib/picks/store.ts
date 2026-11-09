import { useEffect, useState, useSyncExternalStore } from 'react'
import type {
  DayWithStops,
  Place,
  WishlistClaim,
  WishlistItemView,
} from '../../../shared/api/types.ts'
import type {
  WishlistClaimPatch,
  WishlistItemPatch,
} from '../../../shared/schema/index.ts'
import {
  itineraryApi,
  wishlistApi,
  type WishlistClaimCreateBody,
  type WishlistCreateBody,
} from '../api.ts'

// The picks page's data (e5-t02..t04): wishlist items, the days (for 「Day N」 and scheduling) and
// the trip's places (for the place picker), kept in a small store so the card wall and whatever the
// detail pane shows (it renders outside the page's tree) read the same, current state. Every write
// goes to the API first and the store takes the server's answer; a vote is drawn at once and put
// back if the call fails.

export interface PicksState {
  status: 'loading' | 'ready' | 'error'
  error: unknown
  items: WishlistItemView[]
  days: DayWithStops[]
  places: Place[]
}

type Listener = () => void

export class PicksStore {
  readonly tripId: string
  private state: PicksState = { status: 'loading', error: null, items: [], days: [], places: [] }
  private listeners = new Set<Listener>()

  constructor(tripId: string) {
    this.tripId = tripId
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get = (): PicksState => this.state

  private set(patch: Partial<PicksState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  private replaceItem(item: WishlistItemView): void {
    const exists = this.state.items.some((other) => other.id === item.id)
    this.set({
      items: exists
        ? this.state.items.map((other) => (other.id === item.id ? item : other))
        : [...this.state.items, item],
    })
  }

  private updateItem(id: string, change: (item: WishlistItemView) => WishlistItemView): void {
    this.set({ items: this.state.items.map((item) => (item.id === id ? change(item) : item)) })
  }

  item(id: string): WishlistItemView | undefined {
    return this.state.items.find((item) => item.id === id)
  }

  async load(signal?: AbortSignal): Promise<void> {
    try {
      const [wishlist, days, places] = await Promise.all([
        wishlistApi.list(this.tripId, signal),
        itineraryApi.listDays(this.tripId, signal),
        itineraryApi.listPlaces(this.tripId, signal),
      ])
      if (signal?.aborted) return
      this.set({
        status: 'ready',
        error: null,
        items: wishlist.items,
        days: days.days,
        places: places.places,
      })
    } catch (error) {
      if (signal?.aborted) return
      this.set({ status: 'error', error })
    }
  }

  addPlace(place: Place): void {
    if (this.state.places.some((other) => other.id === place.id)) return
    this.set({ places: [...this.state.places, place] })
  }

  async create(body: WishlistCreateBody): Promise<WishlistItemView> {
    const { item } = await wishlistApi.create(this.tripId, body)
    this.replaceItem(item)
    return item
  }

  async patch(id: string, patch: WishlistItemPatch): Promise<WishlistItemView> {
    const { item } = await wishlistApi.patch(this.tripId, id, patch)
    this.replaceItem(item)
    return item
  }

  async remove(id: string): Promise<void> {
    await wishlistApi.remove(this.tripId, id)
    this.set({ items: this.state.items.filter((item) => item.id !== id) })
  }

  /** Optimistic: drawn at once, put back when the call fails (and the error rethrown) */
  async vote(id: string, memberId: string, on: boolean): Promise<void> {
    const before = this.item(id)
    if (!before) return
    this.updateItem(id, (item) => ({
      ...item,
      votes: on
        ? item.votes.includes(memberId)
          ? item.votes
          : [...item.votes, memberId]
        : item.votes.filter((voter) => voter !== memberId),
    }))
    try {
      const { item } = await wishlistApi.vote(this.tripId, id, on)
      this.replaceItem(item)
    } catch (error) {
      this.updateItem(id, (item) => ({ ...item, votes: before.votes }))
      throw error
    }
  }

  async addClaim(id: string, body: WishlistClaimCreateBody): Promise<WishlistClaim> {
    const { claim } = await wishlistApi.addClaim(this.tripId, id, body)
    this.updateItem(id, (item) => ({ ...item, claims: [...item.claims, claim] }))
    return claim
  }

  async patchClaim(id: string, claimId: string, patch: WishlistClaimPatch): Promise<void> {
    const { claim } = await wishlistApi.patchClaim(this.tripId, id, claimId, patch)
    this.updateItem(id, (item) => ({
      ...item,
      claims: item.claims.map((other) => (other.id === claim.id ? claim : other)),
    }))
  }

  async removeClaim(id: string, claimId: string): Promise<void> {
    await wishlistApi.removeClaim(this.tripId, id, claimId)
    this.updateItem(id, (item) => ({
      ...item,
      claims: item.claims.filter((claim) => claim.id !== claimId),
    }))
  }

  /** Creates the stop on `dayId`; the new stop joins that day locally (for 「Day N」) */
  async schedule(id: string, dayId: string): Promise<void> {
    const { item, stop } = await wishlistApi.schedule(this.tripId, id, { dayId })
    this.set({
      days: this.state.days.map((day) =>
        day.id === stop.dayId ? { ...day, stops: [...day.stops, stop] } : day,
      ),
    })
    this.replaceItem(item)
  }

  /** Deletes the item's stop and puts it back in the pocket list */
  async unschedule(id: string): Promise<void> {
    const { item, deletedStopId } = await wishlistApi.unschedule(this.tripId, id)
    if (deletedStopId) {
      this.set({
        days: this.state.days.map((day) => ({
          ...day,
          stops: day.stops.filter((stop) => stop.id !== deletedStopId),
        })),
      })
    }
    this.replaceItem(item)
  }
}

/** The page's store for `tripId`, loaded on mount */
export function usePicksStore(tripId: string): PicksStore {
  const [store, setStore] = useState(() => new PicksStore(tripId))
  if (store.tripId !== tripId) setStore(new PicksStore(tripId))
  useEffect(() => {
    const controller = new AbortController()
    void store.load(controller.signal)
    return () => controller.abort()
  }, [store])
  return store
}

/** The store's current state; re-renders on every change */
export function usePicksState(store: PicksStore): PicksState {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
