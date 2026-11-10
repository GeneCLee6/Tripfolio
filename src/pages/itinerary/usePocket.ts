import { useMemo } from 'react'
import type { Place, WishlistItemView } from '../../../shared/api/types.ts'
import type { WishlistStatus } from '../../../shared/schema/index.ts'
import { wishlistApi } from '../../lib/api.ts'
import { useResource } from '../../lib/hooks.ts'
import { pocketApi } from '../../lib/itinerary/pocket.ts'

// The itinerary page's pocket list (e2-t07) and the status of every pick (e5-t05: the done mark on
// a stop that came from one). Loaded with the page and again after anything that can change them
// (a drop, a deleted stop: the server puts the item back in the pocket list).

export interface PocketData {
  items: WishlistItemView[]
  places: Place[]
  /** Every pick's status, by id (the stops that came from one) */
  statuses: ReadonlyMap<string, WishlistStatus>
}

export function usePocket(tripId: string) {
  const resource = useResource<PocketData>(`pocket:${tripId}`, async (signal) => {
    const [pocket, wishlist] = await Promise.all([
      pocketApi.get(tripId, signal),
      wishlistApi.list(tripId, signal),
    ])
    return {
      items: pocket.items,
      places: pocket.places,
      statuses: new Map(wishlist.items.map((item) => [item.id, item.status])),
    }
  })
  const data = resource.status === 'ready' ? resource.data : null
  const byId = useMemo(
    () => ({
      items: new Map((data?.items ?? []).map((item) => [item.id, item])),
      places: new Map((data?.places ?? []).map((place) => [place.id, place])),
    }),
    [data],
  )
  return { resource, data, byId, reload: resource.reload }
}
