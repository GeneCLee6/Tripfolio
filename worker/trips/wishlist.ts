// Wishlist (e5-t01): items, votes, claims, scheduling into a day, and the pocket list the itinerary
// sidebar drags from (docs/PRD/e5-wishlist.md, e2 口袋名單). Viewers read, editors write; every
// write bumps the trip rev (and the item's row rev) and answers with the new trip rev.
//
// Status invariant: wish and dropped have no stopId, scheduled has one, done may keep one.
// - POST …/schedule creates a stop (type from wishlistStopType) linked both ways, status scheduled.
// - POST …/unschedule deletes that stop (whatever was edited on it) and sets status back to wish.
// - Deleting the stop through DELETE /stops/:sid clears stopId; scheduled goes back to wish.

import type {
  PocketResponse,
  WishlistClaim,
  WishlistItem,
  WishlistItemView,
} from '../../shared/api/types.ts'
import {
  wishlistClaimCreateSchema,
  wishlistClaimPatchSchema,
  wishlistItemCreateSchema,
  wishlistItemPatchSchema,
  wishlistQuerySchema,
  wishlistScheduleSchema,
  wishlistStopType,
} from '../../shared/schema/wishlist.ts'
import { authTrip } from '../auth.ts'
import { insertStatement, toPlace, toStop, updateStatement, writeWithRev, type Row } from '../db.ts'
import { invalid, json, notFound, nowIso, readBody } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { planPlacement } from './order.ts'

const ITEM_COLUMNS = [
  'category',
  'name',
  'placeId',
  'photoAttachmentId',
  'estMinor',
  'currency',
  'sourceUrl',
  'sourceTitle',
  'sourceImageUrl',
  'recommenderMemberId',
  'note',
  'status',
  'order',
] as const

const CLAIM_COLUMNS = ['buyerMemberId', 'forName', 'qty', 'done'] as const

const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

function toItem(r: Row): WishlistItem {
  return {
    id: String(r.id),
    tripId: String(r.tripId),
    category: String(r.category) as WishlistItem['category'],
    name: String(r.name),
    placeId: strOrNull(r.placeId),
    photoAttachmentId: strOrNull(r.photoAttachmentId),
    estMinor: numOrNull(r.estMinor),
    currency: strOrNull(r.currency),
    sourceUrl: strOrNull(r.sourceUrl),
    sourceTitle: strOrNull(r.sourceTitle),
    sourceImageUrl: strOrNull(r.sourceImageUrl),
    recommenderMemberId: strOrNull(r.recommenderMemberId),
    note: String(r.note ?? ''),
    status: String(r.status) as WishlistItem['status'],
    stopId: strOrNull(r.stopId),
    order: Number(r.order),
    rev: Number(r.rev),
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  }
}

function toClaim(r: Row): WishlistClaim {
  return {
    id: String(r.id),
    itemId: String(r.itemId),
    buyerMemberId: strOrNull(r.buyerMemberId),
    forName: String(r.forName ?? ''),
    qty: Number(r.qty),
    done: Number(r.done) === 1,
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  }
}

/** Items (not deleted) with votes from current members, claims and the place summary */
async function loadViews(
  db: D1Database,
  tripId: string,
  filter: { sql: string; values: (string | number)[] } = { sql: '', values: [] },
): Promise<WishlistItemView[]> {
  const where = `i.tripId = ? AND i.deletedAt IS NULL${filter.sql}`
  const [items, votes, claims] = await Promise.all([
    db
      .prepare(
        `SELECT i.*, p.nameLocal AS p_nameLocal, p.nameEn AS p_nameEn, p.lat AS p_lat, p.lng AS p_lng
           FROM wishlistItems i LEFT JOIN places p ON p.id = i.placeId
          WHERE ${where} ORDER BY i."order", i.createdAt, i.id`,
      )
      .bind(tripId, ...filter.values)
      .all<Row>(),
    db
      .prepare(
        `SELECT v.itemId, v.memberId FROM wishlistVotes v
           JOIN wishlistItems i ON i.id = v.itemId
           JOIN members m ON m.id = v.memberId AND m.removedAt IS NULL
          WHERE ${where} ORDER BY v.createdAt, v.memberId`,
      )
      .bind(tripId, ...filter.values)
      .all<Row>(),
    db
      .prepare(
        `SELECT c.* FROM wishlistClaims c JOIN wishlistItems i ON i.id = c.itemId
          WHERE ${where} ORDER BY c.createdAt, c.id`,
      )
      .bind(tripId, ...filter.values)
      .all<Row>(),
  ])
  const views = new Map<string, WishlistItemView>()
  for (const r of items.results) {
    const item = toItem(r)
    views.set(item.id, {
      ...item,
      votes: [],
      claims: [],
      place:
        item.placeId && r.p_nameLocal !== null && r.p_nameLocal !== undefined
          ? {
              id: item.placeId,
              nameLocal: String(r.p_nameLocal),
              nameEn: String(r.p_nameEn ?? ''),
              lat: Number(r.p_lat),
              lng: Number(r.p_lng),
            }
          : null,
    })
  }
  for (const v of votes.results) views.get(String(v.itemId))?.votes.push(String(v.memberId))
  for (const c of claims.results) views.get(String(c.itemId))?.claims.push(toClaim(c))
  return [...views.values()]
}

async function loadView(db: D1Database, tripId: string, itemId: string) {
  const [view] = await loadViews(db, tripId, { sql: ' AND i.id = ?', values: [itemId] })
  if (!view) throw notFound('wishlist item not found')
  return view
}

async function loadItem(db: D1Database, tripId: string, itemId: string) {
  const row = await db
    .prepare('SELECT * FROM wishlistItems WHERE id = ? AND tripId = ? AND deletedAt IS NULL')
    .bind(itemId, tripId)
    .first<Row>()
  if (!row) throw notFound('wishlist item not found')
  return toItem(row)
}

async function assertPlace(db: D1Database, tripId: string, placeId: string | null | undefined) {
  if (!placeId) return
  const row = await db
    .prepare('SELECT id FROM places WHERE id = ? AND tripId = ?')
    .bind(placeId, tripId)
    .first<Row>()
  if (!row) throw invalid('placeId: no such place in this trip')
}

async function assertMember(
  db: D1Database,
  tripId: string,
  memberId: string | null | undefined,
  field: string,
) {
  if (!memberId) return
  const row = await db
    .prepare('SELECT id FROM members WHERE id = ? AND tripId = ? AND removedAt IS NULL')
    .bind(memberId, tripId)
    .first<Row>()
  if (!row) throw invalid(`${field}: no such member in this trip`)
}

/** The item's own rev and updatedAt move with its votes and claims too */
const touchItem = (db: D1Database, itemId: string, now: string) =>
  db.prepare('UPDATE wishlistItems SET rev = rev + 1, updatedAt = ? WHERE id = ?').bind(now, itemId)

/** GET /api/trips/:id/wishlist?status=&category= (viewer) */
export async function listWishlist(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const parsed = wishlistQuerySchema.safeParse({
    status: c.url.searchParams.get('status') ?? undefined,
    category: c.url.searchParams.get('category') ?? undefined,
  })
  if (!parsed.success) throw invalid('status or category: unknown value', parsed.error.issues)
  const parts: string[] = []
  const values: string[] = []
  if (parsed.data.status) {
    parts.push(' AND i.status = ?')
    values.push(parsed.data.status)
  }
  if (parsed.data.category) {
    parts.push(' AND i.category = ?')
    values.push(parsed.data.category)
  }
  const items = await loadViews(db, auth.trip.id, { sql: parts.join(''), values })
  return json({ items, rev: auth.trip.rev })
}

/** POST /api/trips/:id/wishlist (editor): status starts as wish */
export async function createWishlistItem(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const { order, ...fields } = await readBody(c.request, wishlistItemCreateSchema)
  await assertPlace(db, auth.trip.id, fields.placeId)
  await assertMember(db, auth.trip.id, fields.recommenderMemberId, 'recommenderMemberId')
  const last = await db
    .prepare('SELECT MAX("order") AS m FROM wishlistItems WHERE tripId = ?')
    .bind(auth.trip.id)
    .first<number | null>('m')
  const now = nowIso()
  const id = crypto.randomUUID()
  const rev = await writeWithRev(db, auth.trip.id, [
    insertStatement(db, 'wishlistItems', {
      id,
      tripId: auth.trip.id,
      ...fields,
      status: 'wish',
      order: order ?? (last === null ? 1 : Number(last) + 1),
      createdAt: now,
      updatedAt: now,
    }),
  ])
  return json({ item: await loadView(db, auth.trip.id, id), rev }, 201)
}

/** PATCH /api/trips/:id/wishlist/:wid (editor) */
export async function patchWishlistItem(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const item = await loadItem(db, auth.trip.id, c.params.wid)
  const body = await readBody(c.request, wishlistItemPatchSchema)
  await assertPlace(db, auth.trip.id, body.placeId)
  await assertMember(db, auth.trip.id, body.recommenderMemberId, 'recommenderMemberId')
  const estMinor = body.estMinor === undefined ? item.estMinor : body.estMinor
  const currency = body.currency === undefined ? item.currency : body.currency
  if (estMinor !== null && currency === null) throw invalid('currency: required with estMinor')
  if (body.status && body.status !== item.status) {
    if ((body.status === 'wish' || body.status === 'dropped') && item.stopId)
      throw invalid('status: the item is in the itinerary; unschedule it first')
    if (body.status === 'scheduled' && !item.stopId)
      throw invalid('status: use POST …/schedule to put the item into a day')
  }
  const update = updateStatement(db, 'wishlistItems', body, ITEM_COLUMNS, nowIso(), {
    sql: 'id = ?',
    values: [item.id],
  })
  const rev = update ? await writeWithRev(db, auth.trip.id, [update]) : auth.trip.rev
  return json({ item: await loadView(db, auth.trip.id, item.id), rev })
}

/** DELETE /api/trips/:id/wishlist/:wid (editor): soft delete; a linked stop stays, unlinked */
export async function deleteWishlistItem(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const item = await loadItem(db, auth.trip.id, c.params.wid)
  const now = nowIso()
  const rev = await writeWithRev(db, auth.trip.id, [
    db
      .prepare('UPDATE wishlistItems SET deletedAt = ?, rev = rev + 1, updatedAt = ? WHERE id = ?')
      .bind(now, now, item.id),
    db
      .prepare(
        'UPDATE stops SET wishlistItemId = NULL, rev = rev + 1, updatedAt = ? WHERE tripId = ? AND wishlistItemId = ?',
      )
      .bind(now, auth.trip.id, item.id),
  ])
  return json({ ok: true, rev })
}

/** POST /api/trips/:id/wishlist/:wid/vote (editor): the caller's member wants to go (idempotent) */
export async function voteWishlistItem(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const item = await loadItem(db, auth.trip.id, c.params.wid)
  const now = nowIso()
  const rev = await writeWithRev(db, auth.trip.id, [
    db
      .prepare(
        'INSERT INTO wishlistVotes (itemId, memberId, createdAt) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
      )
      .bind(item.id, auth.member.id, now),
    touchItem(db, item.id, now),
  ])
  return json({ item: await loadView(db, auth.trip.id, item.id), rev })
}

/** DELETE /api/trips/:id/wishlist/:wid/vote (editor): takes the caller's vote back */
export async function unvoteWishlistItem(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const item = await loadItem(db, auth.trip.id, c.params.wid)
  const now = nowIso()
  const rev = await writeWithRev(db, auth.trip.id, [
    db
      .prepare('DELETE FROM wishlistVotes WHERE itemId = ? AND memberId = ?')
      .bind(item.id, auth.member.id),
    touchItem(db, item.id, now),
  ])
  return json({ item: await loadView(db, auth.trip.id, item.id), rev })
}

async function loadClaim(db: D1Database, itemId: string, claimId: string) {
  const row = await db
    .prepare('SELECT * FROM wishlistClaims WHERE id = ? AND itemId = ?')
    .bind(claimId, itemId)
    .first<Row>()
  if (!row) throw notFound('claim not found')
  return toClaim(row)
}

/** POST /api/trips/:id/wishlist/:wid/claims (editor): who buys it, for whom, how many */
export async function createClaim(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const item = await loadItem(db, auth.trip.id, c.params.wid)
  const body = await readBody(c.request, wishlistClaimCreateSchema)
  await assertMember(db, auth.trip.id, body.buyerMemberId, 'buyerMemberId')
  const now = nowIso()
  const id = crypto.randomUUID()
  const rev = await writeWithRev(db, auth.trip.id, [
    insertStatement(db, 'wishlistClaims', {
      id,
      itemId: item.id,
      ...body,
      createdAt: now,
      updatedAt: now,
    }),
    touchItem(db, item.id, now),
  ])
  return json({ claim: await loadClaim(db, item.id, id), rev }, 201)
}

/** PATCH /api/trips/:id/wishlist/:wid/claims/:cid (editor) */
export async function patchClaim(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const item = await loadItem(db, auth.trip.id, c.params.wid)
  const claim = await loadClaim(db, item.id, c.params.cid)
  const body = await readBody(c.request, wishlistClaimPatchSchema)
  await assertMember(db, auth.trip.id, body.buyerMemberId, 'buyerMemberId')
  const now = nowIso()
  const update = updateStatement(
    db,
    'wishlistClaims',
    body,
    CLAIM_COLUMNS,
    now,
    { sql: 'id = ?', values: [claim.id] },
    { bumpRowRev: false },
  )
  const rev = update
    ? await writeWithRev(db, auth.trip.id, [update, touchItem(db, item.id, now)])
    : auth.trip.rev
  return json({ claim: await loadClaim(db, item.id, claim.id), rev })
}

/** DELETE /api/trips/:id/wishlist/:wid/claims/:cid (editor) */
export async function deleteClaim(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const item = await loadItem(db, auth.trip.id, c.params.wid)
  const claim = await loadClaim(db, item.id, c.params.cid)
  const rev = await writeWithRev(db, auth.trip.id, [
    db.prepare('DELETE FROM wishlistClaims WHERE id = ?').bind(claim.id),
    touchItem(db, item.id, nowIso()),
  ])
  return json({ ok: true, rev })
}

/**
 * POST /api/trips/:id/wishlist/:wid/schedule (editor): `{ dayId, afterStopId? }` → a new stop with
 * the item's name, place, estimated price and note, type from the category; linked both ways
 */
export async function scheduleWishlistItem(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const item = await loadItem(db, auth.trip.id, c.params.wid)
  const { dayId, afterStopId } = await readBody(c.request, wishlistScheduleSchema)
  if (item.stopId) throw invalid('the item is already in the itinerary')
  if (item.status !== 'wish')
    throw invalid(`status: cannot schedule an item that is ${item.status}`)
  const day = await db
    .prepare('SELECT id FROM days WHERE id = ? AND tripId = ?')
    .bind(dayId, auth.trip.id)
    .first<Row>()
  if (!day) throw notFound('day not found')
  const { results } = await db
    .prepare('SELECT id, "order" FROM stops WHERE dayId = ? ORDER BY "order", id')
    .bind(dayId)
    .all<Row>()
  const placement = planPlacement(
    results.map((r) => ({ id: String(r.id), order: Number(r.order) })),
    afterStopId === undefined ? 'end' : afterStopId,
  )
  if (!placement) throw invalid('afterStopId: no such stop in that day')
  const now = nowIso()
  const stopId = crypto.randomUUID()
  const rev = await writeWithRev(db, auth.trip.id, [
    ...placement.renumbered.map((s) =>
      db
        .prepare('UPDATE stops SET "order" = ?, rev = rev + 1, updatedAt = ? WHERE id = ?')
        .bind(s.order, now, s.id),
    ),
    insertStatement(db, 'stops', {
      id: stopId,
      tripId: auth.trip.id,
      dayId,
      order: placement.order,
      type: wishlistStopType[item.category],
      title: item.name,
      placeId: item.placeId,
      costMinor: item.estMinor,
      currency: item.estMinor === null ? null : item.currency,
      note: item.note,
      wishlistItemId: item.id,
      createdAt: now,
      updatedAt: now,
    }),
    db
      .prepare(
        `UPDATE wishlistItems SET status = 'scheduled', stopId = ?, rev = rev + 1, updatedAt = ?
          WHERE id = ?`,
      )
      .bind(stopId, now, item.id),
  ])
  const stopRow = await db.prepare('SELECT * FROM stops WHERE id = ?').bind(stopId).first<Row>()
  return json(
    {
      item: await loadView(db, auth.trip.id, item.id),
      stop: toStop(stopRow as Row),
      rev,
    },
    201,
  )
}

/**
 * POST /api/trips/:id/wishlist/:wid/unschedule (editor): deletes the linked stop (edits made on it
 * are lost) with its leg overrides, and puts the item back in the pocket list (status wish)
 */
export async function unscheduleWishlistItem(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const item = await loadItem(db, auth.trip.id, c.params.wid)
  if (!item.stopId) throw invalid('the item is not in the itinerary')
  const stop = item.stopId
    ? await db
        .prepare('SELECT id FROM stops WHERE id = ? AND tripId = ?')
        .bind(item.stopId, auth.trip.id)
        .first<Row>()
    : null
  const stopId = stop ? String(stop.id) : null
  const now = nowIso()
  const rev = await writeWithRev(db, auth.trip.id, [
    ...(stopId
      ? [
          db
            .prepare('DELETE FROM legOverrides WHERE fromStopId = ? OR toStopId = ?')
            .bind(stopId, stopId),
          db.prepare('DELETE FROM stops WHERE id = ?').bind(stopId),
        ]
      : []),
    db
      .prepare(
        `UPDATE wishlistItems SET status = 'wish', stopId = NULL, rev = rev + 1, updatedAt = ?
          WHERE id = ?`,
      )
      .bind(now, item.id),
  ])
  return json({ item: await loadView(db, auth.trip.id, item.id), deletedStopId: stopId, rev })
}

/**
 * GET /api/trips/:id/pocket (viewer): wishlist items still wished for, plus places nothing points
 * at (no stop, no non-deleted wishlist item) — what the itinerary sidebar can drag into a day
 */
export async function pocketList(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const [items, places] = await Promise.all([
    loadViews(db, auth.trip.id, { sql: " AND i.status = 'wish'", values: [] }),
    db
      .prepare(
        `SELECT p.* FROM places p
          WHERE p.tripId = ?
            AND NOT EXISTS (SELECT 1 FROM stops s WHERE s.placeId = p.id)
            AND NOT EXISTS (SELECT 1 FROM wishlistItems w
                             WHERE w.placeId = p.id AND w.deletedAt IS NULL)
          ORDER BY p.createdAt, p.id`,
      )
      .bind(auth.trip.id)
      .all<Row>(),
  ])
  const body: PocketResponse = { items, places: places.results.map(toPlace), rev: auth.trip.rev }
  return json(body)
}
