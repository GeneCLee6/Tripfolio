import type {
  AttachmentListResponse,
  AttachmentResponse,
  AttachmentSignResponse,
  AttachmentUsageResponse,
} from '../../../shared/api/media.ts'
import type {
  AttachmentKind,
  AttachmentPatch,
  AttachmentSignBody,
} from '../../../shared/schema/attachment.ts'
import { ApiError, request } from '../api.ts'
import { getToken } from '../tokens.ts'

// Typed calls for the attachment API (worker/media.ts, e6-t01). Uses src/lib/api.ts's `request`
// (same ApiError, same test transport). The bytes themselves go through upload.ts (XHR, progress).

function tokenFor(tripId: string): string {
  const token = getToken(tripId)
  if (!token) throw new ApiError(401, 'unauthorized', 'no member token on this device')
  return token
}

const base = (tripId: string) => `/api/trips/${encodeURIComponent(tripId)}/attachments`

export interface AttachmentFilter {
  kind?: AttachmentKind
  dayId?: string
  stopId?: string
}

export const mediaApi = {
  /** The memberToken the PUTs carry (Bearer) */
  tokenFor,

  sign(
    tripId: string,
    body: AttachmentSignBody,
    signal?: AbortSignal,
  ): Promise<AttachmentSignResponse> {
    return request('POST', `${base(tripId)}/sign`, { token: tokenFor(tripId), body, signal })
  },

  complete(
    tripId: string,
    attachmentId: string,
    signal?: AbortSignal,
  ): Promise<AttachmentResponse> {
    return request('POST', `${base(tripId)}/${encodeURIComponent(attachmentId)}/complete`, {
      token: tokenFor(tripId),
      signal,
    })
  },

  list(
    tripId: string,
    filter: AttachmentFilter = {},
    signal?: AbortSignal,
  ): Promise<AttachmentListResponse> {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(filter)) if (value) query.set(key, value)
    const qs = query.toString()
    return request('GET', `${base(tripId)}${qs ? `?${qs}` : ''}`, {
      token: tokenFor(tripId),
      signal,
    })
  },

  patch(tripId: string, attachmentId: string, patch: AttachmentPatch): Promise<AttachmentResponse> {
    return request('PATCH', `${base(tripId)}/${encodeURIComponent(attachmentId)}`, {
      token: tokenFor(tripId),
      body: patch,
    })
  },

  remove(tripId: string, attachmentId: string): Promise<{ ok: true; rev: number }> {
    return request('DELETE', `${base(tripId)}/${encodeURIComponent(attachmentId)}`, {
      token: tokenFor(tripId),
    })
  },

  usage(tripId: string, signal?: AbortSignal): Promise<AttachmentUsageResponse> {
    return request('GET', `${base(tripId)}/usage`, { token: tokenFor(tripId), signal })
  },

  /**
   * An attachment's bytes for members: `<img>` cannot send the Bearer header, so fetch it and use
   * URL.createObjectURL on the result (revoke it when done). Photos are cached privately for a
   * day by the browser; documents are no-store. Share pages use `${url}?s=<shareToken>` directly.
   */
  async fetchBlob(tripId: string, url: string, signal?: AbortSignal): Promise<Blob> {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { authorization: `Bearer ${tokenFor(tripId)}` },
        signal,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new ApiError(0, 'network', error instanceof Error ? error.message : String(error))
    }
    if (!response.ok) throw new ApiError(response.status, 'http_error', `HTTP ${response.status}`)
    return response.blob()
  },
}
