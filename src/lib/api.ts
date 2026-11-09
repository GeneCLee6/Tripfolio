import {
  MEMBER_TOKENS_HEADER,
  type ApiErrorBody,
  type CreateInviteResponse,
  type CreateTripResponse,
  type Invite,
  type JoinPreviewResponse,
  type Member,
  type MemberTokenResponse,
  type Rev,
  type Trip,
  type TripDetailResponse,
  type TripListResponse,
} from '../../shared/api/types.ts'
import type {
  JoinBody,
  MemberCreate,
  MemberPatch,
  TripCreate,
  TripPatch,
} from '../../shared/schema/index.ts'
import type {
  DayPatch,
  LegOverrideInput,
  PlaceCreate,
  StopCreate,
  StopMove,
  StopPatch,
} from '../../shared/schema/index.ts'
import type {
  Day,
  DaysResponse,
  LegOverride,
  Place,
  Stop,
} from '../../shared/api/types.ts'
import type {
  GeoParseRequest,
  GeoParseResponse,
  GeoPoint,
  GeoSearchResponse,
  RouteRequest,
  RoutesRequest,
  RoutesResponse,
} from '../../shared/api/geo.ts'
import { getToken, pruneTokens, setToken, tokensForList } from './tokens.ts'

// The typed client for the Worker's REST API (worker/app.ts). Request bodies are the zod input
// types from shared/schema, responses the shapes in shared/api/types.ts. Every /api/trips/:id call
// sends the trip's memberToken as a Bearer token; errors become ApiError.

/** A failed API call: the Worker's `{ error: { code, message } }`, or `network` when it never answered */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError

type Fetch = typeof fetch
let fetchImpl: Fetch | null = null

/** Tests swap the transport; null goes back to the global fetch */
export function setFetch(next: Fetch | null): void {
  fetchImpl = next
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== 'object' || !('error' in value)) return false
  const error = (value as { error: unknown }).error
  return (
    !!error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
  )
}

export interface RequestOptions {
  body?: unknown
  /** The memberToken for this call (Authorization: Bearer) */
  token?: string | null
  headers?: Record<string, string>
  signal?: AbortSignal
}

export async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers.authorization = `Bearer ${options.token}`
  let response: Response
  try {
    response = await (fetchImpl ?? fetch)(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'network', error instanceof Error ? error.message : String(error))
  }
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!response.ok) {
    if (isErrorBody(data)) {
      throw new ApiError(response.status, data.error.code, data.error.message, data.error.details)
    }
    throw new ApiError(response.status, 'http_error', `HTTP ${response.status}`)
  }
  return data as T
}

/** The token for a trip, or an `unauthorized` ApiError when this device has none */
function tokenFor(tripId: string): string {
  const token = getToken(tripId)
  if (!token) throw new ApiError(401, 'unauthorized', 'no member token on this device')
  return token
}

const tripPath = (tripId: string) => `/api/trips/${encodeURIComponent(tripId)}`

/** The create body: the schema's input, so the defaults stay optional */
export type TripCreateBody = Partial<TripCreate> &
  Pick<TripCreate, 'name' | 'startDate' | 'endDate' | 'tz' | 'owner'>

export const api = {
  /** POST /api/trips: creates the trip and its owner; remembers the returned memberToken */
  async createTrip(body: TripCreateBody): Promise<CreateTripResponse> {
    const response = await request<CreateTripResponse>('POST', '/api/trips', { body })
    setToken(response.trip.id, response.memberToken)
    return response
  },

  /** GET /api/trips with every token on this device; drops the tokens the server no longer knows */
  async listTrips(signal?: AbortSignal): Promise<TripListResponse> {
    const sent = tokensForList()
    if (sent.length === 0) return { trips: [] }
    const response = await request<TripListResponse>('GET', '/api/trips', {
      headers: { [MEMBER_TOKENS_HEADER]: sent.map((entry) => entry.token).join(',') },
      signal,
    })
    pruneTokens(sent, response)
    return response
  },

  async getTrip(tripId: string, signal?: AbortSignal): Promise<TripDetailResponse> {
    return request('GET', tripPath(tripId), { token: tokenFor(tripId), signal })
  },

  async patchTrip(tripId: string, patch: TripPatch): Promise<Rev & { trip: Trip }> {
    return request('PATCH', tripPath(tripId), { token: tokenFor(tripId), body: patch })
  },

  /** GET /api/join/:token: who can be claimed (no auth) */
  previewJoin(inviteToken: string, signal?: AbortSignal): Promise<JoinPreviewResponse> {
    return request('GET', `/api/join/${encodeURIComponent(inviteToken)}`, { signal })
  },

  /** POST /api/join/:token: claim a member or create one; remembers the returned memberToken */
  async join(inviteToken: string, body: JoinBody): Promise<MemberTokenResponse> {
    const response = await request<MemberTokenResponse>(
      'POST',
      `/api/join/${encodeURIComponent(inviteToken)}`,
      { body },
    )
    setToken(response.trip.id, response.memberToken)
    return response
  },

  // ---- members and invites (e1-t03) ----

  /** POST /api/trips/:id/members (owner): someone not on the app yet, or a viewer */
  createMember(
    tripId: string,
    body: Partial<MemberCreate> & Pick<MemberCreate, 'name' | 'color'>,
  ): Promise<Rev & { member: Member }> {
    return request('POST', `${tripPath(tripId)}/members`, { token: tokenFor(tripId), body })
  },

  /** PATCH /api/trips/:id/members/:mid: owner, or a member changing their own name/colour */
  patchMember(tripId: string, memberId: string, patch: MemberPatch): Promise<Rev & { member: Member }> {
    return request('PATCH', `${tripPath(tripId)}/members/${encodeURIComponent(memberId)}`, {
      token: tokenFor(tripId),
      body: patch,
    })
  },

  /** DELETE /api/trips/:id/members/:mid (owner): also revokes that member's devices */
  deleteMember(tripId: string, memberId: string): Promise<Rev & { ok: true }> {
    return request('DELETE', `${tripPath(tripId)}/members/${encodeURIComponent(memberId)}`, {
      token: tokenFor(tripId),
    })
  },

  /** GET /api/trips/:id/invites (owner): the active invites, without their tokens */
  listInvites(tripId: string, signal?: AbortSignal): Promise<{ invites: Invite[] }> {
    return request('GET', `${tripPath(tripId)}/invites`, { token: tokenFor(tripId), signal })
  },

  /** POST /api/trips/:id/invites (owner): the only response that carries the invite token */
  createInvite(tripId: string): Promise<CreateInviteResponse> {
    return request('POST', `${tripPath(tripId)}/invites`, { token: tokenFor(tripId) })
  },

  /** DELETE /api/trips/:id/invites/:iid (owner) */
  revokeInvite(tripId: string, inviteId: string): Promise<Rev & { ok: true }> {
    return request('DELETE', `${tripPath(tripId)}/invites/${encodeURIComponent(inviteId)}`, {
      token: tokenFor(tripId),
    })
  },
}

// ---- itinerary, places and geo (B1: e2-t02, e2-t03, e3-t02) ----

/** The stop create body: the schema's input, so the defaults stay optional */
export type StopCreateBody = Partial<StopCreate> & Pick<StopCreate, 'dayId'>
/** The place create body: the schema's input, so the defaults stay optional */
export type PlaceCreateBody = Partial<PlaceCreate> &
  Pick<PlaceCreate, 'nameLocal' | 'lat' | 'lng'>

export interface GeoSearchParams {
  q: string
  lang: string
  bias?: GeoPoint | null
}

export const itineraryApi = {
  /** GET /api/trips/:id/days: days with nested stops (assigned by idx, unassigned last) and leg overrides */
  listDays(tripId: string, signal?: AbortSignal): Promise<DaysResponse> {
    return request('GET', `${tripPath(tripId)}/days`, { token: tokenFor(tripId), signal })
  },

  patchDay(tripId: string, dayId: string, patch: DayPatch): Promise<Rev & { day: Day }> {
    return request('PATCH', `${tripPath(tripId)}/days/${encodeURIComponent(dayId)}`, {
      token: tokenFor(tripId),
      body: patch,
    })
  },

  createStop(tripId: string, body: StopCreateBody): Promise<Rev & { stop: Stop }> {
    return request('POST', `${tripPath(tripId)}/stops`, { token: tokenFor(tripId), body })
  },

  patchStop(tripId: string, stopId: string, patch: StopPatch): Promise<Rev & { stop: Stop }> {
    return request('PATCH', `${tripPath(tripId)}/stops/${encodeURIComponent(stopId)}`, {
      token: tokenFor(tripId),
      body: patch,
    })
  },

  deleteStop(tripId: string, stopId: string): Promise<Rev & { ok: true }> {
    return request('DELETE', `${tripPath(tripId)}/stops/${encodeURIComponent(stopId)}`, {
      token: tokenFor(tripId),
    })
  },

  /** POST /stops/:sid/move: the only way to reorder or change day */
  moveStop(
    tripId: string,
    stopId: string,
    body: StopMove,
  ): Promise<Rev & { stop: Stop; renumbered: { id: string; order: number }[] }> {
    return request('POST', `${tripPath(tripId)}/stops/${encodeURIComponent(stopId)}/move`, {
      token: tokenFor(tripId),
      body,
    })
  },

  putLeg(
    tripId: string,
    fromStopId: string,
    toStopId: string,
    body: LegOverrideInput,
  ): Promise<Rev & { leg: LegOverride | null }> {
    return request(
      'PUT',
      `${tripPath(tripId)}/legs/${encodeURIComponent(fromStopId)}/${encodeURIComponent(toStopId)}`,
      { token: tokenFor(tripId), body },
    )
  },

  deleteLeg(tripId: string, fromStopId: string, toStopId: string): Promise<Rev & { ok: true }> {
    return request(
      'DELETE',
      `${tripPath(tripId)}/legs/${encodeURIComponent(fromStopId)}/${encodeURIComponent(toStopId)}`,
      { token: tokenFor(tripId) },
    )
  },

  listPlaces(tripId: string, signal?: AbortSignal): Promise<Rev & { places: Place[] }> {
    return request('GET', `${tripPath(tripId)}/places`, { token: tokenFor(tripId), signal })
  },

  createPlace(tripId: string, body: PlaceCreateBody): Promise<Rev & { place: Place }> {
    return request('POST', `${tripPath(tripId)}/places`, { token: tokenFor(tripId), body })
  },

  /** GET /geo/search (Photon, then Nominatim); 429 rate_limited carries details.retryAfterS */
  geoSearch(
    tripId: string,
    { q, lang, bias }: GeoSearchParams,
    signal?: AbortSignal,
  ): Promise<GeoSearchResponse> {
    const params = new URLSearchParams({ q, lang })
    if (bias) {
      params.set('lat', String(bias.lat))
      params.set('lng', String(bias.lng))
    }
    return request('GET', `${tripPath(tripId)}/geo/search?${params}`, {
      token: tokenFor(tripId),
      signal,
    })
  },

  /** POST /geo/parse: coordinates or a Google Maps link; 422 no_coordinates when there are none */
  geoParse(tripId: string, text: string): Promise<GeoParseResponse> {
    return request('POST', `${tripPath(tripId)}/geo/parse`, {
      token: tokenFor(tripId),
      body: { text } satisfies GeoParseRequest,
    })
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

// ---- share links (e1-t05) ----

import type { CreateShareResponse, Share } from '../../shared/api/types.ts'
import type { ShareOptions } from '../../shared/schema/share.ts'

export const sharesApi = {
  /** GET /api/trips/:id/shares (owner): the active share links, without their tokens */
  list(tripId: string, signal?: AbortSignal): Promise<{ shares: Share[] }> {
    return request('GET', `${tripPath(tripId)}/shares`, { token: tokenFor(tripId), signal })
  },

  /** POST /api/trips/:id/shares (owner): the only response that carries the share token */
  create(tripId: string, options: ShareOptions): Promise<CreateShareResponse> {
    return request('POST', `${tripPath(tripId)}/shares`, {
      token: tokenFor(tripId),
      body: { options },
    })
  },

  /** DELETE /api/trips/:id/shares/:sid (owner): the link stops working at once */
  revoke(tripId: string, shareId: string): Promise<Rev & { ok: true }> {
    return request('DELETE', `${tripPath(tripId)}/shares/${encodeURIComponent(shareId)}`, {
      token: tokenFor(tripId),
    })
  },
}

// ---- wishlist: must-eat / must-buy cards, votes, claims, scheduling (e5-t02..t04) ----

import type { OgResponse } from '../../shared/api/geo.ts'
import type {
  WishlistClaimResponse,
  WishlistItemResponse,
  WishlistResponse,
  WishlistScheduleResponse,
  WishlistUnscheduleResponse,
} from '../../shared/api/types.ts'
import type {
  WishlistClaimCreate,
  WishlistClaimPatch,
  WishlistItemCreate,
  WishlistItemPatch,
  WishlistSchedule,
} from '../../shared/schema/index.ts'


/** The item create body: the schema's input, so the defaults stay optional */
export type WishlistCreateBody = Partial<WishlistItemCreate> &
  Pick<WishlistItemCreate, 'category' | 'name'>
/** The claim create body: every field has a default */
export type WishlistClaimCreateBody = Partial<WishlistClaimCreate>

const wishPath = (tripId: string, itemId?: string) =>
  `${tripPath(tripId)}/wishlist${itemId ? `/${encodeURIComponent(itemId)}` : ''}`

export const wishlistApi = {
  /** GET /wishlist: items (not deleted) by order, with votes, claims and a place summary */
  list(tripId: string, signal?: AbortSignal): Promise<WishlistResponse> {
    return request('GET', wishPath(tripId), { token: tokenFor(tripId), signal })
  },

  create(tripId: string, body: WishlistCreateBody): Promise<WishlistItemResponse> {
    return request('POST', wishPath(tripId), { token: tokenFor(tripId), body })
  },

  patch(tripId: string, itemId: string, patch: WishlistItemPatch): Promise<WishlistItemResponse> {
    return request('PATCH', wishPath(tripId, itemId), { token: tokenFor(tripId), body: patch })
  },

  /** Soft delete; a scheduled item's stop stays (its wishlistItemId is cleared) */
  remove(tripId: string, itemId: string): Promise<Rev & { ok: true }> {
    return request('DELETE', wishPath(tripId, itemId), { token: tokenFor(tripId) })
  },

  /** The caller's own 「想去」: POST adds it, DELETE takes it back (both idempotent) */
  vote(tripId: string, itemId: string, on: boolean): Promise<WishlistItemResponse> {
    return request(on ? 'POST' : 'DELETE', `${wishPath(tripId, itemId)}/vote`, {
      token: tokenFor(tripId),
    })
  },

  addClaim(
    tripId: string,
    itemId: string,
    body: WishlistClaimCreateBody,
  ): Promise<WishlistClaimResponse> {
    return request('POST', `${wishPath(tripId, itemId)}/claims`, { token: tokenFor(tripId), body })
  },

  patchClaim(
    tripId: string,
    itemId: string,
    claimId: string,
    patch: WishlistClaimPatch,
  ): Promise<WishlistClaimResponse> {
    return request('PATCH', `${wishPath(tripId, itemId)}/claims/${encodeURIComponent(claimId)}`, {
      token: tokenFor(tripId),
      body: patch,
    })
  },

  removeClaim(tripId: string, itemId: string, claimId: string): Promise<Rev & { ok: true }> {
    return request('DELETE', `${wishPath(tripId, itemId)}/claims/${encodeURIComponent(claimId)}`, {
      token: tokenFor(tripId),
    })
  },

  /** Creates the stop on that day (appended unless afterStopId) and links the two */
  schedule(tripId: string, itemId: string, body: WishlistSchedule): Promise<WishlistScheduleResponse> {
    return request('POST', `${wishPath(tripId, itemId)}/schedule`, { token: tokenFor(tripId), body })
  },

  /** Deletes the stop (edits made on it are lost) and puts the item back in the pocket list */
  unschedule(tripId: string, itemId: string): Promise<WishlistUnscheduleResponse> {
    return request('POST', `${wishPath(tripId, itemId)}/unschedule`, { token: tokenFor(tripId) })
  },

  /** POST /og: the page's og:title / og:image through the Worker (422 url_not_allowed, 502, 429) */
  og(tripId: string, url: string, signal?: AbortSignal): Promise<OgResponse> {
    return request('POST', `${tripPath(tripId)}/og`, {
      token: tokenFor(tripId),
      body: { url },
      signal,
    })
  },
}
