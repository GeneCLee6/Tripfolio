import type {
  AuthMeResponse,
  AuthTripsResponse,
  MemberLinkResponse,
} from '../../../shared/api/auth.ts'
import { MEMBER_TOKENS_HEADER } from '../../../shared/api/types.ts'
import { ApiError, request } from '../api.ts'
import { getToken, type TokenMap } from '../tokens.ts'

// The optional Google sign-in endpoints (e1-t06, worker/auth-google.ts). The session is an
// HttpOnly cookie the browser sends by itself (same origin); memberTokens still go as Bearer.

/** A full-page navigation, not a fetch: the Worker answers with a 302 to Google */
export const GOOGLE_START_PATH = '/api/auth/google/start'

function memberToken(tripId: string): string {
  const token = getToken(tripId)
  if (!token) throw new ApiError(401, 'unauthorized', 'no member token on this device')
  return token
}

const linkPath = (tripId: string) => `/api/trips/${encodeURIComponent(tripId)}/members/me/link`

export const authApi = {
  me: (signal?: AbortSignal) => request<AuthMeResponse>('GET', '/api/auth/me', { signal }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  /** The account's linked trips; mints a memberToken for each trip `tokens` holds none for */
  trips: (tokens: string[]) =>
    request<AuthTripsResponse>('POST', '/api/auth/trips', {
      headers: tokens.length > 0 ? { [MEMBER_TOKENS_HEADER]: tokens.join(',') } : {},
    }),
  getLink: (tripId: string, signal?: AbortSignal) =>
    request<MemberLinkResponse>('GET', linkPath(tripId), { token: memberToken(tripId), signal }),
  link: (tripId: string) =>
    request<MemberLinkResponse>('POST', linkPath(tripId), { token: memberToken(tripId) }),
  unlink: (tripId: string) =>
    request<MemberLinkResponse>('DELETE', linkPath(tripId), { token: memberToken(tripId) }),
}

/** The token map after POST /api/auth/trips: every minted token is stored under its trip (the
 * server only mints when the device sent no valid token for that trip) */
export function mergedTokens(tokens: TokenMap, response: AuthTripsResponse): TokenMap {
  const out: TokenMap = { ...tokens }
  for (const entry of response.trips) {
    if (entry.memberToken) out[entry.trip.id] = entry.memberToken
  }
  return out
}
