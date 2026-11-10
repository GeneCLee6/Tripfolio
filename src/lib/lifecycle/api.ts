import type {
  DeletedTripsResponse,
  ImportTripResponse,
  RestoreTripResponse,
  TripExport,
} from '../../../shared/api/export.ts'
import { MEMBER_TOKENS_HEADER, type ApiErrorBody, type Rev } from '../../../shared/api/types.ts'
import { ApiError, request } from '../api.ts'
import { getToken, removeToken, setToken } from '../tokens.ts'
import { filenameFromDisposition } from './files.ts'
import { forgetRetired, retireToken, tokensForDeleted, watchRetiredTokens } from './graveyard.ts'

// The typed client for the lifecycle routes (worker/app.ts): export (e8-t03), import, clone,
// delete, restore and the deleted list (e1-t07), the calendar download (e8-t05). File responses
// are fetched as blobs with the Bearer token (an <a href> cannot send it) and saved under the
// server's file name.

watchRetiredTokens()

const tripPath = (tripId: string) => `/api/trips/${encodeURIComponent(tripId)}`

function tokenFor(tripId: string): string {
  const token = getToken(tripId)
  if (!token) throw new ApiError(401, 'unauthorized', 'no member token on this device')
  return token
}

export interface DownloadedFile {
  blob: Blob
  fileName: string
}

async function fetchFile(path: string, token: string, fallback: string): Promise<DownloadedFile> {
  let response: Response
  try {
    response = await fetch(path, { headers: { authorization: `Bearer ${token}` } })
  } catch (error) {
    throw new ApiError(0, 'network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    let body: Partial<ApiErrorBody> | null = null
    try {
      body = (await response.json()) as Partial<ApiErrorBody>
    } catch {
      body = null
    }
    const error = body?.error
    if (error && typeof error.code === 'string')
      throw new ApiError(response.status, error.code, error.message, error.details)
    throw new ApiError(response.status, 'http_error', `HTTP ${response.status}`)
  }
  return {
    blob: await response.blob(),
    fileName: filenameFromDisposition(response.headers.get('content-disposition'), fallback),
  }
}

export interface ExportInclude {
  expenses: boolean
  photos: boolean
}

export interface CloneBody {
  name: string
  startDate?: string
  keep: { members: boolean; expenses: boolean; photos: boolean }
}

export type ImportBody = TripExport & {
  owner: { name: string; color: string }
  name?: string
  startDate?: string
  asMember?: number
}

export type DeletedTrip = DeletedTripsResponse['trips'][number] & { token: string }

export const lifecycleApi = {
  /** GET /export?include=…: the TripExport v1 file (editor) */
  exportTrip(tripId: string, include: ExportInclude): Promise<DownloadedFile> {
    const parts = [include.expenses && 'expenses', include.photos && 'photos'].filter(Boolean)
    const query = parts.length ? `?include=${parts.join(',')}` : ''
    return fetchFile(`${tripPath(tripId)}/export${query}`, tokenFor(tripId), 'trip.tripfolio.json')
  },

  /** GET /calendar.ics: a one-off calendar file (any member) */
  calendar(tripId: string): Promise<DownloadedFile> {
    return fetchFile(`${tripPath(tripId)}/calendar.ics`, tokenFor(tripId), 'trip.ics')
  },

  /** POST /clone (editor): the copy's owner token is remembered on this device */
  async clone(tripId: string, body: CloneBody): Promise<ImportTripResponse> {
    const response = await request<ImportTripResponse>('POST', `${tripPath(tripId)}/clone`, {
      token: tokenFor(tripId),
      body,
    })
    setToken(response.trip.id, response.memberToken)
    return response
  },

  /** POST /api/import (no auth, like creating a trip): remembers the new owner token */
  async importTrip(body: ImportBody): Promise<ImportTripResponse> {
    const response = await request<ImportTripResponse>('POST', '/api/import', { body })
    setToken(response.trip.id, response.memberToken)
    return response
  },

  /** DELETE /api/trips/:id (owner): a soft delete; the token is kept aside for a restore */
  async deleteTrip(tripId: string): Promise<Rev & { ok: true }> {
    const token = tokenFor(tripId)
    const response = await request<Rev & { ok: true }>('DELETE', tripPath(tripId), { token })
    retireToken(tripId, token)
    removeToken(tripId)
    return response
  },

  /** GET /api/trips/deleted with every token this device has (active and retired) */
  async listDeleted(signal?: AbortSignal): Promise<{ trips: DeletedTrip[] }> {
    const sent = tokensForDeleted()
    if (sent.length === 0) return { trips: [] }
    const response = await request<DeletedTripsResponse>('GET', '/api/trips/deleted', {
      headers: { [MEMBER_TOKENS_HEADER]: sent.map((entry) => entry.token).join(',') },
      signal,
    })
    // Retired tokens the server did not answer for are revoked or purged: forget them
    const answered = new Set(response.trips.map((entry) => entry.tokenIndex))
    forgetRetired(sent.filter((_, index) => !answered.has(index)).map((entry) => entry.tripId))
    return {
      trips: response.trips.map((entry) => ({ ...entry, token: sent[entry.tokenIndex].token })),
    }
  },

  /** POST /restore (owner, within 30 days): the trip is back in the list on this device */
  async restore(tripId: string, token: string): Promise<RestoreTripResponse> {
    const response = await request<RestoreTripResponse>('POST', `${tripPath(tripId)}/restore`, {
      token,
    })
    setToken(tripId, token)
    forgetRetired([tripId])
    return response
  },
}
