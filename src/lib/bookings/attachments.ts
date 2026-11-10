import type { Attachment, AttachmentListResponse } from '../../../shared/api/media.ts'
import { ApiError, request } from '../api.ts'
import { getToken } from '../tokens.ts'

// A booking's or lodging's confirmations (e4-t04): `document` attachments linked by bookingId or
// lodgingId, members-only (the Worker never lets a document be shared and the share page never
// lists them). Listing filters on the server (worker/media.ts); uploading goes through the E6
// channel (src/lib/upload/upload.ts, imported lazily by the caller); bytes are fetched with the
// member token and opened as an object URL.

export type AttachmentOwner = { bookingId: string } | { lodgingId: string }

function tokenFor(tripId: string): string {
  const token = getToken(tripId)
  if (!token) throw new ApiError(401, 'unauthorized', 'no member token on this device')
  return token
}

/** `?kind=document&bookingId=…` or `…&lodgingId=…` */
export function attachmentQuery(owner: AttachmentOwner): string {
  const params = new URLSearchParams({ kind: 'document' })
  if ('bookingId' in owner) params.set('bookingId', owner.bookingId)
  else params.set('lodgingId', owner.lodgingId)
  return `?${params}`
}

export function listOwnerAttachments(
  tripId: string,
  owner: AttachmentOwner,
  signal?: AbortSignal,
): Promise<Attachment[]> {
  return request<AttachmentListResponse>(
    'GET',
    `/api/trips/${encodeURIComponent(tripId)}/attachments${attachmentQuery(owner)}`,
    { token: tokenFor(tripId), signal },
  ).then((res) => res.attachments)
}

/**
 * Opens a blob in a new tab. The tab is opened before the bytes arrive (a popup opened after an
 * await is blocked), then pointed at the object URL; the URL is revoked a minute later.
 */
export async function openInNewTab(load: () => Promise<Blob>): Promise<void> {
  const tab = window.open('', '_blank')
  try {
    const blob = await load()
    const url = URL.createObjectURL(blob)
    if (tab) tab.location.href = url
    else {
      const link = document.createElement('a')
      link.href = url
      link.target = '_blank'
      link.rel = 'noopener'
      link.click()
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (error) {
    tab?.close()
    throw error
  }
}
