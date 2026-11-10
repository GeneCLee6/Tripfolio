// Trip lifecycle (e1-t07) beyond archive (PATCH archived, worker/trips/trips.ts) and soft delete
// (DELETE /api/trips/:id sets deletedAt, trips.ts):
//
//   POST /api/trips/:id/clone   (editor, archived trips too) a template copy: export → import in
//                               memory (worker/trips/export.ts). The caller becomes the owner of
//                               the copy; members, expenses and photos are cleared unless `keep`
//                               says otherwise (expenses need the members, so they bring them).
//                               Checklists (unticked), the budget and notes always come along;
//                               day recaps (e8-t04) never do.
//                               Photos are copied in R2 under the new trip's keys.
//   POST /api/trips/:id/restore (owner) undoes a soft delete within 30 days (410 afterwards).
//   GET  /api/trips/deleted     soft-deleted trips behind the device's tokens (X-Member-Tokens,
//                               like GET /api/trips), with deletedAt and purgeAt.
//
// Purge contract for the cleanup cron (e11-t06): a trip whose deletedAt is older than
// TRIP_RESTORE_DAYS (30) days can no longer be restored here; the cron deletes its rows and R2
// objects (`<APP_ENV>/trips/<tripId>/…`). Until it runs such a trip is listed with canRestore false.

import type {
  DeletedTripsResponse,
  ImportTripResponse,
  LocalId,
  RestoreTripResponse,
  TripExport,
} from '../../shared/api/export.ts'
import { TRIP_RESTORE_DAYS } from '../../shared/api/export.ts'
import { MAX_MEMBER_TOKENS, MEMBER_TOKENS_HEADER } from '../../shared/api/types.ts'
import { tripCloneSchema } from '../../shared/schema/export.ts'
import { bearerToken, hashToken, isTokenShaped, timingSafeEqual, authTrip } from '../auth.ts'
import { toMember, toTrip, writeWithRev, type Row } from '../db.ts'
import type { Env } from '../env.ts'
import {
  ApiError,
  forbidden,
  invalid,
  json,
  notFound,
  nowIso,
  readBody,
  unauthorized,
} from '../http.ts'
import { mediaKey } from '../media.ts'
import type { RouteContext } from '../router.ts'
import {
  buildExport,
  bulkInsert,
  shiftTakenAt,
  writeImport,
  type ExportInternals,
  type ImportIds,
} from './export.ts'

const RESTORE_MS = TRIP_RESTORE_DAYS * 86_400_000

const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''))

/** Copies the exported photos' R2 objects and returns the attachment rows (plus the cover and
 * wishlist photo links) for the new trip. A missing object is skipped. Objects copied before a
 * failed D1 batch are left for the e11-t06 cleanup (no row points at them). */
async function photoStatements(
  env: Env,
  file: TripExport,
  internals: ExportInternals,
  ids: ImportIds,
): Promise<D1PreparedStatement[]> {
  const db = env.DB
  const now = nowIso()
  const records: Record<string, unknown>[] = []
  const newId = new Map<LocalId, string>()
  const map = (m: Map<LocalId, string>, local: LocalId | null) =>
    local === null ? null : (m.get(local) ?? null)
  for (const a of file.attachments ?? []) {
    const row = internals.attachmentRows.get(a.id)
    if (!row) continue
    const source = await env.MEDIA.get(str(row.r2Key))
    if (!source) continue
    const key = mediaKey(env, ids.tripId, 'photo', crypto.randomUUID(), a.mime)
    await env.MEDIA.put(key, source.body, { httpMetadata: source.httpMetadata })
    let thumbKey: string | null = null
    if (row.thumbKey) {
      const thumb = await env.MEDIA.get(str(row.thumbKey))
      if (thumb) {
        thumbKey = key.replace(/\.[a-z0-9]+$/, '') + '.thumb'
        await env.MEDIA.put(thumbKey, thumb.body, { httpMetadata: thumb.httpMetadata })
      }
    }
    const id = crypto.randomUUID()
    newId.set(a.id, id)
    const uploader = internals.memberIds(str(row.uploaderMemberId))
    records.push({
      id,
      tripId: ids.tripId,
      kind: 'photo',
      r2Key: key,
      thumbKey,
      mime: a.mime,
      bytes: a.bytes,
      thumbBytes: thumbKey ? row.thumbBytes : null,
      width: a.width,
      height: a.height,
      takenAt: a.takenAt === null ? null : shiftTakenAt(a.takenAt, ids.delta, file.trip.tz),
      lat: a.lat,
      lng: a.lng,
      placeId: map(ids.places, a.place),
      stopId: map(ids.stops, a.stop),
      dayId: map(ids.days, a.day),
      bookingId: map(ids.bookings, a.bookingRef),
      lodgingId: map(ids.lodgings, a.lodging),
      wishlistItemId: map(ids.wishlist, a.wishlistItem),
      uploaderMemberId: map(ids.members, uploader) ?? ids.ownerMemberId,
      visibility: a.visibility,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    })
  }
  const statements = bulkInsert(db, 'attachments', records)
  const cover = internals.coverAttachment === null ? null : newId.get(internals.coverAttachment)
  if (cover)
    statements.push(
      db.prepare('UPDATE trips SET coverAttachmentId = ? WHERE id = ?').bind(cover, ids.tripId),
    )
  for (const [item, photo] of internals.wishlistPhotos) {
    const itemId = ids.wishlist.get(item)
    const photoId = newId.get(photo)
    if (itemId && photoId)
      statements.push(
        db
          .prepare('UPDATE wishlistItems SET photoAttachmentId = ? WHERE id = ?')
          .bind(photoId, itemId),
      )
  }
  return statements
}

/** POST /api/trips/:id/clone { name, startDate?, keep? } (editor) */
export async function cloneTrip(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor', { allowArchived: true })
  const { name, startDate, keep } = await readBody(c.request, tripCloneSchema)
  const members = keep.members || keep.expenses
  const { file, internals } = await buildExport(db, auth.trip.id, {
    expenses: keep.expenses,
    photos: keep.photos,
  })
  const asMember = internals.memberIds(auth.member.id) ?? undefined
  const { response } = await writeImport(
    db,
    // Photos are copied below with their objects, not imported as metadata
    { ...file, attachments: undefined },
    {
      owner: { name: auth.member.name, color: auth.member.color },
      asMember,
      name,
      startDate,
      keep: { members, expenses: keep.expenses },
      asTemplate: true,
    },
    keep.photos ? (ids) => photoStatements(c.env, file, internals, ids) : () => [],
  )
  const body: ImportTripResponse = {
    ...response,
    skipped: response.skipped.filter((s) => !s.startsWith('members:') || keep.members),
  }
  return json(body, 201)
}

// ---- soft delete: restore and list ----------------------------------------------------------

/** memberToken → member + trip, deleted trips included (resolveMemberToken skips them) */
async function resolveIncludingDeleted(
  db: D1Database,
  token: string,
): Promise<{ trip: Row; member: Row } | null> {
  if (!isTokenShaped(token)) return null
  const tokenHash = await hashToken(token)
  const member = await db
    .prepare(
      `SELECT t.tokenHash AS tokenHash, m.*
         FROM memberTokens t JOIN members m ON m.id = t.memberId
        WHERE t.tokenHash = ? AND t.revokedAt IS NULL AND m.removedAt IS NULL`,
    )
    .bind(tokenHash)
    .first<Row>()
  if (!member || !timingSafeEqual(str(member.tokenHash), tokenHash)) return null
  const trip = await db.prepare('SELECT * FROM trips WHERE id = ?').bind(member.tripId).first<Row>()
  return trip ? { trip, member } : null
}

const purgeAt = (deletedAt: string) => new Date(Date.parse(deletedAt) + RESTORE_MS).toISOString()

/** POST /api/trips/:id/restore (owner): within 30 days of the delete; 410 restore_expired after */
export async function restoreTrip(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const token = bearerToken(c.request)
  if (!token) throw unauthorized()
  const found = await resolveIncludingDeleted(db, token)
  if (!found) throw unauthorized()
  if (str(found.trip.id) !== c.params.id) throw notFound('trip not found')
  if (str(found.member.role) !== 'owner') throw forbidden('requires owner')
  const deletedAt = found.trip.deletedAt
  if (deletedAt === null || deletedAt === undefined)
    throw new ApiError(409, 'not_deleted', 'the trip is not deleted')
  if (Date.now() > Date.parse(str(deletedAt)) + RESTORE_MS)
    throw new ApiError(410, 'restore_expired', `deleted more than ${TRIP_RESTORE_DAYS} days ago`)
  const now = nowIso()
  const rev = await writeWithRev(db, c.params.id, [
    db
      .prepare('UPDATE trips SET deletedAt = NULL, updatedAt = ? WHERE id = ?')
      .bind(now, c.params.id),
  ])
  const row = await db.prepare('SELECT * FROM trips WHERE id = ?').bind(c.params.id).first<Row>()
  const body: RestoreTripResponse = { trip: toTrip(row as Row), rev }
  return json(body)
}

/** GET /api/trips/deleted: X-Member-Tokens like GET /api/trips; only soft-deleted trips */
export async function listDeletedTrips(c: RouteContext): Promise<Response> {
  const tokens = (c.request.headers.get(MEMBER_TOKENS_HEADER) ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  if (tokens.length > MAX_MEMBER_TOKENS)
    throw invalid(`at most ${MAX_MEMBER_TOKENS} tokens in ${MEMBER_TOKENS_HEADER}`)
  const resolved = await Promise.all(tokens.map((t) => resolveIncludingDeleted(c.env.DB, t)))
  const now = Date.now()
  const body: DeletedTripsResponse = { trips: [] }
  resolved.forEach((found, tokenIndex) => {
    if (!found || found.trip.deletedAt === null || found.trip.deletedAt === undefined) return
    const trip = toTrip(found.trip)
    const deletedAt = str(found.trip.deletedAt)
    const member = toMember(found.member)
    body.trips.push({
      tokenIndex,
      trip: {
        id: trip.id,
        name: trip.name,
        destination: trip.destination,
        startDate: trip.startDate,
        endDate: trip.endDate,
        coverColor: trip.coverColor,
      },
      deletedAt,
      purgeAt: purgeAt(deletedAt),
      canRestore: member.role === 'owner' && now <= Date.parse(deletedAt) + RESTORE_MS,
    })
  })
  return json(body)
}
