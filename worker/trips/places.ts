// Places (e3-t01): a referenced entity; stops, wishlist items (and later lodgings, attachments) point at
// it by placeId, so renaming once changes it everywhere.

import type { PlaceRefsResponse, WishlistItem } from '../../shared/api/types.ts'
import { placeCreateSchema, placePatchSchema } from '../../shared/schema/place.ts'
import { authTrip } from '../auth.ts'
import { insertStatement, toPlace, updateStatement, writeWithRev, type Row } from '../db.ts'
import { invalid, json, notFound, nowIso, readBody } from '../http.ts'
import type { RouteContext } from '../router.ts'

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
] as const

async function loadPlace(db: D1Database, tripId: string, placeId: string) {
  const row = await db
    .prepare('SELECT * FROM places WHERE id = ? AND tripId = ?')
    .bind(placeId, tripId)
    .first<Row>()
  if (!row) throw notFound('place not found')
  return toPlace(row)
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

/** POST /api/trips/:id/places (editor) */
export async function createPlace(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const body = await readBody(c.request, placeCreateSchema)
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
  return json({ place: await loadPlace(db, auth.trip.id, place.id), rev })
}

/** DELETE /api/trips/:id/places/:pid (editor): stops and wishlist items that used it lose placeId */
export async function deletePlace(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const place = await loadPlace(db, auth.trip.id, c.params.pid)
  const now = nowIso()
  const rev = await writeWithRev(db, auth.trip.id, [
    db
      .prepare(
        'UPDATE stops SET placeId = NULL, rev = rev + 1, updatedAt = ? WHERE tripId = ? AND placeId = ?',
      )
      .bind(now, auth.trip.id, place.id),
    db
      .prepare(
        'UPDATE wishlistItems SET placeId = NULL, rev = rev + 1, updatedAt = ? WHERE tripId = ? AND placeId = ?',
      )
      .bind(now, auth.trip.id, place.id),
    db.prepare('DELETE FROM places WHERE id = ?').bind(place.id),
  ])
  return json({ ok: true, rev })
}

/** GET /api/trips/:id/places/:pid/refs (viewer): what points at it (stops, wishlist items) */
export async function placeRefs(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const place = await loadPlace(db, auth.trip.id, c.params.pid)
  const [stops, items] = await Promise.all([
    db
      .prepare('SELECT id, dayId, title FROM stops WHERE tripId = ? AND placeId = ? ORDER BY id')
      .bind(auth.trip.id, place.id)
      .all<Row>(),
    db
      .prepare(
        `SELECT id, name, status FROM wishlistItems
          WHERE tripId = ? AND placeId = ? AND deletedAt IS NULL ORDER BY id`,
      )
      .bind(auth.trip.id, place.id)
      .all<Row>(),
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
  const count = await db
    .prepare('SELECT COUNT(*) AS n FROM stops WHERE tripId = ? AND placeId = ?')
    .bind(auth.trip.id, duplicate.id)
    .first<number>('n')
  // Soft-deleted items are re-pointed too: the duplicate row is about to go (foreign key)
  const itemCount = await db
    .prepare('SELECT COUNT(*) AS n FROM wishlistItems WHERE tripId = ? AND placeId = ?')
    .bind(auth.trip.id, duplicate.id)
    .first<number>('n')
  const now = nowIso()
  const rev = await writeWithRev(db, auth.trip.id, [
    db
      .prepare(
        'UPDATE stops SET placeId = ?, rev = rev + 1, updatedAt = ? WHERE tripId = ? AND placeId = ?',
      )
      .bind(target.id, now, auth.trip.id, duplicate.id),
    db
      .prepare(
        'UPDATE wishlistItems SET placeId = ?, rev = rev + 1, updatedAt = ? WHERE tripId = ? AND placeId = ?',
      )
      .bind(target.id, now, auth.trip.id, duplicate.id),
    db.prepare('DELETE FROM places WHERE id = ?').bind(duplicate.id),
  ])
  return json({
    place: target,
    repointed: { stops: Number(count ?? 0), wishlistItems: Number(itemCount ?? 0) },
    rev,
  })
}
