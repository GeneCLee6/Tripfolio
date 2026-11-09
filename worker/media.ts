// Attachments (e6-t01): photos, documents and receipts in R2 `MEDIA`. ARCHITECTURE.md §4.4,
// docs/PRD/e6-photos-media.md, CLAUDE.md rule 5.
//
// Upload is proxied through the Worker instead of an R2 presigned PUT: presigning needs S3 API
// credentials (an R2 access key as a secret) that the free setup does not have, and a proxy keeps
// the memberToken check, the size cap and the content type in one place. Flow:
//   POST /sign      → a `pending` row + where to PUT
//   PUT  /content   → streamed into R2 (exact Content-Length = declared bytes)
//   PUT  /thumb     → photos only, the 400 px version
//   POST /complete  → R2 head check, `ready`
// Reading is GET /api/media/:aid[/thumb]: photos for members (Bearer) or, when visibility is
// 'trip', a share token of the same trip (`?s=`); documents and receipts for members only, no-store.

import type {
  Attachment,
  AttachmentListResponse,
  AttachmentResponse,
  AttachmentSignResponse,
  AttachmentUsageResponse,
} from '../shared/api/media.ts'
import {
  attachmentLimits,
  attachmentListQuery,
  attachmentPatchSchema,
  attachmentSignSchema,
  type AttachmentKind,
} from '../shared/schema/attachment.ts'
import { authTrip, bearerToken, hashToken, isTokenShaped, resolveMemberToken } from './auth.ts'
import { insertStatement, updateStatement, writeWithRev, type Row } from './db.ts'
import type { Env } from './env.ts'
import {
  ApiError,
  forbidden,
  invalid,
  json,
  notFound,
  nowIso,
  readBody,
  unauthorized,
} from './http.ts'
import { enforceRateLimit } from './proxy/limits.ts'
import type { RouteContext } from './router.ts'

/** How long a signed upload may take before /content and /complete refuse it */
export const UPLOAD_TTL_MS = 15 * 60_000
/** Signs per member per minute (E11: rate-limit upload signing) */
export const SIGN_PER_MINUTE = 60
/** Photos are only readable with a token, so they cannot be public/immutable; a day in the
 * browser's private cache is the compromise (the key never changes, ETag revalidates after) */
export const PHOTO_CACHE = 'private, max-age=86400'
export const DOCUMENT_CACHE = 'private, no-store'

const extFor: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
}

/** `${APP_ENV ?? 'production'}/trips/<tripId>/<kind>/<uuid>.<ext>`: previews share the bucket */
export function mediaKey(
  env: Pick<Env, 'APP_ENV'>,
  tripId: string,
  kind: AttachmentKind,
  uuid: string,
  mime: string,
) {
  return `${env.APP_ENV || 'production'}/trips/${tripId}/${kind}/${uuid}.${extFor[mime] ?? 'bin'}`
}

/** `<uuid>.thumb` next to the main key: WebP, or JPEG where the browser cannot encode WebP */
const thumbKeyFor = (key: string) => key.replace(/\.[a-z0-9]+$/, '') + '.thumb'

const PATCH_COLUMNS = [
  'placeId',
  'stopId',
  'dayId',
  'bookingId',
  'lodgingId',
  'wishlistItemId',
  'visibility',
] as const

const strOrNull = (v: unknown) => (v === null || v === undefined ? null : String(v))
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export function toAttachment(r: Row): Attachment {
  const id = String(r.id)
  return {
    id,
    tripId: String(r.tripId),
    kind: String(r.kind) as Attachment['kind'],
    mime: String(r.mime),
    bytes: Number(r.bytes),
    thumbBytes: numOrNull(r.thumbBytes),
    width: numOrNull(r.width),
    height: numOrNull(r.height),
    takenAt: strOrNull(r.takenAt),
    lat: numOrNull(r.lat),
    lng: numOrNull(r.lng),
    placeId: strOrNull(r.placeId),
    stopId: strOrNull(r.stopId),
    dayId: strOrNull(r.dayId),
    bookingId: strOrNull(r.bookingId),
    lodgingId: strOrNull(r.lodgingId),
    wishlistItemId: strOrNull(r.wishlistItemId),
    uploaderMemberId: String(r.uploaderMemberId),
    visibility: String(r.visibility) as Attachment['visibility'],
    status: String(r.status) as Attachment['status'],
    url: `/api/media/${id}`,
    thumbUrl: r.thumbKey ? `/api/media/${id}/thumb` : null,
    rev: Number(r.rev),
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  }
}

async function loadRow(db: D1Database, tripId: string, id: string): Promise<Row> {
  const row = await db
    .prepare('SELECT * FROM attachments WHERE id = ? AND tripId = ? AND deletedAt IS NULL')
    .bind(id, tripId)
    .first<Row>()
  if (!row) throw notFound('attachment not found')
  return row
}

/** The ids an attachment hangs on must belong to the same trip (bookings/lodgings: no tables yet) */
async function checkRefs(
  db: D1Database,
  tripId: string,
  refs: {
    placeId?: string | null
    stopId?: string | null
    dayId?: string | null
    wishlistItemId?: string | null
  },
): Promise<void> {
  const checks: [string | null | undefined, string, string][] = [
    [refs.placeId, 'places', 'placeId'],
    [refs.stopId, 'stops', 'stopId'],
    [refs.dayId, 'days', 'dayId'],
    [refs.wishlistItemId, 'wishlistItems', 'wishlistItemId'],
  ]
  for (const [id, table, field] of checks) {
    if (!id) continue
    const found = await db
      .prepare(`SELECT id FROM ${table} WHERE id = ? AND tripId = ?`)
      .bind(id, tripId)
      .first<Row>()
    if (!found) throw invalid(`${field}: not in this trip`)
  }
}

/** POST /api/trips/:id/attachments/sign (editor) */
export async function signAttachment(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const body = await readBody(c.request, attachmentSignSchema)
  await enforceRateLimit(db, `media-sign:${auth.member.id}`, SIGN_PER_MINUTE)
  await checkRefs(db, auth.trip.id, body)
  const id = crypto.randomUUID()
  const key = mediaKey(c.env, auth.trip.id, body.kind, id, body.mime)
  const now = new Date()
  const { hasThumb, visibility, ...fields } = body
  await insertStatement(db, 'attachments', {
    id,
    tripId: auth.trip.id,
    ...fields,
    r2Key: key,
    thumbKey: hasThumb ? thumbKeyFor(key) : null,
    uploaderMemberId: auth.member.id,
    // Documents never reach a share page, whatever was asked
    visibility: body.kind === 'photo' ? (visibility ?? 'trip') : 'members-only',
    status: 'pending',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }).run()
  const base = `/api/trips/${auth.trip.id}/attachments/${id}`
  const response: AttachmentSignResponse = {
    attachmentId: id,
    uploadUrl: `${base}/content`,
    thumbUploadUrl: hasThumb ? `${base}/thumb` : null,
    key,
    expiresAt: new Date(now.getTime() + UPLOAD_TTL_MS).toISOString(),
  }
  return json(response, 201)
}

/** The pending row the uploader may still write to */
async function pendingForUpload(c: RouteContext): Promise<Row> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'editor')
  const row = await loadRow(c.env.DB, auth.trip.id, c.params.aid)
  if (String(row.uploaderMemberId) !== auth.member.id)
    throw forbidden('only the uploader can upload')
  if (row.status !== 'pending')
    throw new ApiError(409, 'already_complete', 'upload already completed')
  if (Date.parse(String(row.createdAt)) + UPLOAD_TTL_MS < Date.now())
    throw new ApiError(410, 'upload_expired', 'the upload window has passed; sign again')
  return row
}

/** Streams the request body into R2 after checking its declared length and type */
async function storeBody(
  c: RouteContext,
  key: string,
  { mimes, bytes, maxBytes }: { mimes: string[]; bytes: number | null; maxBytes: number },
): Promise<number> {
  const lengthHeader = c.request.headers.get('content-length')
  if (lengthHeader === null || !/^\d+$/.test(lengthHeader))
    throw new ApiError(411, 'length_required', 'Content-Length is required')
  const length = Number(lengthHeader)
  if (length > maxBytes) throw new ApiError(413, 'too_large', `at most ${maxBytes} bytes`)
  if (bytes !== null && length !== bytes)
    throw invalid(`Content-Length ${length} does not match the declared ${bytes} bytes`)
  if (length === 0 || !c.request.body) throw invalid('empty body')
  const type = (c.request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!mimes.includes(type))
    throw new ApiError(415, 'wrong_type', `Content-Type must be ${mimes.join(' or ')}`)
  // The Content-Length frames the body, so R2 receives at most that many bytes; the size is checked
  // again on the stored object in case a runtime lets a shorter or longer body through
  const object = await c.env.MEDIA.put(key, c.request.body, {
    httpMetadata: { contentType: type },
    customMetadata: { tripId: c.params.id, attachmentId: c.params.aid },
  })
  if (!object || object.size !== length) {
    await c.env.MEDIA.delete(key)
    throw invalid('the stored size does not match Content-Length')
  }
  return length
}

/** PUT /api/trips/:id/attachments/:aid/content (the uploader) */
export async function putAttachmentContent(c: RouteContext): Promise<Response> {
  const row = await pendingForUpload(c)
  const kind = String(row.kind) as AttachmentKind
  const maxBytes = kind === 'photo' ? attachmentLimits.photoBytes : attachmentLimits.documentBytes
  await storeBody(c, String(row.r2Key), {
    mimes: [String(row.mime)],
    bytes: Number(row.bytes),
    maxBytes,
  })
  return json({ ok: true })
}

/** PUT /api/trips/:id/attachments/:aid/thumb (the uploader; photos signed with hasThumb).
 * WebP, or JPEG from a browser that cannot encode WebP */
export async function putAttachmentThumb(c: RouteContext): Promise<Response> {
  const row = await pendingForUpload(c)
  if (!row.thumbKey) throw invalid('this attachment was signed without a thumbnail')
  const thumbBytes = await storeBody(c, String(row.thumbKey), {
    mimes: ['image/webp', 'image/jpeg'],
    bytes: null,
    maxBytes: attachmentLimits.thumbBytes,
  })
  await c.env.DB.prepare('UPDATE attachments SET thumbBytes = ? WHERE id = ?')
    .bind(thumbBytes, String(row.id))
    .run()
  return json({ ok: true, thumbBytes })
}

/** POST /api/trips/:id/attachments/:aid/complete (the uploader) */
export async function completeAttachment(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const row = await pendingForUpload(c)
  const head = await c.env.MEDIA.head(String(row.r2Key))
  if (!head) throw new ApiError(409, 'not_uploaded', 'the content has not been uploaded')
  if (row.thumbKey && !(await c.env.MEDIA.head(String(row.thumbKey))))
    throw new ApiError(409, 'not_uploaded', 'the thumbnail has not been uploaded')
  const rev = await writeWithRev(db, String(row.tripId), [
    db
      .prepare("UPDATE attachments SET status = 'ready', rev = rev + 1, updatedAt = ? WHERE id = ?")
      .bind(nowIso(), String(row.id)),
  ])
  const body: AttachmentResponse = {
    attachment: toAttachment(await loadRow(db, String(row.tripId), String(row.id))),
    rev,
  }
  return json(body)
}

/** GET /api/trips/:id/attachments?kind=&dayId=&stopId= (viewer): ready, not deleted */
export async function listAttachments(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'viewer')
  const parsed = attachmentListQuery.safeParse(Object.fromEntries(c.url.searchParams))
  if (!parsed.success) throw invalid('bad query', parsed.error.issues)
  const where = ['tripId = ?', "status = 'ready'", 'deletedAt IS NULL']
  const values: string[] = [auth.trip.id]
  for (const field of ['kind', 'dayId', 'stopId'] as const) {
    const value = parsed.data[field]
    if (value === undefined) continue
    where.push(`${field} = ?`)
    values.push(value)
  }
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM attachments WHERE ${where.join(' AND ')} ORDER BY COALESCE(takenAt, createdAt), id`,
  )
    .bind(...values)
    .all<Row>()
  const body: AttachmentListResponse = {
    attachments: results.map(toAttachment),
    rev: auth.trip.rev,
  }
  return json(body)
}

/** PATCH /api/trips/:id/attachments/:aid (editor): move (placeId/stopId/dayId/…), visibility */
export async function patchAttachment(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const row = await loadRow(db, auth.trip.id, c.params.aid)
  const patch = await readBody(c.request, attachmentPatchSchema)
  if (patch.visibility === 'trip' && row.kind !== 'photo')
    throw invalid('visibility: documents and receipts are always members-only')
  await checkRefs(db, auth.trip.id, patch)
  const update = updateStatement(db, 'attachments', patch, PATCH_COLUMNS, nowIso(), {
    sql: 'id = ?',
    values: [String(row.id)],
  })
  const rev = update ? await writeWithRev(db, auth.trip.id, [update]) : auth.trip.rev
  const body: AttachmentResponse = {
    attachment: toAttachment(await loadRow(db, auth.trip.id, String(row.id))),
    rev,
  }
  return json(body)
}

/**
 * DELETE /api/trips/:id/attachments/:aid (editor): soft delete; it stops being readable at once.
 * The R2 objects stay until the cleanup job (e11-t06) removes rows deleted 30+ days ago.
 */
export async function deleteAttachment(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const row = await loadRow(db, auth.trip.id, c.params.aid)
  const now = nowIso()
  const rev = await writeWithRev(db, auth.trip.id, [
    db
      .prepare('UPDATE attachments SET deletedAt = ?, rev = rev + 1, updatedAt = ? WHERE id = ?')
      .bind(now, now, String(row.id)),
    db
      .prepare(
        'UPDATE trips SET coverAttachmentId = NULL, updatedAt = ? WHERE id = ? AND coverAttachmentId = ?',
      )
      .bind(now, auth.trip.id, String(row.id)),
    db
      .prepare(
        'UPDATE wishlistItems SET photoAttachmentId = NULL, rev = rev + 1, updatedAt = ? WHERE tripId = ? AND photoAttachmentId = ?',
      )
      .bind(now, auth.trip.id, String(row.id)),
  ])
  return json({ ok: true, rev })
}

/** Bytes (thumbnails included) and count of a trip's ready, not deleted attachments */
export async function getTripUsage(
  db: D1Database,
  tripId: string,
): Promise<{ bytes: number; count: number }> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(bytes + COALESCE(thumbBytes, 0)), 0) AS bytes, COUNT(*) AS count
         FROM attachments WHERE tripId = ? AND status = 'ready' AND deletedAt IS NULL`,
    )
    .bind(tripId)
    .first<Row>()
  return { bytes: Number(row?.bytes ?? 0), count: Number(row?.count ?? 0) }
}

/** GET /api/trips/:id/attachments/usage (viewer) */
export async function attachmentUsage(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'viewer')
  const body: AttachmentUsageResponse = {
    ...(await getTripUsage(c.env.DB, auth.trip.id)),
    warnAtBytes: attachmentLimits.warnTripBytes,
  }
  return json(body)
}

// ---- GET /api/media/:aid[/thumb] ----------------------------------------------------------------

async function shareTripId(db: D1Database, token: string): Promise<string | null> {
  if (!isTokenShaped(token)) return null
  const row = await db
    .prepare(
      `SELECT s.tripId AS tripId FROM shares s JOIN trips t ON t.id = s.tripId
        WHERE s.tokenHash = ? AND s.revokedAt IS NULL AND t.deletedAt IS NULL`,
    )
    .bind(await hashToken(token))
    .first<Row>()
  return row ? String(row.tripId) : null
}

async function serveMedia(c: RouteContext, thumb: boolean): Promise<Response> {
  const db = c.env.DB
  const member = bearerToken(c.request)
  const share = c.url.searchParams.get('s')
  if (!member && !share) throw unauthorized('a member token or share token is required')
  const row = await db
    .prepare("SELECT * FROM attachments WHERE id = ? AND status = 'ready' AND deletedAt IS NULL")
    .bind(c.params.aid)
    .first<Row>()
  if (!row) throw notFound('attachment not found')
  const isPhoto = row.kind === 'photo'
  if (member) {
    const auth = await resolveMemberToken(db, member)
    if (!auth) throw unauthorized()
    if (auth.trip.id !== row.tripId) throw notFound('attachment not found')
  } else {
    // Share tokens only ever reach shareable photos (CLAUDE.md rule 5)
    const tripId = await shareTripId(db, share ?? '')
    if (!tripId) throw unauthorized('invalid share token')
    if (tripId !== row.tripId) throw notFound('attachment not found')
    if (!isPhoto || row.visibility !== 'trip') throw forbidden('not shared')
  }
  const key = thumb ? strOrNull(row.thumbKey) : String(row.r2Key)
  if (!key) throw notFound('no thumbnail')
  const cacheControl = isPhoto ? PHOTO_CACHE : DOCUMENT_CACHE
  const headers = new Headers({
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
  })
  // An image opened on its own must not run or load anything (PDF viewers break under sandbox)
  if (String(row.mime).startsWith('image/'))
    headers.set('content-security-policy', "default-src 'none'; sandbox")
  const ifNoneMatch = c.request.headers.get('if-none-match')
  if (ifNoneMatch && isPhoto) {
    const head = await c.env.MEDIA.head(key)
    if (!head) throw notFound('object missing')
    if (etagMatches(ifNoneMatch, head.httpEtag)) {
      headers.set('etag', head.httpEtag)
      return new Response(null, { status: 304, headers })
    }
  }
  const object = await c.env.MEDIA.get(key)
  if (!object) throw notFound('object missing')
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('content-length', String(object.size))
  if (!isPhoto) headers.set('content-disposition', 'inline')
  return new Response(object.body, { status: 200, headers })
}

function etagMatches(header: string, etag: string): boolean {
  const bare = (value: string) => value.trim().replace(/^W\//, '')
  return header === '*' || header.split(',').some((candidate) => bare(candidate) === bare(etag))
}

/** GET /api/media/:aid */
export const getMedia = (c: RouteContext) => serveMedia(c, false)
/** GET /api/media/:aid/thumb */
export const getMediaThumb = (c: RouteContext) => serveMedia(c, true)
