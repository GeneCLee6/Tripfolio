import {
  MEMBER_TOKENS_HEADER,
  type ApiErrorBody,
  type CreateTripResponse,
  type JoinPreviewResponse,
  type MemberTokenResponse,
  type Rev,
  type Trip,
  type TripDetailResponse,
  type TripListResponse,
} from '../../shared/api/types.ts'
import type { JoinBody, TripCreate, TripPatch } from '../../shared/schema/index.ts'
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
}
