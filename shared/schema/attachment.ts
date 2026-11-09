import { z } from 'zod'
import { entityId, latitude, longitude } from './common.ts'

// Attachments (e6-t01): one upload channel for photos (E6), booking confirmations (E4) and
// documents (E9). docs/PRD/e6-photos-media.md, ARCHITECTURE.md §4.4, E11 security limits.

export const attachmentKinds = ['photo', 'document', 'receipt'] as const
export const attachmentKind = z.enum(attachmentKinds)
export type AttachmentKind = z.infer<typeof attachmentKind>

export const attachmentVisibilities = ['trip', 'members-only'] as const
export const attachmentVisibility = z.enum(attachmentVisibilities)
export type AttachmentVisibility = z.infer<typeof attachmentVisibility>

export const attachmentStatuses = ['pending', 'ready'] as const
export type AttachmentStatus = (typeof attachmentStatuses)[number]

const MB = 1024 * 1024

/** Upload limits, checked by the browser (friendly) and enforced by the Worker */
export const attachmentLimits = {
  /** A photo after the browser's 2048 px WebP re-encode */
  photoBytes: 8 * MB,
  /** The 400 px thumbnail */
  thumbBytes: 1 * MB,
  /** Documents and receipts are stored as picked, never resized */
  documentBytes: 20 * MB,
  /** The original a browser agrees to decode at all (E11: images ≤ 50 MB) */
  originalBytes: 50 * MB,
  /** Trip usage that triggers the E6 warning (AC-6.4) */
  warnTripBytes: 1.5 * 1024 * MB,
} as const

export const photoMimes = ['image/webp', 'image/jpeg', 'image/png'] as const
/** Raster images a browser can show; never SVG (it can carry script) */
export const documentImageMimes = [
  'image/webp',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/avif',
] as const
export const documentMimes = ['application/pdf', ...documentImageMimes] as const

export function mimeAllowed(kind: AttachmentKind, mime: string): boolean {
  const list: readonly string[] = kind === 'photo' ? photoMimes : documentMimes
  return list.includes(mime)
}

export function maxBytesFor(kind: AttachmentKind): number {
  return kind === 'photo' ? attachmentLimits.photoBytes : attachmentLimits.documentBytes
}

/** EXIF time: UTC with Z (offset known) or wall-clock without zone (read in the trip's tz) */
export const takenAtValue = z.union([z.iso.datetime(), z.iso.datetime({ local: true })])

/** POST /api/trips/:id/attachments/sign */
export const attachmentSignSchema = z
  .object({
    kind: attachmentKind,
    mime: z.string().trim().toLowerCase().max(100),
    bytes: z.number().int().positive(),
    width: z.number().int().positive().max(20_000).nullable().default(null),
    height: z.number().int().positive().max(20_000).nullable().default(null),
    takenAt: takenAtValue.nullable().default(null),
    lat: latitude.nullable().default(null),
    lng: longitude.nullable().default(null),
    hasThumb: z.boolean().default(false),
    visibility: attachmentVisibility.optional(),
    placeId: entityId.nullable().default(null),
    stopId: entityId.nullable().default(null),
    dayId: entityId.nullable().default(null),
    bookingId: entityId.nullable().default(null),
    lodgingId: entityId.nullable().default(null),
    wishlistItemId: entityId.nullable().default(null),
  })
  .superRefine((body, ctx) => {
    if (!mimeAllowed(body.kind, body.mime))
      ctx.addIssue({
        code: 'custom',
        path: ['mime'],
        message: `${body.mime} not allowed for ${body.kind}`,
      })
    if (body.bytes > maxBytesFor(body.kind))
      ctx.addIssue({
        code: 'custom',
        path: ['bytes'],
        message: `at most ${maxBytesFor(body.kind)} bytes for ${body.kind}`,
      })
    if (body.hasThumb && body.kind !== 'photo')
      ctx.addIssue({ code: 'custom', path: ['hasThumb'], message: 'only photos have thumbnails' })
    if ((body.lat === null) !== (body.lng === null))
      ctx.addIssue({ code: 'custom', path: ['lat'], message: 'lat and lng come together' })
  })
export type AttachmentSign = z.infer<typeof attachmentSignSchema>
export type AttachmentSignBody = z.input<typeof attachmentSignSchema>

/** PATCH /api/trips/:id/attachments/:aid: move it, or change who may see it */
export const attachmentPatchSchema = z
  .object({
    placeId: entityId.nullable(),
    stopId: entityId.nullable(),
    dayId: entityId.nullable(),
    bookingId: entityId.nullable(),
    lodgingId: entityId.nullable(),
    wishlistItemId: entityId.nullable(),
    visibility: attachmentVisibility,
  })
  .partial()
export type AttachmentPatch = z.infer<typeof attachmentPatchSchema>

/** GET /api/trips/:id/attachments?kind=&dayId=&stopId= */
export const attachmentListQuery = z.object({
  kind: attachmentKind.optional(),
  dayId: entityId.optional(),
  stopId: entityId.optional(),
})
