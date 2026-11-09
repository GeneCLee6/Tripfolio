// Lodgings (e4-t01): one row per stay. Each assigned day whose date is a night of the stay
// ([checkIn, checkOut)) points at it through days.lodgingId; a day has one lodging, so a newer stay
// over the same night takes the day over and the response lists those days as `conflicts`.
// Deletes are soft (deletedAt) and clear the days. Every write bumps the trip rev.

import type {
  DayCheckout,
  DayLodgingSummary,
  Lodging,
  LodgingsResponse,
  LodgingWriteResponse,
} from '../../shared/api/bookings.ts'
import type { Day } from '../../shared/api/types.ts'
import {
  lodgingCreateSchema,
  lodgingPatchSchema,
  MAX_LODGING_NIGHTS,
} from '../../shared/schema/lodging.ts'
import { authTrip } from '../auth.ts'
import { insertStatement, updateStatement, writeWithRev, type Row } from '../db.ts'
import { invalid, json, notFound, nowIso, readBody } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { resolveInstant } from './booking-time.ts'
import { dayCount } from './day-plan.ts'

const LODGING_COLUMNS = [
  'placeId',
  'name',
  'checkIn',
  'checkOut',
  'checkInTime',
  'checkOutTime',
  'roomType',
  'guests',
  'platform',
  'ref',
  'priceMinor',
  'currency',
  'payStatus',
  'cancelBy',
  'phone',
  'campType',
  'campFacilities',
  'note',
] as const

const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

export function toLodging(r: Row): Lodging {
  return {
    id: String(r.id),
    tripId: String(r.tripId),
    placeId: strOrNull(r.placeId),
    name: String(r.name),
    checkIn: String(r.checkIn),
    checkOut: String(r.checkOut),
    checkInTime: strOrNull(r.checkInTime),
    checkOutTime: strOrNull(r.checkOutTime),
    roomType: strOrNull(r.roomType),
    guests: numOrNull(r.guests),
    platform: strOrNull(r.platform),
    ref: strOrNull(r.ref),
    priceMinor: numOrNull(r.priceMinor),
    currency: strOrNull(r.currency),
    payStatus: String(r.payStatus) as Lodging['payStatus'],
    cancelBy: strOrNull(r.cancelBy),
    phone: strOrNull(r.phone),
    campType: strOrNull(r.campType) as Lodging['campType'],
    campFacilities: parseJson<Lodging['campFacilities']>(r.campFacilities, null),
    note: String(r.note ?? ''),
    rev: Number(r.rev),
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  }
}

async function loadLodging(db: D1Database, tripId: string, lodgingId: string) {
  const row = await db
    .prepare('SELECT * FROM lodgings WHERE id = ? AND tripId = ? AND deletedAt IS NULL')
    .bind(lodgingId, tripId)
    .first<Row>()
  if (!row) throw notFound('lodging not found')
  return toLodging(row)
}

/** 422 unless placeId is null or a place of this trip */
export async function assertTripPlace(
  db: D1Database,
  tripId: string,
  placeId: string | null | undefined,
  field = 'placeId',
) {
  if (!placeId) return
  const row = await db
    .prepare('SELECT id FROM places WHERE id = ? AND tripId = ?')
    .bind(placeId, tripId)
    .first<Row>()
  if (!row) throw invalid(`${field}: no such place in this trip`)
}

/** The rules a full (created or merged) lodging must satisfy */
function checkLodging(l: Pick<Lodging, 'checkIn' | 'checkOut' | 'priceMinor' | 'currency'>) {
  if (l.checkOut <= l.checkIn) throw invalid('checkOut: must be after checkIn')
  if (dayCount(l.checkIn, l.checkOut) - 1 > MAX_LODGING_NIGHTS)
    throw invalid(`checkOut: at most ${MAX_LODGING_NIGHTS} nights in one lodging`)
  if (l.priceMinor !== null && l.currency === null)
    throw invalid('currency: currency is required with priceMinor')
}

/**
 * Statements that point the trip's assigned days in [checkIn, checkOut) at the lodging and unlink
 * the days it no longer covers. `range` null = the lodging is going away (unlink all).
 */
async function linkDays(
  db: D1Database,
  tripId: string,
  lodgingId: string,
  range: { checkIn: string; checkOut: string } | null,
  now: string,
) {
  const { results } = await db
    .prepare('SELECT id, date, idx, lodgingId FROM days WHERE tripId = ?')
    .bind(tripId)
    .all<Row>()
  const statements: D1PreparedStatement[] = []
  const dayIds: string[] = []
  const conflicts: string[] = []
  const set = (dayId: string, value: string | null) =>
    statements.push(
      db
        .prepare('UPDATE days SET lodgingId = ?, rev = rev + 1, updatedAt = ? WHERE id = ?')
        .bind(value, now, dayId),
    )
  for (const r of results) {
    const id = String(r.id)
    const date = strOrNull(r.date)
    const current = strOrNull(r.lodgingId)
    const covered =
      range !== null &&
      r.idx !== null &&
      date !== null &&
      date >= range.checkIn &&
      date < range.checkOut
    if (covered) {
      dayIds.push(id)
      if (current !== lodgingId) {
        if (current !== null) conflicts.push(id)
        set(id, lodgingId)
      }
    } else if (current === lodgingId) {
      set(id, null)
    }
  }
  return { statements, dayIds, conflicts }
}

/** GET /api/trips/:id/lodgings (viewer) */
export async function listLodgings(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'viewer')
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM lodgings WHERE tripId = ? AND deletedAt IS NULL ORDER BY checkIn, createdAt, id',
  )
    .bind(auth.trip.id)
    .all<Row>()
  const body: LodgingsResponse = { lodgings: results.map(toLodging), rev: auth.trip.rev }
  return json(body)
}

/** POST /api/trips/:id/lodgings (editor) */
export async function createLodging(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const tripId = auth.trip.id
  const { cancelByLocal, ...body } = await readBody(c.request, lodgingCreateSchema)
  checkLodging(body)
  await assertTripPlace(db, tripId, body.placeId)
  const cancelBy = resolveInstant(body.cancelBy, cancelByLocal, auth.trip.tz) ?? null
  const now = nowIso()
  const id = crypto.randomUUID()
  const link = await linkDays(db, tripId, id, body, now)
  const rev = await writeWithRev(db, tripId, [
    insertStatement(db, 'lodgings', {
      id,
      tripId,
      ...body,
      cancelBy,
      createdAt: now,
      updatedAt: now,
    }),
    ...link.statements,
  ])
  const res: LodgingWriteResponse = {
    lodging: await loadLodging(db, tripId, id),
    dayIds: link.dayIds,
    conflicts: link.conflicts,
    rev,
  }
  return json(res, 201)
}

/** PATCH /api/trips/:id/lodgings/:lid (editor): date changes relink the days */
export async function patchLodging(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const tripId = auth.trip.id
  const lodging = await loadLodging(db, tripId, c.params.lid)
  const { cancelByLocal, ...body } = await readBody(c.request, lodgingPatchSchema)
  const cancelBy = resolveInstant(body.cancelBy, cancelByLocal, auth.trip.tz)
  const patch = { ...body, ...(cancelBy === undefined ? {} : { cancelBy }) }
  const merged = { ...lodging, ...patch }
  checkLodging(merged)
  await assertTripPlace(db, tripId, patch.placeId)
  const now = nowIso()
  const update = updateStatement(db, 'lodgings', patch, LODGING_COLUMNS, now, {
    sql: 'id = ?',
    values: [lodging.id],
  })
  const link = await linkDays(db, tripId, lodging.id, merged, now)
  const statements = [...(update ? [update] : []), ...link.statements]
  const rev = statements.length ? await writeWithRev(db, tripId, statements) : auth.trip.rev
  const res: LodgingWriteResponse = {
    lodging: await loadLodging(db, tripId, lodging.id),
    dayIds: link.dayIds,
    conflicts: link.conflicts,
    rev,
  }
  return json(res)
}

/** DELETE /api/trips/:id/lodgings/:lid (editor): soft delete; its days lose lodgingId */
export async function deleteLodging(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const tripId = auth.trip.id
  const lodging = await loadLodging(db, tripId, c.params.lid)
  const now = nowIso()
  const link = await linkDays(db, tripId, lodging.id, null, now)
  const rev = await writeWithRev(db, tripId, [
    db
      .prepare('UPDATE lodgings SET deletedAt = ?, rev = rev + 1, updatedAt = ? WHERE id = ?')
      .bind(now, now, lodging.id),
    ...link.statements,
    db
      .prepare(
        'UPDATE stops SET lodgingId = NULL, rev = rev + 1, updatedAt = ? WHERE tripId = ? AND lodgingId = ?',
      )
      .bind(now, tripId, lodging.id),
  ])
  return json({ ok: true, rev })
}

/**
 * The lodging fields GET /days adds to each day: `lodging` is the night's lodging (days.lodgingId),
 * or, when no lodging follows, the one checked out of that morning (isCheckoutDay); `checkout` is
 * whoever checks out that morning, also on a day that moves on to another lodging.
 */
export async function dayLodgings(
  db: D1Database,
  tripId: string,
  days: Pick<Day, 'id' | 'date' | 'idx' | 'lodgingId'>[],
): Promise<Map<string, { lodging: DayLodgingSummary | null; checkout: DayCheckout | null }>> {
  const { results } = await db
    .prepare('SELECT * FROM lodgings WHERE tripId = ? AND deletedAt IS NULL ORDER BY checkIn, id')
    .bind(tripId)
    .all<Row>()
  const lodgings = results.map(toLodging)
  const byId = new Map(lodgings.map((l) => [l.id, l]))
  const out = new Map<string, { lodging: DayLodgingSummary | null; checkout: DayCheckout | null }>()
  for (const day of days) {
    const leaving =
      day.idx !== null && day.date !== null
        ? lodgings.find((l) => l.checkOut === day.date)
        : undefined
    const checkout: DayCheckout | null = leaving
      ? { id: leaving.id, name: leaving.name, checkOutTime: leaving.checkOutTime }
      : null
    const tonight = day.lodgingId ? byId.get(day.lodgingId) : undefined
    const shown = tonight ?? leaving
    const lodging: DayLodgingSummary | null = shown
      ? {
          id: shown.id,
          name: shown.name,
          checkOutTime: shown.checkOutTime,
          isCheckoutDay: !tonight && day.date === shown.checkOut,
          isCheckinDay: !!tonight && day.date === shown.checkIn,
          campType: shown.campType,
        }
      : null
    out.set(day.id, { lodging, checkout })
  }
  return out
}
