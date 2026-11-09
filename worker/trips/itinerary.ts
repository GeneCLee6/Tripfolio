// Days, stops and leg overrides (e2-t01). Every write bumps the trip rev and the row rev and answers
// with the new trip rev.

import type { DaysResponse, DayWithStops } from '../../shared/api/types.ts'
import { dayPatchSchema } from '../../shared/schema/day.ts'
import {
  legOverrideSchema,
  stopCreateSchema,
  stopMoveSchema,
  stopPatchSchema,
} from '../../shared/schema/stop.ts'
import { authTrip } from '../auth.ts'
import {
  insertStatement,
  toDay,
  toLeg,
  toStop,
  updateStatement,
  writeWithRev,
  type Row,
} from '../db.ts'
import { invalid, json, notFound, nowIso, readBody } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { planPlacement, type Ordered } from './order.ts'

const STOP_COLUMNS = [
  'type',
  'title',
  'placeId',
  'startAt',
  'endAt',
  'durationMin',
  'costMinor',
  'currency',
  'booking',
  'note',
  'links',
  'wishlistItemId',
  'bookingId',
  'isBackup',
] as const

async function loadDay(db: D1Database, tripId: string, dayId: string) {
  const row = await db
    .prepare('SELECT * FROM days WHERE id = ? AND tripId = ?')
    .bind(dayId, tripId)
    .first<Row>()
  if (!row) throw notFound('day not found')
  return toDay(row)
}

export async function loadStop(db: D1Database, tripId: string, stopId: string) {
  const row = await db
    .prepare('SELECT * FROM stops WHERE id = ? AND tripId = ?')
    .bind(stopId, tripId)
    .first<Row>()
  if (!row) throw notFound('stop not found')
  return toStop(row)
}

async function assertPlace(db: D1Database, tripId: string, placeId: string | null | undefined) {
  if (!placeId) return
  const row = await db
    .prepare('SELECT id FROM places WHERE id = ? AND tripId = ?')
    .bind(placeId, tripId)
    .first<Row>()
  if (!row) throw invalid('placeId: no such place in this trip')
}

/** The day's stops in order, optionally without one (the stop being moved) */
async function siblings(db: D1Database, dayId: string, exceptId?: string): Promise<Ordered[]> {
  const { results } = await db
    .prepare('SELECT id, "order" FROM stops WHERE dayId = ? ORDER BY "order", id')
    .bind(dayId)
    .all<Row>()
  return results
    .filter((r) => r.id !== exceptId)
    .map((r) => ({ id: String(r.id), order: Number(r.order) }))
}

function renumberStatements(db: D1Database, items: Ordered[], now: string) {
  return items.map((s) =>
    db
      .prepare('UPDATE stops SET "order" = ?, rev = rev + 1, updatedAt = ? WHERE id = ?')
      .bind(s.order, now, s.id),
  )
}

/** GET /api/trips/:id/days (viewer): days with their stops nested, plus the leg overrides */
export async function listDays(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const tripId = auth.trip.id
  const [days, stops, legs] = await Promise.all([
    db
      .prepare('SELECT * FROM days WHERE tripId = ? ORDER BY idx IS NULL, idx, date, createdAt, id')
      .bind(tripId)
      .all<Row>(),
    db.prepare('SELECT * FROM stops WHERE tripId = ? ORDER BY "order", id').bind(tripId).all<Row>(),
    db.prepare('SELECT * FROM legOverrides WHERE tripId = ?').bind(tripId).all<Row>(),
  ])
  const byDay = new Map<string, DayWithStops>()
  const list = days.results.map((r) => {
    const day: DayWithStops = { ...toDay(r), stops: [] }
    byDay.set(day.id, day)
    return day
  })
  for (const r of stops.results) {
    const stop = toStop(r)
    byDay.get(stop.dayId)?.stops.push(stop)
  }
  const body: DaysResponse = { days: list, legs: legs.results.map(toLeg), rev: auth.trip.rev }
  return json(body)
}

/** PATCH /api/trips/:id/days/:dayId (editor): title, color, note, lodgingId */
export async function patchDay(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const day = await loadDay(db, auth.trip.id, c.params.dayId)
  const body = await readBody(c.request, dayPatchSchema)
  const update = updateStatement(
    db,
    'days',
    body,
    ['title', 'color', 'note', 'lodgingId'],
    nowIso(),
    {
      sql: 'id = ?',
      values: [day.id],
    },
  )
  const rev = update ? await writeWithRev(db, auth.trip.id, [update]) : auth.trip.rev
  return json({ day: await loadDay(db, auth.trip.id, day.id), rev })
}

/** POST /api/trips/:id/stops (editor) */
export async function createStop(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const { dayId, afterStopId, ...fields } = await readBody(c.request, stopCreateSchema)
  const day = await loadDay(db, auth.trip.id, dayId)
  await assertPlace(db, auth.trip.id, fields.placeId)
  const placement = planPlacement(
    await siblings(db, day.id),
    afterStopId === undefined ? 'end' : afterStopId,
  )
  if (!placement) throw invalid('afterStopId: no such stop in that day')
  const now = nowIso()
  const id = crypto.randomUUID()
  const rev = await writeWithRev(db, auth.trip.id, [
    ...renumberStatements(db, placement.renumbered, now),
    insertStatement(db, 'stops', {
      id,
      tripId: auth.trip.id,
      dayId: day.id,
      order: placement.order,
      ...fields,
      createdAt: now,
      updatedAt: now,
    }),
  ])
  return json({ stop: await loadStop(db, auth.trip.id, id), rev }, 201)
}

/** PATCH /api/trips/:id/stops/:sid (editor); day and position change through /move */
export async function patchStop(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const stop = await loadStop(db, auth.trip.id, c.params.sid)
  const body = await readBody(c.request, stopPatchSchema)
  await assertPlace(db, auth.trip.id, body.placeId)
  const update = updateStatement(db, 'stops', body, STOP_COLUMNS, nowIso(), {
    sql: 'id = ?',
    values: [stop.id],
  })
  const rev = update ? await writeWithRev(db, auth.trip.id, [update]) : auth.trip.rev
  return json({ stop: await loadStop(db, auth.trip.id, stop.id), rev })
}

/** DELETE /api/trips/:id/stops/:sid (editor): also drops leg overrides that touch it */
export async function deleteStop(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const stop = await loadStop(db, auth.trip.id, c.params.sid)
  const rev = await writeWithRev(db, auth.trip.id, [
    db
      .prepare('DELETE FROM legOverrides WHERE fromStopId = ? OR toStopId = ?')
      .bind(stop.id, stop.id),
    db.prepare('DELETE FROM stops WHERE id = ?').bind(stop.id),
  ])
  return json({ ok: true, rev })
}

/** POST /api/trips/:id/stops/:sid/move (editor): `{ dayId, afterStopId | null }` */
export async function moveStop(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const stop = await loadStop(db, auth.trip.id, c.params.sid)
  const { dayId, afterStopId } = await readBody(c.request, stopMoveSchema)
  if (afterStopId === stop.id) throw invalid('afterStopId: cannot place a stop after itself')
  const day = await loadDay(db, auth.trip.id, dayId)
  const placement = planPlacement(await siblings(db, day.id, stop.id), afterStopId)
  if (!placement) throw invalid('afterStopId: no such stop in that day')
  const now = nowIso()
  const rev = await writeWithRev(db, auth.trip.id, [
    ...renumberStatements(db, placement.renumbered, now),
    db
      .prepare('UPDATE stops SET dayId = ?, "order" = ?, rev = rev + 1, updatedAt = ? WHERE id = ?')
      .bind(day.id, placement.order, now, stop.id),
  ])
  return json({
    stop: await loadStop(db, auth.trip.id, stop.id),
    renumbered: placement.renumbered,
    rev,
  })
}

/** PUT /api/trips/:id/legs/:fromStopId/:toStopId (editor): `{ mode, minutes | null }` */
export async function putLeg(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const { fromStopId, toStopId } = c.params
  if (fromStopId === toStopId) throw invalid('a leg needs two different stops')
  await loadStop(db, auth.trip.id, fromStopId)
  await loadStop(db, auth.trip.id, toStopId)
  const { mode, minutes } = await readBody(c.request, legOverrideSchema)
  const now = nowIso()
  const rev = await writeWithRev(db, auth.trip.id, [
    db
      .prepare(
        `INSERT INTO legOverrides (tripId, fromStopId, toStopId, mode, minutes, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (fromStopId, toStopId)
         DO UPDATE SET mode = excluded.mode, minutes = excluded.minutes, rev = rev + 1,
                       updatedAt = excluded.updatedAt`,
      )
      .bind(auth.trip.id, fromStopId, toStopId, mode, minutes, now),
  ])
  const row = await db
    .prepare('SELECT * FROM legOverrides WHERE fromStopId = ? AND toStopId = ?')
    .bind(fromStopId, toStopId)
    .first<Row>()
  return json({ leg: row ? toLeg(row) : null, rev })
}

/** DELETE /api/trips/:id/legs/:fromStopId/:toStopId (editor): back to the routed leg */
export async function deleteLeg(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const row = await db
    .prepare(
      'SELECT 1 AS found FROM legOverrides WHERE tripId = ? AND fromStopId = ? AND toStopId = ?',
    )
    .bind(auth.trip.id, c.params.fromStopId, c.params.toStopId)
    .first<Row>()
  if (!row) throw notFound('leg override not found')
  const rev = await writeWithRev(db, auth.trip.id, [
    db
      .prepare('DELETE FROM legOverrides WHERE fromStopId = ? AND toStopId = ?')
      .bind(c.params.fromStopId, c.params.toStopId),
  ])
  return json({ ok: true, rev })
}
