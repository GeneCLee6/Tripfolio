import type { BookingsResponse, LodgingsResponse } from '../../../shared/api/bookings.ts'
import type {
  DaysResponse,
  Place,
  PlaceRefsResponse,
  Rev,
  WishlistResponse,
} from '../../../shared/api/types.ts'
import type { PlacePatch } from '../../../shared/schema/index.ts'
import { ApiError, request } from '../api.ts'
import { getToken } from '../tokens.ts'

// The typed client for the place library (worker/trips/places.ts, e3-t05). Kept apart from
// src/lib/api.ts so this page can grow on its own; it reuses the same `request` and token store.

function tokenFor(tripId: string): string {
  const token = getToken(tripId)
  if (!token) throw new ApiError(401, 'unauthorized', 'no member token on this device')
  return token
}

const tripPath = (tripId: string) => `/api/trips/${encodeURIComponent(tripId)}`
const placePath = (tripId: string, placeId: string) =>
  `${tripPath(tripId)}/places/${encodeURIComponent(placeId)}`

/** What a merge moved from the duplicate to the target (rows of each kind) */
export interface MergeRepointed {
  stops: number
  wishlistItems: number
  lodgings: number
  attachments: number
  bookings: number
}

/** POST …/places/:pid/merge-into/:targetId */
export interface MergeResponse extends Rev {
  place: Place
  repointed: MergeRepointed
}

export const placesApi = {
  list(tripId: string, signal?: AbortSignal): Promise<Rev & { places: Place[] }> {
    return request('GET', `${tripPath(tripId)}/places`, { token: tokenFor(tripId), signal })
  },

  patch(tripId: string, placeId: string, body: PlacePatch): Promise<Rev & { place: Place }> {
    return request('PATCH', placePath(tripId, placeId), { token: tokenFor(tripId), body })
  },

  /** DELETE: whatever pointed at it loses the place (the API clears it, it does not refuse) */
  remove(tripId: string, placeId: string): Promise<Rev & { ok: true }> {
    return request('DELETE', placePath(tripId, placeId), { token: tokenFor(tripId) })
  },

  refs(tripId: string, placeId: string, signal?: AbortSignal): Promise<PlaceRefsResponse> {
    return request('GET', `${placePath(tripId, placeId)}/refs`, {
      token: tokenFor(tripId),
      signal,
    })
  },

  /** Re-points everything at `placeId` to `targetId`, then deletes `placeId` */
  mergeInto(tripId: string, placeId: string, targetId: string): Promise<MergeResponse> {
    return request(
      'POST',
      `${placePath(tripId, placeId)}/merge-into/${encodeURIComponent(targetId)}`,
      { token: tokenFor(tripId) },
    )
  },

  // The lists the reference counts come from

  days(tripId: string, signal?: AbortSignal): Promise<DaysResponse> {
    return request('GET', `${tripPath(tripId)}/days`, { token: tokenFor(tripId), signal })
  },

  wishlist(tripId: string, signal?: AbortSignal): Promise<WishlistResponse> {
    return request('GET', `${tripPath(tripId)}/wishlist`, { token: tokenFor(tripId), signal })
  },

  lodgings(tripId: string, signal?: AbortSignal): Promise<LodgingsResponse> {
    return request('GET', `${tripPath(tripId)}/lodgings`, { token: tokenFor(tripId), signal })
  },

  bookings(tripId: string, signal?: AbortSignal): Promise<BookingsResponse> {
    return request('GET', `${tripPath(tripId)}/bookings`, { token: tokenFor(tripId), signal })
  },
}
