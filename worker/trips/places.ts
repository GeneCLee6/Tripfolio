// Places (e3-t01): a referenced entity; stops, wishlist items, lodgings, attachments and bookings
// (details.pickupPlaceId / dropoffPlaceId / meetingPlaceId) point at it by id, so renaming once
// changes it everywhere. Deleting or merging a place clears or re-points all of them.

import type { PlaceRefsResponse, WishlistItem } from '../../shared/api/types.ts'
import { placeCreateSchema, placePatchSchema } from '../../shared/schema/place.ts'
import { authTrip } from '../auth.ts'
import { insertStatement, toPlace, updateStatement, writeWithRev, type Row } from '../db.ts'
import { invalid, json, notFound, nowIso, readBody } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { notifyTrip } from '../sync.ts'

const PLACE_COLUMNS = [
  'nameLocal',
  'nameEn',
  'lat',
  'lng',
  'address',
  'category',
  'source',
  'hours',
  'links',
  'externalId',
] as const

/** The booking details keys that hold a placeId (shared/schema/booking.ts) */
export const BOOKING_PLACE_FIELDS = ['pickupPlaceId', 'dropoffPlaceId', 'meetingPlaceId'] as const

/** Tables with a plain placeId column */
const PLACE_TABLES = ['stops', 'wishlistItems', 'lodgings', 'attachments'] as const

async function loadPlace(db: D1Database, tripId: string, placeId: string) {
  const row = await db
    .prepare('SELECT * FROM places WHERE id = ? AND tripId = ?')
    .bind(placeId, tripId)
    .first<Row>()
  if (!row) throw notFound('place not found')
  return toPlace(row)
}

/**
 * Statements that move everything pointing at `fromId` to `toId` (null = clear): stops, wishlist
 * items (soft-deleted ones too: the place row is about to go, and wishlistItems has a foreign key),
 * lodgings, attachments, and the placeId fields inside bookings.details
 */
function repointStatements(
  db: D1Database,
  tripId: string,
  fromId: string,
  toId: string | null,
  now: string,
): D1PreparedStatement[] {
  const statements = PLACE_TABLES.map((table) =>
    db
      .prepare(
        `UPDATE ${table} SET placeId = ?, rev = rev + 1, updatedAt = ? WHERE tripId = ? AND placeId = ?`,
      )
      .bind(toId, now, tripId, fromId),
  )
  for (const field of BOOKING_PLACE_FIELDS) {
    const path = `$.${field}`
    statements.push(
      toId === null
        ? db
            .prepare(
              `UPDATE bookings SET details = json_remove(details, ?), rev = rev + 1, updatedAt = ?
                WHERE tripId = ? AND json_extract(details, ?) = ?`,
            )
            .bind(path, now, tripId, path, fromId)
        : db
            .prepare(
              `UPDATE bookings SET details = json_set(details, ?, ?), rev = rev + 1, updatedAt = ?
                WHERE tripId = ? AND json_extract(details, ?) = ?`,
            )
            .bind(path, toId, now, tripId, path, fromId),
    )
  }
  return statements
}

/** How many rows of each kind point at the place (deleted ones included, as they are re-pointed) */
async function countRefs(db: D1Database, tripId: string, placeId: string) {
  const bookingWhere = BOOKING_PLACE_FIELDS.map(() => 'json_extract(details, ?) = ?').join(' OR ')
  const bookingBinds = BOOKING_PLACE_FIELDS.flatMap((field) => [`$.${field}`, placeId])
  const results = await db.batch<{ n: number }>([
    ...PLACE_TABLES.map((table) =>
      db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tripId = ? AND placeId = ?`)
        .bind(tripId, placeId),
    ),
    db
      .prepare(`SELECT COUNT(*) AS n FROM bookings WHERE tripId = ? AND (${bookingWhere})`)
      .bind(tripId, ...bookingBinds),
  ])
  const n = (i: number) => Number(results[i]?.results[0]?.n ?? 0)
  return { stops: n(0), wishlistItems: n(1), lodgings: n(2), attachments: n(3), bookings: n(4) }
}

/** GET /api/trips/:id/places (viewer) */
export async function listPlaces(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'viewer')
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM places WHERE tripId = ? ORDER BY createdAt, id',
  )
    .bind(auth.trip.id)
    .all<Row>()
  return json({ places: results.map(toPlace), rev: auth.trip.rev })
}

/**
 * POST /api/trips/:id/places (editor): 201 with the new place, or 200 with the trip's existing
 * place (`existing: true`, rev unchanged) when one already has the same externalId — the same
 * search result picked twice
 */
export async function createPlace(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const body = await readBody(c.request, placeCreateSchema)
  if (body.externalId) {
    const existing = await db
      .prepare(
        'SELECT * FROM places WHERE tripId = ? AND externalId = ? ORDER BY createdAt, id LIMIT 1',
      )
      .bind(auth.trip.id, body.externalId)
      .first<Row>()
    if (existing) return json({ place: toPlace(existing), rev: auth.trip.rev, existing: true })
  }
  const now = nowIso()
  const id = crypto.randomUUID()
  const rev = await writeWithRev(db, auth.trip.id, [
    insertStatement(db, 'places', {
      id,
      tripId: auth.trip.id,
      ...body,
      createdAt: now,
      updatedAt: now,
    }),
  ])
  notifyTrip(c.env, auth.trip.id, { rev, entity: 'place', id, action: 'upsert', by: auth.member.id })
  return json({ place: await loadPlace(db, auth.trip.id, id), rev }, 201)
}

/** PATCH /api/trips/:id/places/:pid (editor) */
export async function patchPlace(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const place = await loadPlace(db, auth.trip.id, c.params.pid)
  const body = await readBody(c.request, placePatchSchema)
  const update = updateStatement(db, 'places', body, PLACE_COLUMNS, nowIso(), {
    sql: 'id = ?',
    values: [place.id],
  })
  const rev = update ? await writeWithRev(db, auth.trip.id, [update]) : auth.trip.rev
  if (update) notifyTrip(c.env, auth.trip.id, { rev, entity: 'place', id: place.id, action: 'upsert', by: auth.member.id })
  return json({ place: await loadPlace(db, auth.trip.id, place.id), rev })
}

/** DELETE /api/trips/:id/places/:pid (editor): everything that used it loses the placeId */
export async function deletePlace(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const place = await loadPlace(db, auth.trip.id, c.params.pid)
  const now = nowIso()
  const rev = await writeWithRev(db, auth.trip.id, [
    ...repointStatements(db, auth.trip.id, place.id, null, now),
    db.prepare('DELETE FROM places WHERE id = ?').bind(place.id),
  ])
  notifyTrip(c.env, auth.trip.id, { rev, entity: 'place', id: place.id, action: 'delete', by: auth.member.id })
  return json({ ok: true, rev })
}

/** GET /api/trips/:id/places/:pid/refs (viewer): what points at it (stops, wishlist items,
 * lodgings, bookings; not deleted) */
export async function placeRefs(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const place = await loadPlace(db, auth.trip.id, c.params.pid)
  const bookingColumns = BOOKING_PLACE_FIELDS.map(
    (field) => `json_extract(details, '$.${field}') AS ${field}`,
  ).join(', ')
  const [stops, items, lodgings, bookings] = await db.batch<Row>([
    db
      .prepare('SELECT id, dayId, title FROM stops WHERE tripId = ? AND placeId = ? ORDER BY id')
      .bind(auth.trip.id, place.id),
    db
      .prepare(
        `SELECT id, name, status FROM wishlistItems
          WHERE tripId = ? AND placeId = ? AND deletedAt IS NULL ORDER BY id`,
      )
      .bind(auth.trip.id, place.id),
    db
      .prepare(
        `SELECT id, name, checkIn FROM lodgings
          WHERE tripId = ? AND placeId = ? AND deletedAt IS NULL ORDER BY checkIn, id`,
      )
      .bind(auth.trip.id, place.id),
    db
      .prepare(
        `SELECT id, title, type, ${bookingColumns} FROM bookings
          WHERE tripId = ? AND deletedAt IS NULL ORDER BY startAt, id`,
      )
      .bind(auth.trip.id),
  ])
  const body: PlaceRefsResponse = {
    stops: stops.results.map((r) => ({
      id: String(r.id),
      dayId: String(r.dayId),
      title: String(r.title),
    })),
    wishlistItems: items.results.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      status: String(r.status) as WishlistItem['status'],
    })),
    lodgings: lodgings.results.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      checkIn: String(r.checkIn),
    })),
    bookings: bookings.results.flatMap((r) => {
      const fields: string[] = BOOKING_PLACE_FIELDS.filter((field) => r[field] === place.id)
      return fields.length
        ? [{ id: String(r.id), title: String(r.title), type: String(r.type), fields }]
        : []
    }),
  }
  return json(body)
}

/** POST /api/trips/:id/places/:pid/merge-into/:targetId (editor): re-point, then delete :pid */
export async function mergePlace(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  if (c.params.pid === c.params.targetId) throw invalid('cannot merge a place into itself')
  const duplicate = await loadPlace(db, auth.trip.id, c.params.pid)
  const target = await loadPlace(db, auth.trip.id, c.params.targetId)
  const repointed = await countRefs(db, auth.trip.id, duplicate.id)
  const now = nowIso()
  const rev = await writeWithRev(db, auth.trip.id, [
    ...repointStatements(db, auth.trip.id, duplicate.id, target.id, now),
    db.prepare('DELETE FROM places WHERE id = ?').bind(duplicate.id),
    // The target inherits the duplicate's search id, so picking that result again finds it
    ...(duplicate.externalId
      ? [
          db
            .prepare(
              'UPDATE places SET externalId = ?, rev = rev + 1, updatedAt = ? WHERE id = ? AND externalId IS NULL',
            )
            .bind(duplicate.externalId, now, target.id),
        ]
      : []),
  ])
  notifyTrip(c.env, auth.trip.id, [{ rev, entity: 'place', id: duplicate.id, action: 'delete', by: auth.member.id }, { rev, entity: 'place', id: target.id, action: 'upsert', by: auth.member.id }])
  return json({ place: await loadPlace(db, auth.trip.id, target.id), repointed, rev })
}
