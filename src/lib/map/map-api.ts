import type { RouteRequest, RoutesRequest, RoutesResponse } from '../../../shared/api/geo.ts'
import type { DaysResponse, Place, Rev } from '../../../shared/api/types.ts'
import type { PlaceCreate } from '../../../shared/schema/index.ts'
import { ApiError, request } from '../api.ts'
import { getToken } from '../tokens.ts'

// The calls the map page needs (GET /days, GET /places, POST /places, POST /geo/routes). B1 adds
// the same functions with the same signatures to src/lib/api.ts (`itineraryApi`); this copy keeps
// the two branches from editing the same lines. Once both are on main, point the map at
// `itineraryApi` and delete this file.

/** The place create body: the schema's input, so the defaults stay optional */
export type MapPlaceCreateBody = Partial<PlaceCreate> &
  Pick<PlaceCreate, 'nameLocal' | 'lat' | 'lng'>

function tokenFor(tripId: string): string {
  const token = getToken(tripId)
  if (!token) throw new ApiError(401, 'unauthorized', 'no member token on this device')
  return token
}

const tripPath = (tripId: string) => `/api/trips/${encodeURIComponent(tripId)}`

export const mapApi = {
  listDays(tripId: string, signal?: AbortSignal): Promise<DaysResponse> {
    return request('GET', `${tripPath(tripId)}/days`, { token: tokenFor(tripId), signal })
  },

  listPlaces(tripId: string, signal?: AbortSignal): Promise<Rev & { places: Place[] }> {
    return request('GET', `${tripPath(tripId)}/places`, { token: tokenFor(tripId), signal })
  },

  createPlace(tripId: string, body: MapPlaceCreateBody): Promise<Rev & { place: Place }> {
    return request('POST', `${tripPath(tripId)}/places`, { token: tokenFor(tripId), body })
  },

  /** POST /geo/routes: at most 30 drive / walk / cycle legs, answered in order */
  geoRoutes(tripId: string, legs: RouteRequest[], signal?: AbortSignal): Promise<RoutesResponse> {
    return request('POST', `${tripPath(tripId)}/geo/routes`, {
      token: tokenFor(tripId),
      body: { legs } satisfies RoutesRequest,
      signal,
    })
  },
}
