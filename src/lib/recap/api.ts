import type { RecapPutResponse, RecapResponse } from '../../../shared/api/share.ts'
import { ApiError, request } from '../api.ts'
import { getToken } from '../tokens.ts'

// Typed calls for recap mode (worker/trips/recap.ts, e8-t04).

function tokenFor(tripId: string): string {
  const token = getToken(tripId)
  if (!token) throw new ApiError(401, 'unauthorized', 'no member token on this device')
  return token
}

const base = (tripId: string) => `/api/trips/${encodeURIComponent(tripId)}`

export const recapApi = {
  get(tripId: string, signal?: AbortSignal): Promise<RecapResponse> {
    return request('GET', `${base(tripId)}/recap`, { token: tokenFor(tripId), signal })
  },
  /** A blank body clears the day's recap */
  put(tripId: string, dayId: string, body: string): Promise<RecapPutResponse> {
    return request('PUT', `${base(tripId)}/days/${encodeURIComponent(dayId)}/recap`, {
      token: tokenFor(tripId),
      body: { body },
    })
  },
}
