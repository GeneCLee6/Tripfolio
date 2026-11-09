// Request and response shapes of the attachment API (worker/media.ts, e6-t01). Bodies are the zod
// types in shared/schema/attachment.ts.

import type {
  AttachmentKind,
  AttachmentStatus,
  AttachmentVisibility,
} from '../schema/attachment.ts'

export interface Attachment {
  id: string
  tripId: string
  kind: AttachmentKind
  mime: string
  /** Main object size; thumbBytes once the thumbnail is uploaded */
  bytes: number
  thumbBytes: number | null
  width: number | null
  height: number | null
  /** UTC (…Z) or wall-clock without zone (trip tz), from EXIF */
  takenAt: string | null
  lat: number | null
  lng: number | null
  placeId: string | null
  stopId: string | null
  dayId: string | null
  bookingId: string | null
  lodgingId: string | null
  wishlistItemId: string | null
  uploaderMemberId: string
  visibility: AttachmentVisibility
  status: AttachmentStatus
  /** GET it here: Bearer memberToken, or `?s=<shareToken>` for shareable photos */
  url: string
  /** Photos with a thumbnail only */
  thumbUrl: string | null
  rev: number
  createdAt: string
  updatedAt: string
}

/** POST /api/trips/:id/attachments/sign → PUT the bytes to uploadUrl (Bearer, exact Content-Length
 * and Content-Type), the thumbnail to thumbUploadUrl, then POST …/complete before expiresAt */
export interface AttachmentSignResponse {
  attachmentId: string
  uploadUrl: string
  thumbUploadUrl: string | null
  key: string
  expiresAt: string
}

export interface AttachmentResponse {
  attachment: Attachment
  rev: number
}

export interface AttachmentListResponse {
  attachments: Attachment[]
  rev: number
}

/** GET /api/trips/:id/attachments/usage: ready, not deleted attachments (thumbnails included) */
export interface AttachmentUsageResponse {
  bytes: number
  count: number
  warnAtBytes: number
}
